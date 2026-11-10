import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock3,
  Loader2,
  MinusCircle,
  XCircle,
} from 'lucide-react'
import type { JobStatus, PageStatus } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

export const jobStatusMeta: Record<
  JobStatus,
  {
    label: string
    variant: 'default' | 'secondary' | 'outline' | 'primary' | 'success' | 'warning' | 'destructive' | 'info'
    className: string
  }
> = {
  queued: { label: 'Queued', variant: 'outline', className: 'text-muted-foreground' },
  preparing: { label: 'Preparing', variant: 'info', className: '' },
  running: { label: 'Running', variant: 'primary', className: '' },
  completed: { label: 'Completed', variant: 'success', className: '' },
  partial: { label: 'Partial', variant: 'warning', className: '' },
  failed: { label: 'Failed', variant: 'destructive', className: '' },
  canceled: { label: 'Canceled', variant: 'secondary', className: '' },
}

export const pageStatusMeta: Record<PageStatus, { label: string }> = {
  pending: { label: 'Pending' },
  running: { label: 'Reading' },
  completed: { label: 'Read' },
  failed: { label: 'Failed' },
  skipped: { label: 'Skipped' },
}

export function StatusIcon({ status, className }: { status: PageStatus; className?: string }) {
  if (status === 'running') return <Loader2 className={cn('size-3.5 animate-spin text-info', className)} />
  if (status === 'completed') return <CheckCircle2 className={cn('size-3.5 text-success', className)} />
  if (status === 'failed') return <XCircle className={cn('size-3.5 text-destructive', className)} />
  if (status === 'skipped') return <MinusCircle className={cn('size-3.5 text-muted-foreground', className)} />
  return <Clock3 className={cn('size-3.5 text-muted-foreground/70', className)} />
}

export function JobStatusBadge({ status, className }: { status: JobStatus; className?: string }) {
  const meta = jobStatusMeta[status]
  return (
    <Badge variant={meta.variant} className={cn(meta.className, className)}>
      {status === 'running' || status === 'preparing' ? (
        <Loader2 className="animate-spin" />
      ) : status === 'completed' ? (
        <CheckCircle2 />
      ) : status === 'failed' ? (
        <AlertTriangle />
      ) : status === 'canceled' ? (
        <Ban />
      ) : (
        <Clock3 />
      )}
      {meta.label}
    </Badge>
  )
}
