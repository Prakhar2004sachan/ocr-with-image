import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRight,
  Download,
  FileText,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, downloadExport } from '@/lib/api'
import { formatDateTime, formatDuration, formatRelative, jobTitle } from '@/lib/format'
import type { Job } from '@/lib/types'
import { isActive } from '@/lib/job-options'
import { navigate } from '@/lib/router'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorNotice } from '@/components/error-notice'
import { JobStatusBadge } from '@/components/status'

function ThumbStack({ job }: { job: Job }) {
  const pages = job.pages.filter((page) => page.thumb_url).slice(0, 3)
  if (pages.length === 0) {
    return (
      <div className="flex h-14 w-11 items-center justify-center rounded-md border border-border/70 bg-muted text-muted-foreground/50">
        <ImageIcon className="size-4" />
      </div>
    )
  }
  return (
    <div className="relative h-14 w-12">
      {pages.map((page, index) => (
        <div
          key={page.position}
          className="absolute top-0 left-0 h-14 w-11 overflow-hidden rounded-md border border-border/80 bg-muted shadow-sm"
          style={{
            transform: `translate(${index * 3}px, ${index * -2}px) rotate(${(index - 1) * 2.2}deg)`,
            zIndex: pages.length - index,
          }}
        >
          <img
            src={page.thumb_url}
            alt=""
            className="size-full object-cover object-top"
            loading="lazy"
          />
        </div>
      ))}
    </div>
  )
}

function HistoryRow({
  job,
  onDelete,
  onRerun,
  rerunning,
}: {
  job: Job
  onDelete: (job: Job) => void
  onRerun: (job: Job) => void
  rerunning: boolean
}) {
  const active = isActive(job.status)
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/jobs/${job.id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          navigate(`/jobs/${job.id}`)
        }
      }}
      className="group grid cursor-pointer grid-cols-[48px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-3.5 transition-colors hover:bg-muted/35 sm:grid-cols-[48px_minmax(0,1fr)_130px_100px_auto] sm:gap-4 sm:px-4"
    >
      <div className="flex items-center">
        <ThumbStack job={job} />
      </div>

      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-[0.86rem] font-semibold">{jobTitle(job.uploads)}</h3>
          {job.uploads.length > 1 && (
            <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
              {job.uploads.length} docs
            </Badge>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.66rem] text-muted-foreground">
          <span>
            {job.total_pages} page{job.total_pages === 1 ? '' : 's'}
          </span>
          <span className="text-border">·</span>
          <span title={formatDateTime(job.created_at)}>{formatRelative(job.created_at)}</span>
          <span className="text-border sm:hidden">·</span>
          <span className="sm:hidden">{formatDuration(job.duration_ms)}</span>
          {job.completed_pages > 0 && job.completed_pages < job.total_pages && (
            <>
              <span className="text-border">·</span>
              <span>{job.completed_pages} read</span>
            </>
          )}
        </div>
        <div className="mt-1.5 sm:hidden">
          <JobStatusBadge status={job.status} className="px-1.5 py-0 text-[0.54rem]" />
        </div>
      </div>

      <div className="hidden sm:block">
        <JobStatusBadge status={job.status} />
      </div>

      <div className="hidden text-[0.7rem] text-muted-foreground tabular-nums sm:block">
        {formatDuration(job.duration_ms)}
      </div>

      <div className="flex items-center gap-1" onClick={(event) => event.stopPropagation()}>
        <Button
          variant="ghost"
          size="icon-sm"
          className="hidden text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 sm:inline-flex"
          onClick={() => navigate(`/jobs/${job.id}`)}
          aria-label={`Open ${jobTitle(job.uploads)}`}
        >
          <ArrowRight />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="Job actions"
            >
              {rerunning ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => navigate(`/jobs/${job.id}`)}>
              Open job
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onRerun(job)} disabled={active || rerunning}>
              <RotateCcw /> Rerun
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                void toast.promise(downloadExport(job, 'md'), {
                  loading: 'Preparing export…',
                  success: 'Markdown downloaded',
                  error: (error) =>
                    error instanceof ApiError ? error.message : 'Could not export this job.',
                })
              }}
              disabled={job.completed_pages === 0}
            >
              <Download /> Export Markdown
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onSelect={() => onDelete(job)} disabled={active}>
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}

function HistorySkeleton() {
  return (
    <div className="divide-y divide-border/70 rounded-xl border border-border/80 bg-card">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="h-14 w-12 rounded-md" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-52" />
            <Skeleton className="h-3 w-32" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
      ))}
    </div>
  )
}

