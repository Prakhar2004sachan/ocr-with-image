import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlignLeft,
  Archive,
  ArrowLeft,
  Braces,
  Check,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  FileQuestion,
  FileText,
  Loader2,
  MoreHorizontal,
  Radio,
  RotateCcw,
  Square,
  Timer,
  Trash2,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, copyText, downloadExport, fetchExportText } from '@/lib/api'
import {
  formatClock,
  formatDuration,
  formatNumber,
  formatRelative,
  jobTitle,
  percent,
} from '@/lib/format'
import type { ExportFormat, Job, JobPage } from '@/lib/types'
import { isActive } from '@/lib/job-options'
import { navigate } from '@/lib/router'
import { useJob, useJobStream, type StreamState } from '@/hooks/use-job'
import { useHealth } from '@/hooks/use-health'
import { supportsFigureExports } from '@/lib/version'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorNotice, WarningNotice } from '@/components/error-notice'
import { PageFigures } from '@/components/figure-crops'
import { JobStatusBadge, StatusIcon } from '@/components/status'
import { Markdown } from '@/components/markdown'
import { SourceView } from '@/components/source-view'

type ViewTab = 'result' | 'source' | 'raw'

const streamCopy: Record<StreamState, { label: string; className: string }> = {
  idle: { label: 'Polling', className: 'text-muted-foreground' },
  connecting: { label: 'Connecting', className: 'text-info' },
  open: { label: 'Live', className: 'text-success' },
  reconnecting: { label: 'Reconnecting', className: 'text-warning' },
  closed: { label: 'Complete', className: 'text-muted-foreground' },
}

function StreamBadge({ state }: { state: StreamState }) {
  const meta = streamCopy[state]
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-[0.66rem] font-semibold', meta.className)}>
      {state === 'open' ? (
        <span className="relative flex size-1.5">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/60" />
          <span className="relative inline-flex size-1.5 rounded-full bg-success" />
        </span>
      ) : state === 'reconnecting' ? (
        <Wifi className="size-3" />
      ) : state === 'connecting' ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <WifiOff className="size-3" />
      )}
      {meta.label}
    </span>
  )
}

function JobSkeleton() {
  return (
    <div className="space-y-5">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-24 w-full rounded-xl" />
      <div className="grid gap-5 xl:grid-cols-[220px_minmax(0,1fr)]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-[460px] rounded-xl" />
      </div>
    </div>
  )
}

function WaitingState({ page, job }: { page: JobPage; job: Job }) {
  const queued = job.status === 'queued'
  return (
    <div className="flex min-h-72 flex-col items-center justify-center px-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/60 text-muted-foreground">
        <Clock3 className="size-5" />
      </div>
      <div className="mt-4 text-sm font-semibold">
        {queued ? 'Waiting in the queue' : 'This page is in line'}
      </div>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
        {queued
          ? 'The local engine is finishing the job ahead. This page will start automatically.'
          : 'Pages are read one at a time. The filmstrip shows exactly where the engine is.'}
      </p>
      {queued && job.queue_position != null && (
        <Badge variant="outline" className="mt-3">
          Position {job.queue_position}
        </Badge>
      )}
      <span className="mt-4 font-mono text-[0.6rem] text-muted-foreground/50">
        page {page.page_number}
      </span>
    </div>
  )
}

function LiveOutput({
  text,
  page,
  batch,
  chars,
}: {
  text: string
  page: JobPage
  batch: boolean
  chars: number
}) {
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[0.72rem] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5 font-semibold text-info">
          <Loader2 className="size-3.5 animate-spin" />
          {batch ? 'Batch pass in progress' : 'Reading this page'}
        </span>
        <span className="text-border">·</span>
        <span>{formatNumber(chars)} characters streamed</span>
        {batch && (
          <Badge variant="info" className="ml-auto">
            one request · all pages
          </Badge>
        )}
      </div>
      {batch && (
        <p className="mb-3 text-[0.7rem] leading-relaxed text-muted-foreground">
          In batch mode the raw text spans every selected page and may include model page markers.
        </p>
      )}
      <div className="thin-scrollbar max-h-[56vh] overflow-auto rounded-xl border border-border/70 bg-[#fbf8f1] p-4 dark:bg-[#11100c]">
        <pre className="font-mono text-[0.74rem] leading-relaxed whitespace-pre-wrap text-foreground/90">
          {text}
          <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse bg-primary align-middle" />
        </pre>
      </div>
      <div className="mt-2 text-[0.62rem] text-muted-foreground/60">
        Page {page.page_number} · raw model stream
      </div>
    </div>
  )
}

