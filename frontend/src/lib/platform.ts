import type { EngineFacts, Health, SystemInfo, Uocr2Device } from './types'

export type PlatformKind = 'mac' | 'windows' | 'linux' | 'other'

export function platformKind(system?: Pick<SystemInfo, 'platform' | 'platform_label'> | null): PlatformKind {
  const raw = `${system?.platform_label ?? ''} ${system?.platform ?? ''}`.toLowerCase()
  if (raw.includes('mac') || raw.includes('darwin')) return 'mac'
  if (raw.includes('win')) return 'windows'
  if (raw.includes('linux')) return 'linux'
  return 'other'
}

export function platformName(system?: Pick<SystemInfo, 'platform' | 'platform_label'> | null): string {
  const kind = platformKind(system)
  if (kind === 'mac') return 'macOS'
  if (kind === 'windows') return 'Windows'
  if (kind === 'linux') return 'Linux'
  return system?.platform_label || system?.platform || 'this device'
}

/** Short accelerator name from the backend, with a platform-aware fallback. */
export function acceleratorName(health?: Health | null): string {
  return (
    health?.system.accelerator ??
    (platformKind(health?.system) === 'mac' ? 'Metal' : 'GPU')
  )
}

export function engineLabel(health?: Health | null): string {
  return health?.system.engine_label ?? health?.engine.backend ?? 'local engine'
}

/** The modifier hint shown for paste shortcuts. */
export function pasteShortcut(system?: Pick<SystemInfo, 'platform' | 'platform_label'> | null): string {
  return platformKind(system) === 'mac' ? '⌘V' : 'Ctrl+V'
}

export function startCommand(system?: Pick<SystemInfo, 'platform' | 'platform_label'> | null): string {
  return platformKind(system) === 'windows'
    ? 'scripts\\start.cmd'
    : 'python3 scripts/start.py'
}

export function stopCommand(system?: Pick<SystemInfo, 'platform' | 'platform_label'> | null): string {
  return platformKind(system) === 'windows'
    ? 'scripts\\stop.cmd'
    : 'python3 scripts/stop.py'
}

export interface DeviceOption {
  value: Uocr2Device
  label: string
}

/**
 * Options that can actually work on the current machine. The backend reports
 * CUDA/MPS availability, so a Linux CUDA box never offers Metal and a Mac never
 * offers CUDA.
 */
export function deviceOptions(
  engines?: EngineFacts | null,
  current?: Uocr2Device,
): DeviceOption[] {
  const options: DeviceOption[] = [{ value: 'auto', label: 'Auto (GPU)' }]
  const transformers = engines?.transformers
  if (transformers?.cuda_available) options.push({ value: 'cuda', label: 'CUDA GPU' })
  if (transformers?.mps_available) options.push({ value: 'mps', label: 'Metal GPU' })
  options.push({ value: 'cpu', label: 'CPU' })
  // Keep a saved preference visible even on a machine that cannot use it yet,
  // so the user can see why a job is failing and switch deliberately.
  if (current && !options.some((option) => option.value === current)) {
    options.splice(1, 0, { value: current, label: current === 'cuda' ? 'CUDA GPU' : 'Metal GPU' })
  }
  return options
}

export function deviceHint(value: Uocr2Device, engines?: EngineFacts | null): string {
  if (value === 'cuda') return 'NVIDIA CUDA acceleration.'
  if (value === 'mps') return 'Apple Metal acceleration.'
  if (value === 'cpu') return 'Slower, but works on every machine.'
  if (engines?.transformers?.cuda_available) return 'Prefers CUDA, then Metal, then CPU.'
  if (engines?.transformers?.mps_available) return 'Prefers Metal, then CPU.'
  return 'Prefers the available GPU, then CPU.'
}


/** Detect the browser's OS before the backend has answered (offline screen). */
export function localPlatformLabel(): string {
  if (typeof navigator === 'undefined') return 'this device'
  const agent = `${navigator.userAgent} ${navigator.platform ?? ''}`.toLowerCase()
  if (agent.includes('win')) return 'Windows'
  if (agent.includes('mac')) return 'macOS'
  if (agent.includes('linux') || agent.includes('x11')) return 'Linux'
  return 'this device'
}

export function localStartCommand(): string {
  return localPlatformLabel() === 'Windows' ? 'scripts\\start.cmd' : 'python3 scripts/start.py'
}

export function localPasteShortcut(): string {
  return localPlatformLabel() === 'macOS' ? '⌘V' : 'Ctrl+V'
}