export function HistoryView() {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [status, setStatus] = useState('all')
  const [limit, setLimit] = useState(24)
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null)
  const [rerunningId, setRerunningId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(search.trim()), 280)
    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setLimit(24)
  }, [debounced, status])

  const jobs = useQuery({
    queryKey: ['jobs', { limit, status, q: debounced }],
    queryFn: () => api.jobs({ limit, offset: 0, status, q: debounced }),
    staleTime: 8000,
  })

  const remove = useMutation({
    mutationFn: (job: Job) => api.deleteJob(job.id),
    onSuccess: (_, job) => {
      queryClient.removeQueries({ queryKey: ['job', job.id] })
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['health'] })
      setDeleteTarget(null)
      toast.success('Job deleted')
    },
    onError: (error) =>
      toast.error('Could not delete this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const rerun = async (job: Job) => {
    setRerunningId(job.id)
    try {
      const created = await api.rerunJob(job.id)
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      toast.success('Rerun queued')
      navigate(`/jobs/${created.id}`)
    } catch (error) {
      toast.error('Could not rerun this job', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      })
    } finally {
      setRerunningId(null)
    }
  }

  const items = jobs.data?.items ?? []
  const total = jobs.data?.total ?? 0
  const filtered = Boolean(debounced) || status !== 'all'

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[0.62rem] font-bold tracking-[0.18em] text-primary uppercase">
            Archive
          </div>
          <h1 className="font-display mt-1.5 text-5xl leading-none tracking-[-0.02em] sm:text-[3.6rem]">
            The archive.
          </h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Every job, render, and export lives on this device. Open one to keep reading where
            you stopped.
          </p>
        </div>
        <Button onClick={() => navigate('/')} size="sm" className="mt-1">
          <Plus /> New job
        </Button>
      </div>

      <div className="mt-7 flex flex-col gap-2.5 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground/60" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by document name…"
            className="pr-9 pl-9"
            aria-label="Search jobs"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="sm:w-[170px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="queued">Queued</SelectItem>
            <SelectItem value="preparing">Preparing</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="canceled">Canceled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="mt-3 flex items-center justify-between px-0.5 text-[0.68rem] text-muted-foreground">
        <span>
          {jobs.isLoading ? 'Loading…' : `${total} job${total === 1 ? '' : 's'}${filtered ? ' matched' : ' in total'}`}
        </span>
        {filtered && (
          <button
            type="button"
            onClick={() => {
              setSearch('')
              setStatus('all')
            }}
            className="font-semibold text-muted-foreground hover:text-primary"
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="mt-3">
        {jobs.isLoading ? (
          <HistorySkeleton />
        ) : jobs.isError ? (
          <ErrorNotice
            title="Could not load history"
            message={
              jobs.error instanceof ApiError ? jobs.error.message : 'The archive did not respond.'
            }
            hint="The backend may be busy starting the engine."
            onRetry={() => void jobs.refetch()}
          />
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-card/45 px-6 py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-2xl border border-border/70 bg-muted/70 text-muted-foreground">
              {filtered ? <Search className="size-5" /> : <FileText className="size-5" />}
            </div>
            <h2 className="font-display mt-4 text-2xl">
              {filtered ? 'Nothing matches.' : 'A quiet archive.'}
            </h2>
            <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
              {filtered
                ? 'Try a different document name or status filter.'
                : 'Your completed jobs will appear here, with every page ready to revisit or export.'}
            </p>
            <Button
              className="mt-5"
              variant={filtered ? 'outline' : 'default'}
              onClick={() => {
                if (filtered) {
                  setSearch('')
                  setStatus('all')
                } else {
                  navigate('/')
                }
              }}
            >
              {filtered ? 'Clear filters' : 'Start a new job'}
            </Button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card shadow-[0_1px_0_rgba(255,255,255,0.5)_inset]">
            <div className="hidden grid-cols-[48px_minmax(0,1fr)_130px_100px_auto] gap-4 border-b border-border/70 bg-muted/25 px-4 py-2 text-[0.58rem] font-bold tracking-[0.14em] text-muted-foreground uppercase sm:grid">
              <span />
              <span>Document</span>
              <span>Status</span>
              <span>Duration</span>
              <span className="pr-1">Actions</span>
            </div>
            <div className="divide-y divide-border/70">
              {items.map((job) => (
                <HistoryRow
                  key={job.id}
                  job={job}
                  onDelete={setDeleteTarget}
                  onRerun={(target) => void rerun(target)}
                  rerunning={rerunningId === job.id}
                />
              ))}
            </div>
            {items.length < total && (
              <div className="flex justify-center border-t border-border/70 p-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLimit((current) => current + 24)}
                  disabled={jobs.isFetching}
                >
                  {jobs.isFetching && <Loader2 className="animate-spin" />}
                  Load more
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete this job?"
        description={
          deleteTarget ? (
            <>
              <span className="font-semibold text-foreground">{jobTitle(deleteTarget.uploads)}</span>{' '}
              and its {deleteTarget.total_pages} rendered page
              {deleteTarget.total_pages === 1 ? '' : 's'} will be removed. Uploads that belong to
              another job are kept.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Delete job"
        destructive
        icon={<Trash2 />}
        onConfirm={async () => {
          if (deleteTarget) await remove.mutateAsync(deleteTarget).catch(() => undefined)
        }}
      />
    </div>
  )
}
