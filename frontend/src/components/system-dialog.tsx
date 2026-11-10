import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Check,
  Copy,
  Cpu,
  Database,
  HardDrive,
  MemoryStick,
  RefreshCw,
  Terminal,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, copyText, ApiError } from '@/lib/api'
import { formatBytes, formatDateTime } from '@/lib/format'
import { platformName } from '@/lib/platform'
import type { Health } from '@/lib/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EngineControl } from '@/components/engine-control'
import { ErrorNotice } from '@/components/error-notice'
import { Skeleton } from '@/components/ui/skeleton'

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 text-[0.8rem]">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right font-medium text-foreground" title={value}>
        {value}
      </span>
    </div>
  )
}

export function SystemDialog({
  open,
  onOpenChange,
  health,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  health: Health
}) {
  const [tab, setTab] = useState('overview')
  const [logTarget, setLogTarget] = useState<'engine' | 'backend'>('engine')
  const [logLines, setLogLines] = useState('300')
  const [copied, setCopied] = useState(false)

  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: api.diagnostics,
    enabled: open,
    staleTime: 5000,
  })

  const logs = useQuery({
    queryKey: ['logs', logTarget, logLines],
    queryFn: () => api.logs(logTarget, Number(logLines)),
    enabled: open && tab === 'logs',
    staleTime: 0,
  })

  const copyReport = async () => {
    const report = JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        health,
        diagnostics: diagnostics.data ?? null,
      },
      null,
      2,
    )
    if (await copyText(report)) {
      setCopied(true)
      toast.success('Diagnostics copied')
      window.setTimeout(() => setCopied(false), 1800)
    } else {
      toast.error('Could not copy diagnostics')
    }
  }

  const model = health.model.model
  const mmproj = health.model.mmproj
  const system = health.system
  const data = diagnostics.data

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-normal">System & engine</DialogTitle>
          <DialogDescription>
            The studio runs entirely on {platformName(health.system)}. Inspect the loaded model,
            memory, and engine logs here.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="mt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="logs">
                <Terminal /> Logs
              </TabsTrigger>
            </TabsList>
            <Button size="sm" variant="outline" onClick={copyReport}>
              {copied ? <Check /> : <Copy />}
              Copy report
            </Button>
          </div>

          <TabsContent value="overview" className="mt-4 space-y-4">
            <EngineControl health={health} />

            {!health.model.ready && (
              <ErrorNotice
                title="Model files are missing"
                message={health.model.message}
                hint={
                  health.model.download_command
                    ? `Run ${health.model.download_command} from the project root, then restart the backend.`
                    : undefined
                }
              />
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-[0.7rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  <Database className="size-3.5" /> Model
                </div>
                <div className="mt-3 space-y-2.5">
                  {[
                    { label: 'Weights', file: model },
                    ...(mmproj ? [{ label: 'Vision projector', file: mmproj }] : []),
                  ].map(({ label, file }) => (
                    <div key={label} className="rounded-lg border border-border/70 bg-background/45 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[0.72rem] font-semibold text-muted-foreground">{label}</span>
                        <Badge variant={file?.exists ? 'success' : 'destructive'}>
                          {file?.exists ? 'Ready' : 'Missing'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 truncate font-mono text-[0.72rem] text-foreground" title={file?.path}>
                        {file?.name ?? '—'}
                      </div>
                      <div className="mt-0.5 text-[0.7rem] text-muted-foreground">
                        {formatBytes(file?.size)}
                      </div>
                    </div>
                  ))}
                </div>
                <Separator className="my-3" />
                <SpecRow label="Backend" value={health.engine.backend} />
                <SpecRow label="Port" value={health.engine.port ? String(health.engine.port) : '—'} />
                <SpecRow label="PID" value={health.engine.pid ? String(health.engine.pid) : '—'} />
                <SpecRow label="Started" value={formatDateTime(health.engine.started_at)} />
              </div>

              <div className="rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-[0.7rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  <Cpu className="size-3.5" /> This device
                </div>
                <div className="mt-2 divide-y divide-border/60">
                  <SpecRow label="Platform" value={`${system.platform} · ${system.machine}`} />
                  <SpecRow label="CPU cores" value={String(system.cpu_count)} />
                  <SpecRow
                    label="Memory"
                    value={`${formatBytes(system.available_ram)} free of ${formatBytes(system.total_ram)}`}
                  />
                  <SpecRow
                    label="Disk"
                    value={`${formatBytes(system.disk_free)} free of ${formatBytes(system.disk_total)}`}
                  />
                  <SpecRow label="Python" value={system.python} />
                  <SpecRow label="Accelerator" value={system.accelerator ?? 'CPU'} />
                  <SpecRow
                    label="llama.cpp"
                    value={
                      health.engine.engine_type === 'llama_cpp'
                        ? (system.llama_version ?? 'Not detected')
                        : 'Not in use'
                    }
                  />
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-[0.72rem] text-muted-foreground">
                  <MemoryStick className="size-3.5 shrink-0" />
                  Inference shares memory with every other app on this device.
                </div>
              </div>
            </div>

            {data && (
              <div className="rounded-xl border border-border/80 bg-card/50 p-4">
                <div className="flex items-center gap-2 text-[0.7rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                  <HardDrive className="size-3.5" /> Paths
                </div>
                <div className="mt-2 divide-y divide-border/60">
                  <SpecRow label="Data" value={data.data_dir} />
                  <SpecRow label="Models" value={data.models_dir} />
                  <SpecRow label="Database" value={data.db_path} />
                  <SpecRow label="Engine log" value={data.log_path} />
                </div>
              </div>
            )}

            {diagnostics.isError && (
              <ErrorNotice
                compact
                title="Could not load diagnostics"
                message={
                  diagnostics.error instanceof ApiError
                    ? diagnostics.error.message
                    : 'The diagnostics endpoint did not respond.'
                }
                onRetry={() => void diagnostics.refetch()}
              />
            )}
            {diagnostics.isLoading && <Skeleton className="h-28 w-full" />}
          </TabsContent>

          <TabsContent value="logs" className="mt-4">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <Select value={logTarget} onValueChange={(value) => setLogTarget(value as 'engine' | 'backend')}>
                <SelectTrigger className="h-8 w-40 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="engine">Engine log</SelectItem>
                  <SelectItem value="backend">Backend log</SelectItem>
                </SelectContent>
              </Select>
              <Select value={logLines} onValueChange={setLogLines}>
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="120">120 lines</SelectItem>
                  <SelectItem value="300">300 lines</SelectItem>
                  <SelectItem value="800">800 lines</SelectItem>
                  <SelectItem value="2000">2000 lines</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                onClick={() => void logs.refetch()}
                disabled={logs.isFetching}
              >
                <RefreshCw className={logs.isFetching ? 'animate-spin' : undefined} />
                Refresh
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (await copyText(logs.data ?? '')) toast.success('Log copied')
                  else toast.error('Could not copy log')
                }}
                disabled={!logs.data}
              >
                <Copy /> Copy
              </Button>
            </div>
            {logs.isError && (
              <ErrorNotice
                compact
                message="Could not load the log file."
                onRetry={() => void logs.refetch()}
              />
            )}
            <pre className="thin-scrollbar max-h-[52vh] min-h-52 overflow-auto rounded-xl border border-border/80 bg-[#12100b] p-4 font-mono text-[0.72rem] leading-relaxed text-[#d8d1c2] whitespace-pre-wrap">
              {logs.isLoading ? 'Loading log…' : (logs.data || 'No log output yet.')}
            </pre>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