function EmptyResult({
  title,
  body,
  onRetry,
}: {
  title: string
  body: string
  onRetry?: () => void
}) {
  return (
    <div className="flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <div className="flex size-11 items-center justify-center rounded-2xl border border-border/70 bg-muted/50 text-muted-foreground">
        <FileQuestion className="size-5" />
      </div>
      <div className="mt-3 text-sm font-semibold">{title}</div>
      <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">{body}</p>
      {onRetry && (
        <Button size="sm" variant="outline" className="mt-4" onClick={onRetry}>
          <RotateCcw /> Rerun job
        </Button>
      )}
    </div>
  )
}

function ProgressPanel({
  job,
  streamState,
  elapsed,
}: {
  job: Job
  streamState: StreamState
  elapsed: number
}) {
  const settled = job.completed_pages + job.failed_pages
  const pct = percent(settled, job.total_pages)
  const runningPage = job.pages.find((page) => page.status === 'running')
  const batch = job.options.batch_mode

  const title =
    job.status === 'queued'
      ? 'Waiting in the queue'
      : job.status === 'preparing'
        ? 'Preparing the press'
        : batch
          ? 'Batch pass in progress'
          : runningPage
            ? `Reading page ${runningPage.page_number}`
            : 'Reading'

  const subtitle =
    job.status === 'queued'
      ? job.queue_position
        ? `Position ${job.queue_position} in line. The engine will pick it up automatically.`
        : 'The engine will pick it up automatically.'
      : job.status === 'preparing'
        ? 'Loading the model and rendering the first page at full resolution.'
        : runningPage
          ? `${runningPage.upload_name} · page ${runningPage.page_number} of the document.`
          : 'The engine is finishing this job.'

  return (
    <div className="rounded-xl border border-border/80 bg-card px-4 py-4 shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-primary/20 bg-primary/[0.07] text-primary">
            <Loader2 className="size-4 animate-spin" />
            <span className="absolute inset-0 animate-ping rounded-full border border-primary/20" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[0.86rem] font-semibold">{title}</span>
              <Badge variant="outline" className="text-[0.56rem]">
                {job.engine ?? 'llama.cpp'}
              </Badge>
            </div>
            <p className="mt-0.5 truncate text-[0.72rem] text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-2">
            <Timer className="size-3.5 text-muted-foreground/60" />
            <span className="font-mono text-[1.05rem] font-semibold tabular-nums">
              {formatClock(elapsed)}
            </span>
          </div>
          <StreamBadge state={streamState} />
        </div>
      </div>

      <Progress value={batch && job.status === 'running' ? Math.max(pct, 8) : pct} className="mt-3.5" />
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[0.66rem] text-muted-foreground">
        <span>
          {settled} of {job.total_pages} pages settled
          {job.failed_pages > 0 && (
            <span className="ml-1 text-destructive">· {job.failed_pages} failed</span>
          )}
        </span>
        <span className="flex items-center gap-2">
          <span>{pct}%</span>
          <span className="text-border">·</span>
          <span>{job.options.dpi} DPI</span>
          <span className="text-border">·</span>
          <span>{batch ? 'batch' : 'per page'}</span>
        </span>
      </div>
    </div>
  )
}

