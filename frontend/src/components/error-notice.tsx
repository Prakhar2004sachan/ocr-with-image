import type { ReactNode } from 'react'
import { AlertCircle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface ErrorNoticeProps {
  title?: string
  message: string
  hint?: string | null
  code?: string | null
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
  compact?: boolean
}

export function ErrorNotice({
  title = 'Something went wrong',
  message,
  hint,
  code,
  onRetry,
  onDismiss,
  className,
  compact,
}: ErrorNoticeProps) {
  return (
    <div
      role="alert"
      className={cn(
        'relative flex gap-3 rounded-xl border border-destructive/25 bg-destructive/[0.055] text-destructive',
        compact ? 'px-3.5 py-3' : 'p-4',
        className,
      )}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="text-[0.82rem] font-semibold">{title}</div>
        <p className="mt-0.5 text-[0.82rem] leading-relaxed text-destructive/85">{message}</p>
        {hint && <p className="mt-1 text-[0.76rem] leading-relaxed text-destructive/70">{hint}</p>}
        {(onRetry || onDismiss) && (
          <div className="mt-2.5 flex items-center gap-2">
            {onRetry && (
              <Button
                size="sm"
                variant="outline"
                onClick={onRetry}
                className="h-7 border-destructive/30 bg-transparent px-2.5 text-destructive hover:bg-destructive/10"
              >
                <RotateCw /> Try again
              </Button>
            )}
            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                className="text-[0.72rem] font-semibold text-destructive/70 underline-offset-2 hover:underline"
              >
                Dismiss
              </button>
            )}
          </div>
        )}
      </div>
      {code && <span className="sr-only">Error code {code}</span>}
    </div>
  )
}

export function WarningNotice({
  children,
  className,
  icon,
}: {
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border border-warning/25 bg-warning/[0.07] px-3.5 py-2.5 text-[0.8rem] leading-relaxed text-warning',
        className,
      )}
    >
      {icon ?? <AlertCircle className="mt-0.5 size-3.5 shrink-0" />}
      <div className="min-w-0">{children}</div>
    </div>
  )
}
