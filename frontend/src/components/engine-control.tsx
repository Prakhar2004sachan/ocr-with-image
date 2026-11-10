import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Loader2, Power, RefreshCw, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError } from '@/lib/api'
import type { Health } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'

const statusCopy: Record<Health['engine']['status'], string> = {
  ready: 'Engine ready',
  starting: 'Warming up',
  stopped: 'Engine stopped',
  error: 'Engine error',
}

export function EngineControl({
  health,
  compact = false,
}: {
  health: Health
  compact?: boolean
}) {
  const queryClient = useQueryClient()
  const [confirmStop, setConfirmStop] = useState(false)
  const { engine, model } = health
  const activeJob = Boolean(health.active_job)

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['health'] })
    void queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
  }

  const start = useMutation({
    mutationFn: api.engineStart,
    onSuccess: () => {
      toast.success('Engine started', { description: 'Unlimited-OCR is loaded and ready.' })
      invalidate()
    },
    onError: (error) =>
      toast.error('Could not start the engine', {
        description: error instanceof ApiError ? error.message : 'Unknown engine error.',
      }),
  })

  const stop = useMutation({
    mutationFn: api.engineStop,
    onSuccess: () => {
      toast.success('Engine stopped')
      invalidate()
    },
    onError: (error) =>
      toast.error('Could not stop the engine', {
        description: error instanceof ApiError ? error.message : 'Unknown engine error.',
      }),
  })

  const restart = useMutation({
    mutationFn: api.engineRestart,
    onSuccess: () => {
      toast.success('Engine restarted')
      invalidate()
    },
    onError: (error) =>
      toast.error('Could not restart the engine', {
        description: error instanceof ApiError ? error.message : 'Unknown engine error.',
      }),
  })

  const pending = start.isPending || stop.isPending || restart.isPending

  return (
    <div className={cn('rounded-xl border border-border/80 bg-card/60', compact ? 'p-3.5' : 'p-4')}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="relative mt-1.5 flex size-2 shrink-0">
            <span
              className={cn(
                'absolute inline-flex size-full rounded-full',
                engine.status === 'ready' && 'animate-ping bg-success/50',
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-2 rounded-full',
                engine.status === 'ready'
                  ? 'bg-success'
                  : engine.status === 'starting'
                    ? 'bg-warning'
                    : engine.status === 'error'
                      ? 'bg-destructive'
                      : 'bg-muted-foreground/50',
              )}
            />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{statusCopy[engine.status]}</span>
              {activeJob && <Badge variant="info">Reading</Badge>}
              {health.queued_jobs > 0 && (
                <Badge variant="outline">{health.queued_jobs} queued</Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {engine.model ?? model.model?.name ?? 'No model loaded'}
              {engine.port ? ` · :${engine.port}` : ''}
            </p>
            {engine.last_error && (
              <p className="mt-1.5 text-xs leading-relaxed text-destructive">{engine.last_error}</p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {engine.status === 'ready' ? (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => restart.mutate()}
                disabled={pending || activeJob}
                title={activeJob ? 'Cancel the running job before restarting the engine.' : undefined}
              >
                {restart.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Restart
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirmStop(true)}
                disabled={pending}
                title="Stop the inference engine"
              >
                {stop.isPending ? <Loader2 className="animate-spin" /> : <Power />}
                Stop
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="default"
              onClick={() => start.mutate()}
              disabled={pending || !model.ready}
            >
              {pending ? <Loader2 className="animate-spin" /> : <Power />}
              Start engine
            </Button>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop the inference engine?"
        description={
          <>
            The model will be unloaded from memory. Jobs cannot run until you start it
            again.
            {activeJob && ' A job is active — cancel it first to avoid a failed run.'}
          </>
        }
        confirmLabel="Stop engine"
        destructive
        icon={<ShieldAlert />}
        onConfirm={async () => {
          await stop.mutateAsync().catch(() => undefined)
        }}
      />
    </div>
  )
}
