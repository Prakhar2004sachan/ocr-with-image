"""Engine backend that runs the *original* Baidu Unlimited-OCR-2 weights.

The second-generation model ships as an ``image-text-to-text`` model in
PyTorch/Safetensors layout with ``trust_remote_code`` modules. Unlike the
llama.cpp path there is no separate vision projector: the encoder, the MoE
decoder and the (SR-SWA/DASH) sparse attention all live in one checkpoint.

The original repo's Triton kernels are optional for inference; the module:

* loads the original BF16 weights onto the best available device (CUDA, then
  Metal/MPS, then CPU),
* patches the only two hard-coded ``.cuda()`` calls in Baidu's remote code by
  keeping a patched copy of the repo in ``data/`` (the downloaded
  ``models/uocr2`` folder is never modified),
* runs inference through the model's own ``infer()`` entry point, which builds
  the ``<PAGE><image>`` layout used by Unlimited-OCR-2,
* supports cooperative cancellation by guarding the LM head, which the model's
  decode loop calls once per token.
"""

from __future__ import annotations

import asyncio
import logging
import os
import re
import shutil
import sys
import threading
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

from ..config import Settings
from ..errors import EngineUnavailableError, ModelMissingError
from ..schemas import EngineStatus
from ..utils import iso_now, resolve_data_path

logger = logging.getLogger("ocr.engine.transformers")

DeltaCallback = Callable[[str], Awaitable[None] | None]
CancelCheck = Callable[[], bool]

TORCH_IMPORT_HINT = (
    "Install the inference dependencies with: "
    "backend/.venv/bin/python -m pip install torch transformers accelerate "
    "pillow einops addict easydict"
)

REQUIRED_FILES = (
    "config.json",
    "model.safetensors.index.json",
    "modeling_unlimitedocr.py",
    "deepencoder.py",
    "tokenizer.json",
    "tokenizer_config.json",
)


class GenerationCanceled(Exception):
    """Raised inside the decode loop when a job is canceled."""


class GenerationResult:
    def __init__(
        self,
        text: str,
        *,
        finish_reason: str | None,
        prompt_tokens: int | None,
        completion_tokens: int | None,
        duration_ms: int,
        canceled: bool = False,
    ) -> None:
        self.text = text
        self.finish_reason = finish_reason
        self.prompt_tokens = prompt_tokens
        self.completion_tokens = completion_tokens
        self.duration_ms = duration_ms
        self.canceled = canceled


