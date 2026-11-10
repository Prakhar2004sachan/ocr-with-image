import { useState } from 'react'
import { Check, Copy, RefreshCw, Terminal, WifiOff } from 'lucide-react'
import { copyText } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/logo'
import { localPlatformLabel, localStartCommand } from '@/lib/platform'

export function SplashScreen() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-5 bg-sidebar">
      <div className="relative">
        <LogoMark className="size-14 text-sidebar-foreground" />
        <span className="absolute -inset-3 -z-10 animate-pulse rounded-2xl bg-primary/15 blur-xl" />
      </div>
      <div className="text-center">
        <div className="text-sm font-semibold tracking-tight text-sidebar-foreground">
          Unlimited OCR Studio
        </div>
        <div className="mt-1 text-xs text-sidebar-muted">Waking the local engine…</div>
      </div>
      <div className="h-0.5 w-32 overflow-hidden rounded-full bg-sidebar-border">
        <div className="h-full w-1/2 animate-[shimmer_1.4s_linear_infinite] rounded-full bg-primary" />
      </div>
    </div>
  )
}

export function OfflineScreen({
  message,
  onRetry,
  retrying,
}: {
  message?: string
  onRetry: () => void
  retrying: boolean
}) {
  const [copied, setCopied] = useState(false)
  const startCommand = localStartCommand()
  const platform = localPlatformLabel()

  const copy = async () => {
    if (await copyText(startCommand)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    }
  }

  return (
    <div className="relative flex min-h-svh items-center justify-center overflow-hidden bg-sidebar px-6 py-16">
      <div className="pointer-events-none absolute inset-0 opacity-30">
        <div className="absolute -top-40 left-1/2 size-[600px] -translate-x-1/2 rounded-full bg-primary/20 blur-[120px]" />
        <div className="absolute right-0 bottom-0 size-[420px] rounded-full bg-[#6d5a2a]/20 blur-[100px]" />
      </div>

      <div className="relative w-full max-w-xl">
        <div className="flex items-center gap-3">
          <LogoMark className="size-11 text-sidebar-foreground" />
          <div>
            <div className="text-sm font-semibold text-sidebar-foreground">Unlimited OCR Studio</div>
            <div className="text-[0.62rem] font-bold tracking-[0.22em] text-sidebar-muted uppercase">
              Local inference
            </div>
          </div>
        </div>

        <div className="mt-10 flex size-12 items-center justify-center rounded-2xl border border-sidebar-border bg-sidebar-accent text-[#e0a04b]">
          <WifiOff className="size-5" />
        </div>
        <h1 className="font-display mt-5 text-4xl text-sidebar-foreground sm:text-5xl">
          The backend is off.
        </h1>
        <p className="mt-3 max-w-md text-sm leading-relaxed text-sidebar-muted">
          {message ||
            `The studio could not reach the local Python server. Start it in a terminal, then try again. Nothing ever leaves this ${platform === 'macOS' ? 'Mac' : 'device'}.`}
        </p>

        <div className="mt-7 overflow-hidden rounded-xl border border-sidebar-border bg-[#0b0a07]">
          <div className="flex items-center justify-between border-b border-sidebar-border/70 px-4 py-2.5">
            <div className="flex items-center gap-2 text-[0.64rem] font-bold tracking-[0.16em] text-sidebar-muted uppercase">
              <Terminal className="size-3.5" /> Start the studio
            </div>
            <button
              type="button"
              onClick={copy}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.68rem] font-semibold text-sidebar-muted transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-[0.72rem] leading-relaxed text-[#d8d1c2]">
            {startCommand}
          </pre>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button onClick={onRetry} disabled={retrying} className="bg-[#f0e9db] text-[#17140f] hover:bg-white">
            <RefreshCw className={retrying ? 'animate-spin' : undefined} />
            {retrying ? 'Reconnecting…' : 'Try again'}
          </Button>
          <span className="text-xs text-sidebar-muted">
            Or use <code className="rounded bg-sidebar-accent px-1.5 py-0.5 text-[0.7rem]">{startCommand}</code>
          </span>
        </div>

        <p className="mt-10 max-w-md text-[0.7rem] leading-relaxed text-sidebar-muted/60">
          This screen appears when <code>/api/health</code> does not answer on
          <code className="ml-1">127.0.0.1:8000</code>. The frontend itself is still running.
        </p>
      </div>
    </div>
  )
}