export function JobView({ jobId }: { jobId: string }) {
  const queryClient = useQueryClient()
  const health = useHealth()
  const canBundle = supportsFigureExports(health.data?.version)
  const jobQuery = useJob(jobId)
  const job = jobQuery.data
  const active = job ? isActive(job.status) : false
  const { state: streamState, batchLive } = useJobStream(jobId, Boolean(job && active))

  const [selected, setSelected] = useState<number | null>(null)
  const [pinned, setPinned] = useState(false)
  const [tab, setTab] = useState<ViewTab>('result')
  const [copied, setCopied] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [now, setNow] = useState(Date.now())

  const runningPosition = job?.pages.find((page) => page.status === 'running')?.position ?? null

  useEffect(() => {
    setSelected(null)
    setPinned(false)
    setTab('result')
  }, [jobId])

  useEffect(() => {
    if (!job || job.pages.length === 0) return
    if (selected === null || !job.pages.some((page) => page.position === selected)) {
      setSelected(job.pages[0].position)
    }
  }, [job, selected])

  useEffect(() => {
    if (runningPosition !== null && !pinned) setSelected(runningPosition)
  }, [runningPosition, pinned])

  useEffect(() => {
    if (!active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [active])

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['jobs'] })
    void queryClient.invalidateQueries({ queryKey: ['health'] })
  }

  const cancel = useMutation({
    mutationFn: () => api.cancelJob(jobId),
    onSuccess: (updated) => {
      queryClient.setQueryData(['job', jobId], updated)
      toast.success('Cancel requested', {
        description: 'Completed pages are kept. The current page will stop after its next token.',
      })
      invalidate()
    },
    onError: (error) =>
      toast.error('Could not cancel this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const rerun = useMutation({
    mutationFn: () => api.rerunJob(jobId),
    onSuccess: (created) => {
      toast.success('Rerun queued')
      invalidate()
      navigate(`/jobs/${created.id}`)
    },
    onError: (error) =>
      toast.error('Could not rerun this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const remove = useMutation({
    mutationFn: () => api.deleteJob(jobId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['job', jobId] })
      invalidate()
      toast.success('Job deleted')
      navigate('/history')
    },
    onError: (error) =>
      toast.error('Could not delete this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const combinedMarkdown = useMemo(() => {
    if (!job) return ''
    return job.pages
      .filter((page) => page.output_clean)
      .map((page) => `## ${page.upload_name} — page ${page.page_number}\n\n${page.output_clean}`)
      .join('\n\n---\n\n')
  }, [job])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!job || job.pages.length < 2) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) return
      if (document.querySelector('[role="dialog"]')) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const index = job.pages.findIndex((page) => page.position === selected)
      const next = event.key === 'ArrowRight' ? index + 1 : index - 1
      const clamped = Math.max(0, Math.min(job.pages.length - 1, next))
      setPinned(true)
      setSelected(job.pages[clamped].position)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job, selected])

  if (jobQuery.isLoading) return <JobSkeleton />

  if (jobQuery.isError || !job) {
    const error = jobQuery.error
    const notFound = error instanceof ApiError && error.status === 404
    return (
      <div className="mx-auto max-w-lg animate-fade-up py-16 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl border border-border/80 bg-card text-muted-foreground">
          <FileQuestion className="size-5" />
        </div>
        <h1 className="font-display mt-5 text-3xl">
          {notFound ? 'This job has left the archive.' : 'The job could not be loaded.'}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {notFound
            ? 'It may have been deleted with its uploads. Your other jobs are still in history.'
            : error instanceof ApiError
              ? error.message
              : 'The backend did not return this job.'}
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate('/history')}
            aria-label="Back to history"
          >
            <ArrowLeft /> History
          </Button>
          {!notFound && (
            <Button onClick={() => void jobQuery.refetch()}>
              <RotateCcw /> Try again
            </Button>
          )}
        </div>
      </div>
    )
  }

  const page =
    job.pages.find((item) => item.position === selected) ??
    job.pages.find((item) => item.status === 'running') ??
    job.pages[0]
  const pageIndex = job.pages.findIndex((item) => item.position === page?.position)
  const startIso = job.started_at ?? job.created_at
  const elapsed =
    job.duration_ms ??
    (active ? Math.max(0, now - new Date(startIso).getTime()) : 0)
  const batchActive = job.options.batch_mode && active
  const liveText = batchActive ? batchLive : (page?.output_raw ?? '')
  const pageText = page?.output_clean ?? ''

  const handleExport = (format: ExportFormat, pagePosition?: number) => {
    const promise = downloadExport(job, format, pagePosition)
    void toast.promise(promise, {
      loading: 'Preparing export…',
      success: 'Export downloaded',
      error: (exportError) =>
        exportError instanceof ApiError ? exportError.message : 'Could not export this job.',
    })
  }

  const handleCopy = async (text: string, label = 'Page') => {
    if (!text) {
      toast.error('There is no text to copy yet')
      return
    }
    if (await copyText(text)) {
      setCopied(true)
      toast.success(`${label} copied`)
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      toast.error('Could not copy to the clipboard')
    }
  }

  const copyJobMarkdown = async () => {
    try {
      // Use the export endpoint so the copied Markdown matches the downloaded
      // file, including any embedded figure images.
      const markdown = await fetchExportText(job.id, 'md')
      await handleCopy(markdown, 'Job Markdown')
    } catch (error) {
      toast.error('Could not copy this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      })
    }
  }

  return (
    <div className="animate-fade-up">
      <button
        type="button"
        onClick={() => navigate('/history')}
        aria-label="Back to history"
        className="inline-flex items-center gap-1.5 text-[0.7rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> History
      </button>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="font-display truncate text-4xl leading-none tracking-[-0.02em] sm:text-[2.9rem]">
              {jobTitle(job.uploads)}
            </h1>
            <JobStatusBadge status={job.status} />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[0.7rem] text-muted-foreground">
            <span title={job.id} className="font-mono text-[0.64rem] text-muted-foreground/60">
              {job.id}
            </span>
            <span className="text-border">·</span>
            <span>{formatRelative(job.created_at)}</span>
            <span className="text-border">·</span>
            <span>
              {job.total_pages} page{job.total_pages === 1 ? '' : 's'}
              {job.uploads.length > 1 ? ` · ${job.uploads.length} documents` : ''}
            </span>
            <span className="text-border">·</span>
            <span>{job.model ?? 'Unlimited-OCR'}</span>
            {job.duration_ms != null && (
              <>
                <span className="text-border">·</span>
                <span>{formatDuration(job.duration_ms)}</span>
              </>
            )}
            {job.options.batch_mode && (
              <Badge variant="outline" className="py-0 text-[0.54rem]">
                Batch
              </Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {active && (
            <Button variant="outline" size="sm" onClick={() => setConfirmCancel(true)}>
              <Square /> Cancel
            </Button>
          )}
          {!active && (
            <Button variant="outline" size="sm" onClick={() => rerun.mutate()} disabled={rerun.isPending}>
              {rerun.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
              Rerun
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="default">
                <Download /> Export <ChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuLabel>This job</DropdownMenuLabel>
              <DropdownMenuItem onSelect={() => handleExport('md')} disabled={!combinedMarkdown}>
                <FileText /> Markdown (.md{canBundle ? ', with images' : ''})
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport('txt')} disabled={!combinedMarkdown}>
                <AlignLeft /> Plain text (.txt)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => handleExport('json')}>
                <Braces /> Full job (.json)
              </DropdownMenuItem>
              {canBundle && (
                <DropdownMenuItem
                  onSelect={() => handleExport('zip')}
                  disabled={!combinedMarkdown}
                >
                  <Archive /> Markdown bundle (.zip + images)
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Current page</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => handleExport('md', page?.position ?? 0)}
                disabled={!pageText}
              >
                <FileText /> Page {page?.page_number ?? '—'} · .md{canBundle ? ' with images' : ''}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => handleExport('txt', page?.position ?? 0)}
                disabled={!pageText}
              >
                <AlignLeft /> Page {page?.page_number ?? '—'} · .txt
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void copyJobMarkdown()}>
                <Copy /> Copy all Markdown
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="More job actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => rerun.mutate()} disabled={active || rerun.isPending}>
                <RotateCcw /> Rerun job
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setConfirmCancel(true)} disabled={!active}>
                <Square /> Cancel job
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                onSelect={() => setConfirmDelete(true)}
                disabled={active}
              >
                <Trash2 /> Delete job
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {active && <div className="mt-5"><ProgressPanel job={job} streamState={streamState} elapsed={elapsed} /></div>}

      {streamState === 'reconnecting' && active && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[0.72rem] text-warning">
          <WifiOff className="size-3.5 shrink-0" />
          The live connection dropped. Reconnecting — the job keeps running on the backend.
        </div>
      )}

      {job.error && (
        <div className="mt-4">
          <ErrorNotice
            title={job.status === 'failed' ? 'This job failed' : 'The engine reported a problem'}
            message={job.error}
            hint={
              job.status === 'failed'
                ? 'Partial pages are kept. Rerun the job after checking System & engine.'
                : undefined
            }
            onRetry={!active ? () => rerun.mutate() : undefined}
          />
        </div>
      )}

      {job.warning && (
        <div className="mt-3">
          <WarningNotice>{job.warning}</WarningNotice>
        </div>
      )}

      <div className="mt-5 grid items-start gap-5 xl:grid-cols-[214px_minmax(0,1fr)]">
        <aside className="min-w-0 xl:sticky xl:top-6">
          <div className="flex items-center justify-between px-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[0.66rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                Pages
              </span>
              <Badge variant="outline">{job.pages.length}</Badge>
            </div>
            {runningPosition !== null && runningPosition !== selected && (
              <button
                type="button"
                onClick={() => {
                  setSelected(runningPosition)
                  setPinned(false)
                }}
                className="inline-flex items-center gap-1 text-[0.64rem] font-semibold text-primary hover:underline"
              >
                <Radio className="size-3" /> Live page
              </button>
            )}
          </div>

          <div className="thin-scrollbar mt-2 flex gap-2 overflow-x-auto pb-2 xl:max-h-[calc(100vh-220px)] xl:grid xl:grid-cols-2 xl:overflow-y-auto xl:pr-0.5">
            {job.pages.map((item) => {
              const activePage = item.position === page?.position
              return (
                <button
                  key={item.position}
                  type="button"
                  onClick={() => {
                    setSelected(item.position)
                    setPinned(true)
                  }}
                  title={`${item.upload_name} · page ${item.page_number}`}
                  className={cn(
                    'group relative w-[84px] shrink-0 overflow-hidden rounded-lg border bg-muted text-left transition-all xl:w-auto',
                    activePage
                      ? 'border-primary/60 ring-2 ring-primary/20'
                      : 'border-border/70 opacity-80 hover:opacity-100',
                  )}
                >
                  <div className="relative aspect-[3/4] w-full overflow-hidden">
                    <img
                      src={item.thumb_url}
                      alt={`Page ${item.page_number}`}
                      loading="lazy"
                      className="size-full object-cover object-top"
                    />
                    <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/75 to-transparent px-1.5 pt-4 pb-1">
                      <span className="text-[0.56rem] font-bold text-white">
                        p.{item.page_number}
                      </span>
                      <StatusIcon status={item.status} className="size-3 text-white/90" />
                    </span>
                    {item.status === 'running' && (
                      <span className="absolute inset-x-0 bottom-0 h-0.5 overflow-hidden bg-black/20">
                        <span className="block h-full w-1/2 animate-[shimmer_1.3s_linear_infinite] bg-info" />
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>

          <div className="mt-1 hidden items-center justify-between text-[0.6rem] text-muted-foreground/60 xl:flex">
            <span>← → to navigate</span>
            <span>{job.completed_pages}/{job.total_pages}</span>
          </div>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_0_rgba(255,255,255,0.55)_inset,0_18px_50px_-38px_rgba(35,25,8,0.4)]">
          {page ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <div className="truncate text-[0.6rem] font-bold tracking-[0.14em] text-muted-foreground uppercase" title={page.upload_name}>
                    {page.upload_name}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2">
                    <h2 className="font-display text-[1.55rem] leading-none">
                      Page {page.page_number}
                    </h2>
                    <span className="flex items-center gap-1 text-[0.62rem] text-muted-foreground">
                      <StatusIcon status={page.status} />
                      {page.status === 'completed'
                        ? 'read'
                        : page.status === 'running'
                          ? 'reading'
                          : page.status}
                    </span>
                    <span className="text-[0.6rem] text-muted-foreground/50">
                      {pageIndex + 1} / {job.pages.length}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Tabs value={tab} onValueChange={(value) => setTab(value as ViewTab)}>
                    <TabsList>
                      <TabsTrigger value="result">Result</TabsTrigger>
                      <TabsTrigger value="source">Source</TabsTrigger>
                      <TabsTrigger value="raw">Raw</TabsTrigger>
                    </TabsList>
                  </Tabs>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() => void handleCopy(pageText || liveText, 'Page text')}
                        disabled={!pageText && !liveText}
                        aria-label="Copy page text"
                      >
                        {copied ? <Check className="text-success" /> : <Copy />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy page text</TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="outline" aria-label="Download this page">
                        <Download />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => handleExport('md', page.position)} disabled={!pageText}>
                        <FileText /> Page Markdown
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => handleExport('txt', page.position)} disabled={!pageText}>
                        <AlignLeft /> Page text
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="min-h-[420px] p-4 sm:p-6">
                {tab === 'result' && (
                  <div className="animate-fade-in">
                    {page.warning && (
                      <WarningNotice className="mb-4">{page.warning}</WarningNotice>
                    )}

                    <PageFigures page={page} />

                    {page.status === 'pending' && <WaitingState page={page} job={job} />}

                    {page.status === 'running' && (
                      <LiveOutput
                        text={batchActive ? batchLive : (page.output_raw ?? '')}
                        page={page}
                        batch={batchActive}
                        chars={(batchActive ? batchLive : (page.output_raw ?? '')).length}
                      />
                    )}

                    {page.status === 'failed' && (
                      <div>
                        <ErrorNotice
                          title="This page could not be read"
                          message={page.error || 'The engine returned an error for this page.'}
                          hint="Completed pages are preserved. Rerun the job when the engine is healthy."
                          onRetry={() => rerun.mutate()}
                        />
                        {page.output_raw && (
                          <p className="mt-4 text-[0.72rem] text-muted-foreground">
                            The Raw tab contains the partial model response.
                          </p>
                        )}
                      </div>
                    )}

                    {page.status === 'skipped' && (
                      <EmptyResult
                        title="This page was skipped"
                        body={page.error || 'The job was canceled before this page was read.'}
                        onRetry={!active ? () => rerun.mutate() : undefined}
                      />
                    )}

                    {page.status === 'completed' &&
                      (pageText ? (
                        <>
                          <Markdown>{pageText}</Markdown>
                          {page.finish_reason === 'length' && (
                            <WarningNotice className="mt-5">
                              The response hit the token limit. Increase the token budget and rerun
                              for dense pages.
                            </WarningNotice>
                          )}
                        </>
                      ) : (
                        <EmptyResult
                          title="No readable text"
                          body="The model finished this page without returning any text. Try a higher DPI or rerun."
                          onRetry={!active ? () => rerun.mutate() : undefined}
                        />
                      ))}
                  </div>
                )}

                {tab === 'source' && <SourceView page={page} />}

                {tab === 'raw' && (
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">
                        Model output · raw
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCopy(liveText || page.output_raw || '', 'Raw output')}
                        disabled={!liveText && !page.output_raw}
                      >
                        <Copy /> Copy
                      </Button>
                    </div>
                    {liveText || page.output_raw ? (
                      <pre className="thin-scrollbar max-h-[56vh] overflow-auto rounded-xl border border-border/70 bg-[#fbf8f1] p-4 font-mono text-[0.72rem] leading-relaxed whitespace-pre-wrap dark:bg-[#11100c]">
                        {liveText || page.output_raw}
                      </pre>
                    ) : (
                      <div className="flex min-h-52 items-center justify-center rounded-xl border border-dashed border-border/70 text-xs text-muted-foreground">
                        Nothing has been generated for this page yet.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border/70 bg-muted/20 px-4 py-2.5 text-[0.63rem] text-muted-foreground sm:px-5">
                <span className="flex items-center gap-1.5">
                  <Timer className="size-3" />
                  {formatDuration(page.duration_ms)}
                </span>
                <span className="text-border">·</span>
                <span>{formatNumber(page.prompt_tokens)} prompt tok</span>
                <span className="text-border">·</span>
                <span>{formatNumber(page.completion_tokens)} output tok</span>
                {page.finish_reason && (
                  <>
                    <span className="text-border">·</span>
                    <span className={cn(page.finish_reason === 'length' && 'text-warning')}>
                      finish: {page.finish_reason}
                    </span>
                  </>
                )}
                <span className="ml-auto">{formatNumber(pageText.length)} chars</span>
              </div>
            </>
          ) : (
            <div className="flex min-h-72 items-center justify-center text-sm text-muted-foreground">
              This job has no pages.
            </div>
          )}
        </section>
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this job?"
        description="Pages that are already read are kept, and the current page stops after its next token. You can rerun later."
        confirmLabel="Cancel job"
        cancelLabel="Keep reading"
        destructive
        icon={<Square />}
        onConfirm={async () => {
          await cancel.mutateAsync().catch(() => undefined)
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this job?"
        description={
          <>
            The job, its rendered pages, and any uploads not used by another job will be removed
            from local storage. This cannot be undone.
          </>
        }
        confirmLabel="Delete job"
        destructive
        icon={<Trash2 />}
        onConfirm={async () => {
          await remove.mutateAsync().catch(() => undefined)
        }}
      />
    </div>
  )
}
