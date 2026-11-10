import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileStack,
  Fingerprint,
  Image as ImageIcon,
  Layers3,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, uploadFiles } from '@/lib/api'
import {
  formatRelative,
  jobTitle,
} from '@/lib/format'
import type { AppSettings, Job, JobOptions, Upload, UploadError } from '@/lib/types'
import {
  clampSelection,
  clearDraft,
  defaultOptions,
  LAYOUT_PROMPT,
  loadDraft,
  saveDraft,
  specForSelection,
  totalPages,
} from '@/lib/job-options'
import { navigate } from '@/lib/router'
import { acceleratorName, engineLabel, localPasteShortcut, platformName } from '@/lib/platform'
import { useHealth } from '@/hooks/use-health'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorNotice } from '@/components/error-notice'
import { JobStatusBadge } from '@/components/status'
import { OptionsPanel } from '@/components/options-panel'
import { UploadCard } from '@/components/upload-card'
import { UploadZone } from '@/components/upload-zone'

function UploadErrorNotice({
  errors,
  onDismiss,
}: {
  errors: UploadError[]
  onDismiss: () => void
}) {
  if (errors.length === 0) return null
  return (
    <div className="rounded-xl border border-destructive/25 bg-destructive/[0.04] p-3.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[0.78rem] font-semibold text-destructive">
          <X className="size-3.5" />
          {errors.length} file{errors.length === 1 ? '' : 's'} could not be added
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="text-[0.66rem] font-semibold text-destructive/70 hover:underline"
        >
          Dismiss
        </button>
      </div>
      <div className="mt-2 space-y-2">
        {errors.map((error) => (
          <div key={`${error.filename}-${error.code}`} className="text-[0.72rem]">
            <span className="font-semibold text-destructive">{error.filename}</span>
            <span className="text-destructive/80"> — {error.message}</span>
            {error.hint && (
              <p className="mt-0.5 text-[0.68rem] leading-relaxed text-destructive/60">
                {error.hint}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function defaultsFromSettings(settings: AppSettings | undefined): JobOptions {
  if (!settings) return { ...defaultOptions }
  const mode = settings.default_prompt_mode === 'custom' ? 'custom' : 'layout'
  return {
    ...defaultOptions,
    prompt_mode: mode,
    prompt: mode === 'custom' ? settings.default_prompt : LAYOUT_PROMPT,
    dpi: settings.default_dpi,
    max_tokens: settings.default_max_tokens,
  }
}

function RecentJobCard({ job }: { job: Job }) {
  const thumb = job.pages.find((page) => page.thumb_url)?.thumb_url
  return (
    <button
      type="button"
      onClick={() => navigate(`/jobs/${job.id}`)}
      className="group flex w-full items-center gap-3 rounded-xl border border-border/80 bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md hover:shadow-black/5"
    >
      <div className="relative h-16 w-12 shrink-0 overflow-hidden rounded-md border border-border/70 bg-muted">
        {thumb ? (
          <img src={thumb} alt="" className="size-full object-cover object-top" loading="lazy" />
        ) : (
          <ImageIcon className="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 text-muted-foreground/50" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[0.82rem] font-semibold">{jobTitle(job.uploads)}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[0.66rem] text-muted-foreground">
          <span>{job.total_pages} pages</span>
          <span className="text-border">·</span>
          <span>{formatRelative(job.created_at)}</span>
        </div>
        <div className="mt-1.5">
          <JobStatusBadge status={job.status} className="px-1.5 py-0 text-[0.56rem]" />
        </div>
      </div>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground/40 transition-all group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-primary" />
    </button>
  )
}

export function WorkspaceView() {
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: Infinity,
  })
  const health = useHealth()
  const [hydrated, setHydrated] = useState(false)
  const initialized = useRef(false)
  const [uploads, setUploads] = useState<Upload[]>([])
  const [selection, setSelection] = useState<Record<string, number[]>>({})
  const [options, setOptions] = useState<JobOptions>({ ...defaultOptions })
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [uploadErrors, setUploadErrors] = useState<UploadError[]>([])
  const [creating, setCreating] = useState(false)
  const [runError, setRunError] = useState<ApiError | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)

  const platform = platformName(health.data?.system)
  const accelerator = acceleratorName(health.data)
  const engine = engineLabel(health.data)
  const features = [
    {
      icon: Layers3,
      title: 'Layout, not just letters',
      body: 'Titles, tables, formulas, captions, and reading order — preserved as structured Markdown.',
    },
    {
      icon: LockKeyhole,
      title: 'Private by design',
      body: `The model runs on ${platform === 'macOS' ? 'this Mac' : 'this device'}. No uploads, no accounts, no cloud round-trips.`,
    },
    {
      icon: Zap,
      title: 'Built for your hardware',
      body: `Local inference through ${engine}${accelerator ? ` on ${accelerator}` : ''}, tuned for a single private workspace.`,
    },
  ]

  const recent = useQuery({
    queryKey: ['jobs', 'recent'],
    queryFn: () => api.jobs({ limit: 3 }),
    enabled: hydrated && uploads.length === 0,
    staleTime: 15_000,
  })

  useEffect(() => {
    if (initialized.current || settingsQuery.isLoading) return
    initialized.current = true
    const fallback = defaultsFromSettings(settingsQuery.data)

    const boot = async () => {
      const draft = loadDraft()
      if (!draft || draft.uploadIds.length === 0) {
        setOptions(fallback)
        setHydrated(true)
        return
      }
      try {
        const resolved = await api.uploads(draft.uploadIds)
        const found = resolved.filter((upload): upload is Upload => Boolean(upload))
        const restored: Record<string, number[]> = {}
        for (const upload of found) {
          const pages = draft.selection[upload.id] ?? upload.pages.map((page) => page.page_number)
          restored[upload.id] = clampSelection(pages, upload.page_count)
        }
        setUploads(found)
        setSelection(restored)
        setOptions({ ...fallback, ...draft.options })
        if (found.length !== draft.uploadIds.length) {
          toast.info('Some draft files were no longer available', {
            description: 'They may have been removed with an older job.',
          })
        }
      } catch {
        setOptions(fallback)
        toast.error('Could not restore your draft', {
          description: 'The files are still in local storage; upload them again if needed.',
        })
      } finally {
        setHydrated(true)
      }
    }
    void boot()
  }, [settingsQuery.isLoading, settingsQuery.data])

  useEffect(() => {
    if (!hydrated) return
    if (uploads.length === 0) {
      clearDraft()
      return
    }
    saveDraft({ uploadIds: uploads.map((upload) => upload.id), selection, options, savedAt: Date.now() })
  }, [uploads, selection, options, hydrated])

  const total = totalPages(selection)

  useEffect(() => {
    if (options.batch_mode && (total < 2 || total > 4)) {
      setOptions((current) => ({ ...current, batch_mode: false }))
    }
  }, [total, options.batch_mode])

  const handleFiles = async (files: File[]) => {
    if (uploading) return
    setUploading(true)
    setProgress(0)
    setUploadErrors([])
    try {
      const result = await uploadFiles(files, setProgress)
      if (result.uploads.length) {
        let capacity = Math.max(0, 50 - total)
        let trimmed = false
        const nextSelection: Record<string, number[]> = { ...selection }
        for (const upload of result.uploads) {
          const pages = upload.pages.map((page) => page.page_number)
          const take = pages.slice(0, capacity)
          capacity -= take.length
          nextSelection[upload.id] = take
          if (take.length < pages.length) trimmed = true
        }
        setUploads((current) => [...current, ...result.uploads])
        setSelection(nextSelection)
        if (trimmed) {
          const first = result.uploads[0]?.original_name
          toast.info(
            first && result.uploads.length === 1
              ? 'Selected the first pages of this file'
              : 'Some pages were not selected',
            {
              description: 'A job reads at most 50 pages. Adjust the thumbnails before you start.',
            }
          )
        } else if (result.errors.length === 0) {
          toast.success(`Added ${result.uploads.length} file${result.uploads.length === 1 ? '' : 's'}`)
        }
      }
      if (result.errors.length) {
        setUploadErrors(result.errors)
        toast.error(
          result.uploads.length
            ? 'Some files could not be added'
            : 'No files could be added',
        )
      }
    } catch (error) {
      const apiError =
        error instanceof ApiError
          ? error
          : new ApiError('The upload failed unexpectedly.')
      setUploadErrors([
        {
          filename: files.length === 1 ? files[0].name : 'Your files',
          message: apiError.message,
          code: apiError.code,
          hint: apiError.hint,
        },
      ])
      toast.error('Upload failed', { description: apiError.message })
    } finally {
      setUploading(false)
    }
  }

  const removeUpload = (upload: Upload) => {
    setUploads((current) => current.filter((item) => item.id !== upload.id))
    setSelection((current) => {
      const next = { ...current }
      delete next[upload.id]
      return next
    })
    void api.deleteUpload(upload.id).catch(() => undefined)
  }

  const handleFilesRef = useRef<(files: File[]) => Promise<void>>(async () => undefined)
  handleFilesRef.current = handleFiles

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.size > 0)
      if (files.length && !uploading && !creating) {
        event.preventDefault()
        void handleFilesRef.current(files)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [uploading, creating])

  const clearAll = async () => {
    const current = uploads
    setUploads([])
    setSelection({})
    setUploadErrors([])
    clearDraft()
    await Promise.allSettled(current.map((upload) => api.deleteUpload(upload.id)))
  }

  const handleRun = async () => {
    if (creating) return
    if (total === 0) {
      toast.error('Choose at least one page')
      return
    }
    if (total > 50) {
      toast.error('Select at most 50 pages per job')
      return
    }
    if (options.prompt_mode === 'custom' && !options.prompt.trim()) {
      setRunError(
        new ApiError(
          'The custom prompt is empty.',
          422,
          'empty_prompt',
          'Describe what the model should read, or switch back to Layout.',
        ),
      )
      return
    }

    setCreating(true)
    setRunError(null)
    try {
      const pageSelection: Record<string, string> = {}
      const ids: string[] = []
      for (const upload of uploads) {
        const pages = selection[upload.id] ?? []
        if (pages.length === 0) continue
        ids.push(upload.id)
        pageSelection[upload.id] = specForSelection(pages, upload.page_count)
      }
      const job = await api.createJob(ids, {
        ...options,
        prompt: options.prompt.trim(),
        page_selection: pageSelection,
      })
      clearDraft()
      toast.success('Job queued', {
        description: `${total} page${total === 1 ? '' : 's'} sent to the local engine.`,
      })
      navigate(`/jobs/${job.id}`)
    } catch (error) {
      const apiError =
        error instanceof ApiError ? error : new ApiError('Could not create the job.')
      setRunError(apiError)
      toast.error('Could not start the job', { description: apiError.message })
    } finally {
      setCreating(false)
    }
  }

  if (!hydrated) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 py-8">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="mt-8 h-64 w-full rounded-2xl" />
      </div>
    )
  }

  if (uploads.length === 0) {
    return (
      <div className="animate-fade-up">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-[0.66rem] font-bold tracking-[0.18em] text-muted-foreground uppercase">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-success/50" />
              <span className="relative inline-flex size-1.5 rounded-full bg-success" />
            </span>
            Local · {platform} · Private
          </div>
          <span className="text-[0.66rem] font-semibold tracking-wide text-muted-foreground/70">
            Baidu Unlimited-OCR
          </span>
        </div>

        <div className="mt-7 max-w-4xl">
          <h1 className="font-display text-[3.1rem] leading-[0.92] tracking-[-0.02em] sm:text-[4.2rem] lg:text-[4.9rem]">
            Every page,
            <br />
            <span className="text-primary italic">read beautifully.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[0.95rem] leading-relaxed text-muted-foreground sm:text-base">
            Drop a document into your own private OCR studio. Unlimited-OCR reads layout, tables,
            formulas, and handwriting — then hands you clean Markdown, ready to use.
          </p>
        </div>

        {health.data && !health.data.model.ready && (
          <div className="mt-7 max-w-3xl">
            <ErrorNotice
              title="Model files are missing"
              message={health.data.model.message}
              hint={
                health.data.model.download_command
                  ? `Run ${health.data.model.download_command} from the project root, then restart the backend.`
                  : undefined
              }
            />
          </div>
        )}

        <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_292px]">
          <UploadZone
            onFiles={(files) => void handleFiles(files)}
            uploading={uploading}
            progress={progress}
          />
          <div className="mt-3">
            <UploadErrorNotice
              errors={uploadErrors}
              onDismiss={() => setUploadErrors([])}
            />
          </div>

          <aside className="hidden overflow-hidden rounded-2xl border border-border/80 bg-card lg:block">
            <div className="border-b border-border/70 px-4.5 py-4">
              <div className="flex items-center gap-2 text-[0.64rem] font-bold tracking-[0.16em] text-muted-foreground uppercase">
                <Fingerprint className="size-3.5" /> On this device
              </div>
              <p className="font-display mt-2 text-[1.35rem] leading-tight">
                A reading room that never leaves home.
              </p>
            </div>
            <div className="divide-y divide-border/60 px-4.5">
              {[
                { label: 'Model', value: health.data?.model.model?.name ?? 'Baidu Unlimited-OCR' },
                { label: 'Engine', value: engine },
                { label: 'Accelerator', value: accelerator },
                { label: 'Pages per job', value: 'Up to 50' },
              ].map((row) => (
                <div key={row.label} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="text-[0.69rem] text-muted-foreground">{row.label}</span>
                  <span className="text-right text-[0.72rem] font-semibold">{row.value}</span>
                </div>
              ))}
            </div>
            <div className="m-3.5 mt-3 flex items-start gap-2 rounded-lg bg-muted/60 px-3 py-2.5">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
              <p className="text-[0.67rem] leading-relaxed text-muted-foreground">
                Uploads, renders, and outputs stay under your project&apos;s{' '}
                <code className="rounded bg-background/60 px-1 py-0.5 font-mono text-[0.62rem]">data/</code>{' '}
                folder.
              </p>
            </div>
          </aside>
        </div>

        <div className="mt-9 grid overflow-hidden rounded-xl border border-border/80 bg-border/60 sm:grid-cols-3 sm:gap-px">
          {features.map((feature, index) => (
            <div key={feature.title} className="bg-card px-5 py-5 sm:px-4.5">
              <div className="flex items-center gap-2">
                <feature.icon className="size-3.5 text-primary" />
                <h2 className="text-[0.78rem] font-semibold">{feature.title}</h2>
                {index === 0 && <Sparkles className="ml-auto size-3 text-muted-foreground/40" />}
              </div>
              <p className="mt-1.5 text-[0.71rem] leading-relaxed text-muted-foreground">
                {feature.body}
              </p>
            </div>
          ))}
        </div>

        {recent.data && recent.data.items.length > 0 && (
          <section className="mt-12">
            <div className="mb-3 flex items-end justify-between">
              <div>
                <div className="text-[0.62rem] font-bold tracking-[0.18em] text-muted-foreground uppercase">
                  Archive
                </div>
                <h2 className="font-display mt-1 text-2xl">Pick up where you left off.</h2>
              </div>
              <Button variant="ghost" size="sm" onClick={() => navigate('/history')}>
                All history <ArrowRight />
              </Button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
              {recent.data.items.map((job) => (
                <RecentJobCard key={job.id} job={job} />
              ))}
            </div>
          </section>
        )}

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-4 text-[0.65rem] text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <CheckCircle2 className="size-3" /> Everything runs on this device
          </span>
          <span className="flex items-center gap-1.5">
            <FileStack className="size-3" /> PDF, PNG, JPEG, WebP, TIFF, HEIC
          </span>
          <span className="ml-auto">Drop pages in the card · {localPasteShortcut()} to paste an image</span>
        </div>
      </div>
    )
  }

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[0.62rem] font-bold tracking-[0.18em] text-primary uppercase">
            New job
          </div>
          <h1 className="font-display mt-1.5 text-4xl leading-none sm:text-[3.1rem]">
            Ready when you are.
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted-foreground">
            Choose the pages to read, tune the depth, then send them to the local engine.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setConfirmClear(true)}>
          <Trash2 /> Clear all
        </Button>
      </div>

      {health.data && !health.data.model.ready && (
        <div className="mt-5">
          <ErrorNotice
            title="The model is not ready"
            message={health.data.model.message}
            hint={
              health.data.model.download_command
                ? `Run ${health.data.model.download_command} from the project root, then restart the backend.`
                : undefined
            }
          />
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_356px]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
            <div className="flex items-center gap-2">
              <span className="text-[0.72rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
                Queue
              </span>
              <Badge variant="outline">{uploads.length} file{uploads.length === 1 ? '' : 's'}</Badge>
              <Badge variant={total > 50 ? 'destructive' : 'secondary'}>{total} pages</Badge>
            </div>
            <span className="text-[0.66rem] text-muted-foreground">
              {total > 50 ? 'Reduce to 50 pages or fewer' : `${50 - total} page slots left`}
            </span>
          </div>

          {uploads.map((upload) => (
            <UploadCard
              key={upload.id}
              upload={upload}
              selected={selection[upload.id] ?? []}
              onChange={(pages) =>
                setSelection((current) => ({ ...current, [upload.id]: pages }))
              }
              onRemove={() => removeUpload(upload)}
              disabled={creating}
            />
          ))}

          <UploadZone
            onFiles={(files) => void handleFiles(files)}
            uploading={uploading}
            progress={progress}
            compact
            disabled={creating}
          />

          <UploadErrorNotice
            errors={uploadErrors}
            onDismiss={() => setUploadErrors([])}
          />

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-[0.65rem] text-muted-foreground/70">
            <span>Each upload is stored under data/uploads.</span>
            <span>·</span>
            <span>Up to 100 pages per PDF, 50 per job.</span>
          </div>
        </div>

        <div className="min-w-0">
          {runError && (
            <div className="mb-3">
              <ErrorNotice
                compact
                title="The job could not start"
                message={runError.message}
                hint={runError.hint}
                code={runError.code}
                onDismiss={() => setRunError(null)}
                onRetry={() => void handleRun()}
              />
            </div>
          )}
          <OptionsPanel
            options={options}
            onChange={setOptions}
            totalPages={total}
            running={creating}
            onRun={() => void handleRun()}
            onReset={() => setOptions(defaultsFromSettings(settingsQuery.data))}
            engineReady={health.data?.model.ready ?? true}
          />
        </div>
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear this queue?"
        description={`${uploads.length} file${uploads.length === 1 ? '' : 's'} and ${total} selected page${total === 1 ? '' : 's'} will be removed from the workspace. Uploaded copies in data/uploads are deleted too.`}
        confirmLabel="Clear queue"
        destructive
        icon={<Trash2 />}
        onConfirm={clearAll}
      />
    </div>
  )
}
