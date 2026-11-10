import { cn } from '@/lib/utils'

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 40 40"
      aria-hidden
      className={cn('size-9', className)}
      fill="none"
    >
      <rect width="40" height="40" rx="10" fill="currentColor" />
      <path
        d="M10.5 12.5h19M10.5 20h13M10.5 27.5h19"
        stroke="var(--sidebar)"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <circle cx="29" cy="20" r="3.6" fill="var(--primary)" />
    </svg>
  )
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <LogoMark className="size-9 text-sidebar-foreground" />
      {!compact && (
        <div className="min-w-0 leading-none">
          <div className="truncate text-[0.95rem] font-semibold tracking-[-0.02em] text-sidebar-foreground">
            Unlimited OCR
          </div>
          <div className="mt-1.5 text-[0.58rem] font-bold tracking-[0.24em] text-sidebar-muted uppercase">
            Local studio
          </div>
        </div>
      )}
    </div>
  )
}