class TransformersEngine:
    """Loads and runs baidu/Unlimited-OCR-2 through transformers on GPU or CPU."""

    engine_type = "transformers"

    def __init__(self, config: Settings) -> None:
        self.config = config
        self.status = "stopped"
        self.started_at: str | None = None
        self.last_error: str | None = None
        self.device_name: str | None = None
        self.load_seconds: float | None = None
        # The diagnostics endpoint reads ``engine.command``; this engine has no
        # subprocess, so it reports the equivalent load description instead.
        self.command: list[str] | None = None
        self._model: Any | None = None
        self._tokenizer: Any | None = None
        self._torch: Any | None = None
        self._lock = asyncio.Lock()
        self._load_lock = threading.RLock()
        self._cancel_check: CancelCheck | None = None
        self.log_path = config.logs_dir / "transformers.log"

    # ------------------------------------------------------------------ status
    def weights_status(self) -> dict[str, Any]:
        """Report which local Unlimited-OCR-2 files are present."""
        root = self.config.uocr2_dir
        present = []
        missing: list[str] = []
        for name in REQUIRED_FILES:
            if (root / name).exists():
                present.append(name)
            else:
                missing.append(name)
        shards = sorted(root.glob("model-*.safetensors"))
        ready = not missing and len(shards) >= 1
        if ready:
            message = "Original Unlimited-OCR-2 weights ready · Safetensors BF16"
        elif not root.exists():
            message = "Unlimited-OCR-2 weights are not downloaded yet."
        elif shards and missing:
            message = "The Unlimited-OCR-2 download is incomplete."
        else:
            message = "Unlimited-OCR-2 weights are missing."
        return {
            "ready": ready,
            "dir": str(root),
            "files": present,
            "missing": missing,
            "shards": [shard.name for shard in shards],
            "message": message,
            "download_command": (
                None if ready else self.config.download_models_command + " --model uocr2"
            ),
        }

    def status_model(self) -> EngineStatus:
        ready = self.weights_status()["ready"]
        return EngineStatus(
            status=self.status,  # type: ignore[arg-type]
            port=None,
            pid=None,
            model=(
                "Unlimited-OCR-2 · original BF16"
                if ready
                else self.config.uocr2_dir.name
            ),
            backend=self._backend_label(),
            started_at=self.started_at,
            last_error=self.last_error,
            log_tail=self.log_tail(30),
            engine_type=self.engine_type,  # type: ignore[call-arg]
            device=self.device_name,  # type: ignore[call-arg]
            ready=ready,  # type: ignore[call-arg]
        )

    def _backend_label(self) -> str:
        if self.status == "ready" and self.device_name:
            return f"Transformers · {self.device_name.upper()}"
        return "Transformers · unlimited-ocr-2"

    def available(self) -> bool:
        """True when the weights, torch, and transformers are all usable."""
        if not self.weights_status().get("ready"):
            return False
        try:
            import torch  # noqa: F401
            import transformers  # noqa: F401
        except Exception:
            return False
        return True

    def log_tail(self, lines: int = 80) -> list[str]:
        if not self.log_path.exists():
            return []
        try:
            with self.log_path.open("rb") as handle:
                handle.seek(0, os.SEEK_END)
                size = handle.tell()
                handle.seek(max(0, size - 24_000))
                data = handle.read().decode("utf-8", "replace")
            return [line for line in data.splitlines() if line.strip()][-lines:]
        except OSError:
            return []

    def version(self) -> str | None:
        if self._torch is not None:
            return f"torch {self._torch.__version__}"
        try:
            import torch

            return f"torch {torch.__version__}"
        except Exception:
            return None

    # ------------------------------------------------------------------ loading
    def _check_weights(self) -> None:
        status = self.weights_status()
        if not status["ready"]:
            self.status = "error"
            self.last_error = status["message"]
            raise ModelMissingError(
                status["message"], hint=status["download_command"]
            )

    def _resolve_device(self, torch: Any) -> str:
        preferred = (self.config.uocr2_device or "auto").lower()
        if preferred == "cuda":
            if not torch.cuda.is_available():
                raise EngineUnavailableError(
                    "CUDA was requested but no CUDA device is available.",
                    hint="Install a CUDA-enabled PyTorch build, or set the device to Auto or CPU.",
                )
            return "cuda"
        if preferred == "mps":
            if not (hasattr(torch.backends, "mps") and torch.backends.mps.is_available()):
                raise EngineUnavailableError(
                    "MPS was requested but Metal is not available on this machine.",
                    hint="Set the device to Auto or CPU in Settings.",
                )
            return "mps"
        if preferred == "cpu":
            return "cpu"
        if torch.cuda.is_available():
            return "cuda"
        if hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            return "mps"
        return "cpu"

    def _patched_model_dir(self) -> Path:
        """A copy of the downloaded repo with device-agnostic remote code.

        The copy is made once, then patched in place on every start. Patching
        is idempotent, so a stale copy from an earlier version (or one whose
        marker was lost) is repaired instead of being trusted blindly.
        """
        source = self.config.uocr2_dir
        target = self.config.data_dir / "uocr2-patched"
        marker = target / ".patched"
        needs_copy = not (target / "config.json").exists()
        if needs_copy:
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(
                source, target, ignore=shutil.ignore_patterns("wheel", "assets", "*.whl")
            )

        patched: list[str] = []
        # Baidu's remote code hard-codes .cuda() in two masked_scatter_ calls.
        # Replace any .cuda() on a tensor expression with a device move that
        # follows the tensor it is scattered into. A plain string match missed
        # variants, so this is a regex over the whole call.
        cuda_pattern = re.compile(
            r"(images_seq_mask\[\s*\w+\s*\]\.unsqueeze\(-1\))\.cuda\(\)"
        )
        for path in sorted(target.rglob("*.py")):
            text = path.read_text(encoding="utf-8")
            updated = cuda_pattern.sub(r"\1.to(inputs_embeds.device)", text)
            if updated != text:
                path.write_text(updated, encoding="utf-8")
                patched.append(path.name)

        if marker.exists() and not patched:
            return target
        marker.write_text(
            ",".join(patched) or "already patched", encoding="utf-8"
        )
        self._log(
            "[patch] %s %s (%s)",
            "prepared" if needs_copy else "repaired",
            target,
            ", ".join(patched) or "no changes",
        )
        return target

    def _log(self, message: str, *args: Any) -> None:
        text = message % args if args else message
        logger.info(text)
        try:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with self.log_path.open("a", encoding="utf-8") as handle:
                handle.write(f"{iso_now()} {text}\n")
        except OSError:
            pass

    async def ensure_ready(self) -> None:
        if self.status == "ready" and self._model is not None:
            return
        async with self._lock:
            if self.status == "ready" and self._model is not None:
                return
            await self.start()

    async def ensure_started(self) -> None:
        """Alias so the job worker can drive either engine through one call.

        ``LlamaEngine`` exposes ``ensure_started``; the worker only knows that
        name. Without this alias every Unlimited-OCR-2 job died with an
        AttributeError before the first page.
        """
        await self.ensure_ready()

    async def start(self) -> None:
        async with self._lock:
            if self._model is not None:
                self.status = "ready"
                self.last_error = None
                return
            self._check_weights()
            self.status = "starting"
            self.last_error = None
            started = asyncio.get_running_loop().time()
            try:
                device = await asyncio.to_thread(self._load)
            except ModelMissingError:
                self.status = "error"
                raise
            except Exception as exc:
                self.status = "error"
                self.last_error = str(exc) or exc.__class__.__name__
                self._log("[load] failed: %s", self.last_error)
                raise EngineUnavailableError(
                    f"Unlimited-OCR-2 could not be loaded: {self.last_error}",
                    hint=(
                        "The model needs about 8 GB of free GPU/unified memory. "
                        "Quit other GPU apps, choose a smaller device in Settings, or switch to CPU."
                    ),
                ) from exc
            self.status = "ready"
            self.device_name = device
            self.started_at = iso_now()
            self.load_seconds = round(asyncio.get_running_loop().time() - started, 1)
            self._log("[load] ready on %s in %.1fs", device, self.load_seconds)

    def _load(self) -> str:
        try:
            import torch
            from transformers import AutoModel, AutoTokenizer
        except Exception as exc:
            raise EngineUnavailableError(
                f"The inference stack is not installed ({exc}).", hint=TORCH_IMPORT_HINT
            ) from exc

        self._torch = torch
        torch.set_grad_enabled(False)
        device = self._resolve_device(torch)
        # BF16 is the checkpoint's native dtype and is fast on CUDA and Metal.
        # CPUs generally lack BF16 acceleration (and some builds reject it), so
        # fall back to FP32 there.
        dtype = torch.float32 if device == "cpu" else torch.bfloat16
        model_dir = self._patched_model_dir()
        self._log(
            "[load] tokenizer + model from %s on %s (%s)",
            model_dir,
            device,
            str(dtype).replace("torch.", ""),
        )

        tokenizer = AutoTokenizer.from_pretrained(
            str(model_dir), trust_remote_code=True, local_files_only=True
        )
        model = AutoModel.from_pretrained(
            str(model_dir),
            trust_remote_code=True,
            local_files_only=True,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        model = model.eval().to(device)
        self._tokenizer = tokenizer
        self._model = model
        return device

    async def stop(self) -> None:
        async with self._lock:
            self._model = None
            self._tokenizer = None
            # Release cached GPU memory on both CUDA and Metal so a restart or
            # an engine switch does not leave the device reserved.
            torch = self._torch
            if torch is not None:
                try:
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                    if hasattr(torch.backends, "mps"):
                        torch.mps.empty_cache()
                except Exception:
                    pass
            self.status = "stopped"
            self.device_name = None
            self.started_at = None
            self._log("[stop] unloaded")

    async def restart(self) -> None:
        await self.stop()
        await self.start()

    # --------------------------------------------------------------- inference
    async def ocr(
        self,
        *,
        image_paths: list[str],
        prompt: str,
        max_tokens: int,
        temperature: float = 0.0,
        on_delta: DeltaCallback | None = None,
        cancel_check: CancelCheck | None = None,
        crop_mode: bool | None = None,
    ) -> GenerationResult:
        await self.ensure_ready()
        if self._model is None or self._tokenizer is None:
            raise EngineUnavailableError("Unlimited-OCR-2 is not ready.")

        started = asyncio.get_running_loop().time()
        self._cancel_check = cancel_check
        guard = self._install_cancel_guard()
        prompt = self._adapt_prompt(prompt, len(image_paths))
        try:
            result = await asyncio.to_thread(
                self._run_infer,
                image_paths,
                prompt,
                max_tokens,
                temperature,
                crop_mode,
            )
        except GenerationCanceled:
            # Cooperative cancellation: the decode loop raised through the
            # guarded LM head. Anything produced so far is discarded.
            self._log("[ocr] canceled after %.0fms", (asyncio.get_running_loop().time() - started) * 1000)
            return GenerationResult(
                "",
                finish_reason="canceled",
                prompt_tokens=None,
                completion_tokens=0,
                duration_ms=int((asyncio.get_running_loop().time() - started) * 1000),
                canceled=True,
            )
        except Exception as exc:
            message = str(exc) or exc.__class__.__name__
            if "out of memory" in message.lower() or "mps" in message.lower():
                hint = (
                    "The model ran out of unified memory. Close other GPU-heavy apps, "
                    "lower the DPI or the token budget, or switch the device to CPU."
                )
            else:
                hint = "Open data/logs/transformers.log for the engine output."
            raise EngineUnavailableError(
                f"Unlimited-OCR-2 failed on this page: {message}", hint=hint
            ) from exc
        finally:
            if guard is not None:
                guard()
            self._cancel_check = None

        text = result.get("text") or ""
        prompt_tokens = len(result.get("prompt_token_ids") or []) or None
        completion_tokens = len(result.get("token_ids") or []) or 0
        finish_reason = result.get("finish_reason")

        if on_delta and text:
            # The model's own generate() is not incremental, so replay the text
            # in small chunks to keep the live view honest.
            chunk = max(40, min(240, len(text) // 24 or 40))
            for index in range(0, len(text), chunk):
                if cancel_check and cancel_check():
                    break
                outcome = on_delta(text[index : index + chunk])
                if asyncio.iscoroutine(outcome):
                    await outcome
                if index + chunk < len(text):
                    await asyncio.sleep(0.02)

        return GenerationResult(
            text,
            finish_reason=finish_reason,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            duration_ms=int((asyncio.get_running_loop().time() - started) * 1000),
        )

    def _run_infer(
        self,
        image_paths: list[str],
        prompt: str,
        max_tokens: int,
        temperature: float,
        crop_mode: bool | None,
    ) -> dict[str, Any]:
        model = self._model
        tokenizer = self._tokenizer
        if model is None or tokenizer is None:
            raise EngineUnavailableError("Unlimited-OCR-2 is not ready.")

        # The worker hands over paths relative to data_dir (that is what the
        # llama.cpp engine expects). This engine opens them directly with PIL,
        # so resolve them against data_dir first and fall back to the path as
        # given for absolute inputs.
        paths = [str(self._resolve_image_path(path)) for path in image_paths]
        kwargs: dict[str, Any] = {
            "max_new_tokens": int(max_tokens),
            "temperature": float(temperature),
            "return_dict": True,
            "eval_mode": True,  # no TextStreamer; we publish deltas ourselves
            "page_count_guard": len(paths) > 1,
            # Unlimited-OCR-2 is trained with this n-gram guard; without it the
            # decode loop collapses into a repeat of the first block.
            "no_repeat_ngram_size": 35,
            "ngram_window": 1024 if len(paths) > 1 else 128,
        }
        if crop_mode is not None:
            kwargs["crop_mode"] = crop_mode
        if len(paths) == 1:
            return model.infer(
                tokenizer, prompt=prompt, image_file=paths[0], **kwargs
            )
        return model.infer(
            tokenizer,
            prompt=prompt or "Multi page parsing.",
            image_file=paths,
            **kwargs,
        )

    def _adapt_prompt(self, prompt: str, page_count: int) -> str:
        """Translate the studio's layout prompt into Unlimited-OCR-2's own.

        The studio's default layout prompt is ``document parsing.`` — that is
        Unlimited-OCR-1's trigger phrase. Unlimited-OCR-2 was trained on
        ``Multi page parsing.`` and, given the older phrase, drifts into a
        repeat of the first block instead of parsing the page. A custom prompt
        the user typed is passed through untouched.
        """
        cleaned = (prompt or "").strip()
        normalised = cleaned.rstrip(".").strip().lower()
        if normalised in {"document parsing", "document parsing."}:
            return "Multi page parsing."
        if not cleaned:
            return "Multi page parsing."
        return cleaned

    def _resolve_image_path(self, path: str) -> Path:
        resolved = resolve_data_path(self.config.data_dir, path)
        assert resolved is not None
        return resolved

    def _install_cancel_guard(self) -> Callable[[], None] | None:
        """Make cancellation interrupt the decode loop.

        Baidu's ``_uocr_generate`` calls ``self.lm_head(h)`` once for every
        generated token, so guarding the head gives us a cooperative stop.
        """
        model = self._model
        if model is None or not hasattr(model, "lm_head"):
            return None
        head = model.lm_head
        original = head.forward
        engine = self

        def guarded(*args: Any, **kwargs: Any) -> Any:
            check = engine._cancel_check
            if check and check():
                raise GenerationCanceled()
            return original(*args, **kwargs)

        try:
            head.forward = guarded  # type: ignore[method-assign]
        except Exception:  # pragma: no cover - extremely defensive
            return None

        def restore() -> None:
            try:
                del head.forward  # type: ignore[attr-defined]
            except Exception:
                head.forward = original  # type: ignore[method-assign]

        return restore

    # ------------------------------------------------------------------ helpers
    def memory_footprint(self) -> dict[str, Any]:
        if self._torch is None or self._model is None:
            return {"loaded": False}
        try:
            import psutil

            params = sum(p.numel() * p.element_size() for p in self._model.parameters())
            return {
                "loaded": True,
                "weights_bytes": params,
                "weights_gb": round(params / 1e9, 2),
                "device": self.device_name,
                "system_available_gb": round(psutil.virtual_memory().available / 1e9, 2),
            }
        except Exception:  # pragma: no cover
            return {"loaded": True, "device": self.device_name}

    def environment(self) -> dict[str, Any]:
        info: dict[str, Any] = {
            "weights": self.weights_status(),
            "device": self.config.uocr2_device,
            "python": sys.version.split()[0],
            "torch": self.version(),
            "cuda_available": False,
            "mps_available": False,
        }
        try:
            import torch

            info["cuda_available"] = bool(torch.cuda.is_available())
            info["mps_available"] = bool(
                hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
            )
            if info["cuda_available"]:
                info["cuda_device"] = torch.cuda.get_device_name(0)
        except Exception:
            pass
        info["loaded"] = self.memory_footprint()
        return info


def huggingface_cli() -> str | None:
    import shutil

    return shutil.which("huggingface-cli") or shutil.which("hf")


def preflight_download_command(config: Settings) -> str:
    return config.download_models_command + " --model uocr2"


def prune_partial_download(config: Settings) -> None:
    """Remove a half-finished download folder so retries start clean."""
    root = config.uocr2_dir
    if not root.exists():
        return
    shards = sorted(root.glob("model-*.safetensors"))
    if shards:
        return
    shutil.rmtree(root, ignore_errors=True)
