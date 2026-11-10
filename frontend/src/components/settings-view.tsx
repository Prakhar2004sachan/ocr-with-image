import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Check,
  Copy,
  Cpu,
  Database,
  FolderOpen,
  HardDrive,
  Info,
  Layers3,
  Loader2,
  MonitorCog,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, copyText } from '@/lib/api'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AppSettings, EngineFacts, PromptMode } from '@/lib/types'
import { useHealth } from '@/hooks/use-health'
import { deviceHint, deviceOptions, platformName } from '@/lib/platform'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { EngineControl } from '@/components/engine-control'
import { ErrorNotice, WarningNotice } from '@/components/error-notice'
import { SystemDialog } from '@/components/system-dialog'

function SettingsSection({
  title,
  description,
  icon,
  children,
  className,
}: {
  title: string
  description?: string
  icon: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <section className={className}>
      <div className="mb-3 flex items-start gap-2.5 px-0.5">
        <div className="mt-0.5 flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <h2 className="text-[0.88rem] font-semibold">{title}</h2>
          {description && <p className="mt-0.5 text-[0.72rem] text-muted-foreground">{description}</p>}
        </div>
      </div>
      {children}
    </section>
  )
}

const tokenPresets = [2048, 4096, 8192, 16384]

type ModelPatch = Partial<Pick<AppSettings, 'active_engine' | 'uocr2_device'>>

function EngineCard({
  title,
  subtitle,
  badges,
  rows,
  selected,
  disabled,
  disabledReason,
  onSelect,
}: {
  title: string
  subtitle: string
  badges: string[]
  rows: Array<{ label: string; value: string }>
  selected: boolean
  disabled?: boolean
  disabledReason?: string
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={selected}
      className={cn(
        'w-full rounded-xl border px-4 py-3.5 text-left transition-all',
        selected
          ? 'border-primary/50 bg-primary/[0.06] shadow-sm'
          : 'border-border/80 bg-card/40 hover:border-border hover:bg-card/70',
        disabled && 'cursor-not-allowed opacity-60 hover:border-border/80 hover:bg-card/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.86rem] font-semibold">{title}</div>
          <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted-foreground">
            {subtitle}
          </p>
        </div>
        <span
          className={cn(
            'mt-1 flex size-4 shrink-0 items-center justify-center rounded-full border',
            selected ? 'border-primary bg-primary' : 'border-border/80',
          )}
        >
          {selected && <span className="size-1.5 rounded-full bg-primary-foreground" />}
        </span>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {badges.map((badge) => (
          <span
            key={badge}
            className="rounded border border-border/70 bg-background/60 px-1.5 py-0.5 text-[0.6rem] font-semibold text-muted-foreground"
          >
            {badge}
          </span>
        ))}
      </div>
      <dl className="mt-2.5 space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-3">
            <dt className="text-[0.68rem] text-muted-foreground">{row.label}</dt>
            <dd className="truncate text-right text-[0.7rem] font-semibold" title={row.value}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
      {disabled && disabledReason && (
        <p className="mt-2 text-[0.68rem] text-destructive">{disabledReason}</p>
      )}
    </button>
  )
}

function ModelPicker({
  settings,
  engines,
  loading,
  onChange,
}: {
  settings: AppSettings
  engines: EngineFacts | undefined
  loading: boolean
  onChange: (patch: ModelPatch) => void
}) {
  const uocr2 = engines?.transformers?.weights
  const uocr2Ready = Boolean(uocr2?.ready)
  const torchReady = Boolean(engines?.transformers?.torch)
  const llamaReady = Boolean(engines?.llama_cpp?.ready)
  const preference = settings.active_engine
  const resolved = engines?.active ?? 'llama_cpp'

  return (
    <div className="space-y-3">
      <div className="grid gap-3 lg:grid-cols-2">
        <EngineCard
          title="Unlimited-OCR-2"
          subtitle="Baidu's original image-text-to-text weights (BF16 Safetensors) through transformers on the local GPU or CPU. Nothing is quantized or re-exported."
          badges={['original', 'BF16', 'transformers', uocr2?.ready ? 'downloaded' : 'not downloaded']}
          rows={[
            { label: 'Weights', value: uocr2Ready ? `${uocr2?.shards.length ?? 0} safetensors shards` : 'missing' },
            { label: 'Folder', value: uocr2?.dir ?? '—' },
            { label: 'Runtime', value: torchReady ? `torch · ${engines?.transformers?.device ?? 'auto'}` : 'torch not installed' },
          ]}
          selected={preference === 'transformers' || (preference === 'auto' && resolved === 'transformers')}
          disabled={!uocr2Ready}
          disabledReason={
            uocr2Ready ? undefined : 'Download it first: python scripts/download_models.py --model uocr2'
          }
          onSelect={() => onChange({ active_engine: 'transformers' })}
        />
        <EngineCard
          title="Unlimited-OCR · Q8_0 GGUF"
          subtitle="Community GGUF served by a local llama-server process. Faster and lighter, but quantized, and it needs a separately exported vision projector (mmproj)."
          badges={['quantized', 'GGUF Q8_0', 'llama.cpp', llamaReady ? 'downloaded' : 'not downloaded']}
          rows={[
            { label: 'Weights', value: llamaReady ? 'Q8_0 · ~2.9 GB' : 'missing' },
            { label: 'Engine', value: engines?.llama_cpp?.label ?? 'llama.cpp' },
            { label: 'Build', value: engines?.llama_cpp?.version ?? '—' },
          ]}
          selected={preference === 'llama_cpp' || (preference === 'auto' && resolved === 'llama_cpp')}
          disabled={!llamaReady}
          disabledReason={llamaReady ? undefined : 'Download it first: python scripts/download_models.py'}
          onSelect={() => onChange({ active_engine: 'llama_cpp' })}
        />
      </div>

      <label className="flex items-center gap-2 text-[0.72rem] text-muted-foreground">
        <Switch
          checked={settings.active_engine === 'auto'}
          onCheckedChange={(next) => onChange({ active_engine: next ? 'auto' : (resolved === 'transformers' ? 'llama_cpp' : 'transformers') })}
          aria-label="Pick the engine automatically"
        />
        Pick automatically — Unlimited-OCR-2 when its weights exist, otherwise the GGUF build
      </label>

      {settings.active_engine !== 'llama_cpp' && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/80 bg-card/40 px-3.5 py-3">
          <span className="text-[0.7rem] font-semibold">Unlimited-OCR-2 device</span>
          <div className="flex flex-wrap gap-1.5">
            {deviceOptions(engines, settings.uocr2_device).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => onChange({ uocr2_device: option.value })}
                aria-pressed={settings.uocr2_device === option.value}
                className={cn(
                  'rounded-lg border px-2.5 py-1 text-[0.68rem] font-semibold transition-colors',
                  settings.uocr2_device === option.value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/80 bg-background/50 text-muted-foreground hover:text-foreground',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <p className="w-full text-[0.66rem] text-muted-foreground">
            {deviceHint(settings.uocr2_device, engines)}
          </p>
          {engines?.transformers?.loaded?.loaded && (
            <span className="ml-auto text-[0.68rem] text-muted-foreground">
              loaded · {engines.transformers.loaded.weights_gb?.toFixed?.(1) ?? '—'} GB
            </span>
          )}
        </div>
      )}

      {(!uocr2Ready || !torchReady) && (
        <WarningNotice>
          <span className="font-semibold">
            {uocr2Ready ? 'The inference stack is missing — ' : 'Unlimited-OCR-2 weights are not in this project — '}
          </span>
          {!uocr2Ready ? (
            <>
              Run{' '}
              <code className="font-mono">python scripts/download_models.py --model uocr2</code> to
              download the original BF16 safetensors into{' '}
              <code className="font-mono">models/uocr2</code>. Until then the studio keeps using
              the GGUF build.
            </>
          ) : (
            <>
              Unlimited-OCR-2 needs torch and transformers:{' '}
              <code className="font-mono">python scripts/install_inference.py</code>.
            </>
          )}
        </WarningNotice>
      )}
      {loading && <Skeleton className="h-24 rounded-xl" />}
    </div>
  )
}

export function SettingsView() {
  const queryClient = useQueryClient()
  const health = useHealth()
  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings,
    staleTime: Infinity,
  })
  const diagnostics = useQuery({
    queryKey: ['diagnostics'],
    queryFn: api.diagnostics,
    staleTime: 10_000,
  })
  const engines = useQuery({
    queryKey: ['engines'],
    queryFn: api.engines,
    staleTime: 10_000,
  })
  const jobsCount = useQuery({
    queryKey: ['jobs', { limit: 1, status: 'all', q: '' }],
    queryFn: () => api.jobs({ limit: 1 }),
    staleTime: 10_000,
  })

  const [form, setForm] = useState<AppSettings | null>(null)
  const [dirty, setDirty] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [systemOpen, setSystemOpen] = useState(false)

  useEffect(() => {
    if (settingsQuery.data && !dirty) setForm(settingsQuery.data)
  }, [settingsQuery.data, dirty])

  const save = useMutation({
    mutationFn: (settings: AppSettings) => api.updateSettings(settings),
    onSuccess: (saved) => {
      setForm(saved)
      setDirty(false)
      queryClient.setQueryData(['settings'], saved)
      queryClient.invalidateQueries({ queryKey: ['diagnostics'] })
      queryClient.invalidateQueries({ queryKey: ['engines'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      toast.success('Settings saved')
    },
    onError: (error) =>
      toast.error('Could not save settings', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const reset = useMutation({
    mutationFn: api.resetSettings,
    onSuccess: (saved) => {
      setForm(saved)
      setDirty(false)
      queryClient.setQueryData(['settings'], saved)
      toast.success('Defaults restored')
    },
    onError: (error) =>
      toast.error('Could not reset settings', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  const clear = useMutation({
    mutationFn: api.clearHistory,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] })
      queryClient.invalidateQueries({ queryKey: ['health'] })
      toast.success(result.message ?? 'History cleared')
    },
    onError: (error) =>
      toast.error('Could not clear history', {
        description: error instanceof ApiError ? error.message : 'Unknown error.',
      }),
  })

  if (settingsQuery.isError) {
    return (
      <div className="mx-auto max-w-2xl">
        <ErrorNotice
          title="Could not load settings"
          message={
            settingsQuery.error instanceof ApiError
              ? settingsQuery.error.message
              : 'The backend did not respond.'
          }
          onRetry={() => void settingsQuery.refetch()}
        />
      </div>
    )
  }

  if (settingsQuery.isLoading || !form) {
    return (
      <div className="mx-auto max-w-5xl space-y-6">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-12 w-2/3" />
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-72 rounded-xl" />
        </div>
      </div>
    )
  }

  const set = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setForm((current) => (current ? { ...current, [key]: value } : current))
    setDirty(true)
  }

  const mode: 'layout' | 'custom' = form.default_prompt_mode === 'custom' ? 'custom' : 'layout'
  const setMode = (next: 'layout' | 'custom') => {
    setDirty(true)
    setForm((current) =>
      current
        ? {
            ...current,
            default_prompt_mode: next as PromptMode,
            default_prompt: next === 'layout' ? 'document parsing.' : current.default_prompt,
          }
        : current,
    )
  }

  const copyPath = async (label: string, value: string) => {
    if (await copyText(value)) toast.success(`${label} path copied`)
    else toast.error('Could not copy the path')
  }

  const activeWork = Boolean(health.data?.active_job) || (health.data?.queued_jobs ?? 0) > 0
  const totalJobs = jobsCount.data?.total ?? 0

  return (
    <div className="animate-fade-up">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="text-[0.62rem] font-bold tracking-[0.18em] text-primary uppercase">
            Studio
          </div>
          <h1 className="font-display mt-1.5 text-5xl leading-none tracking-[-0.02em] sm:text-[3.6rem]">
            Settings.
          </h1>
          <p className="mt-2 max-w-lg text-sm text-muted-foreground">
            Defaults for new jobs, the local engine, and the files this studio keeps on{' '}
            {platformName(health.data?.system) === 'macOS' ? 'this Mac' : 'this device'}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => reset.mutate()}
            disabled={reset.isPending || save.isPending}
          >
            {reset.isPending ? <Loader2 className="animate-spin" /> : <RotateCcw />}
            Reset defaults
          </Button>
          <Button size="sm" onClick={() => form && save.mutate(form)} disabled={!dirty || save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Save />}
            Save changes
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-info/25 bg-info/[0.06] px-3.5 py-2 text-[0.74rem] text-info">
          <Info className="size-3.5 shrink-0" />
          Unsaved changes. New jobs use these defaults the next time you open the workspace.
        </div>
      )}

      <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_370px]">
        <div className="space-y-7">
          <SettingsSection
            title="Reading defaults"
            description="Applied to every new workspace session."
            icon={<Sparkles className="size-3.5" />}
          >
            <div className="space-y-5 rounded-xl border border-border/80 bg-card p-4.5">
              <div className="space-y-2">
                <Label>Default reading mode</Label>
                <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/80 p-1">
                  <button
                    type="button"
                    onClick={() => setMode('layout')}
                    className={
                      mode === 'layout'
                        ? 'rounded-md bg-card px-3 py-1.5 text-[0.76rem] font-semibold shadow-sm'
                        : 'rounded-md px-3 py-1.5 text-[0.76rem] font-semibold text-muted-foreground hover:text-foreground'
                    }
                  >
                    Layout-aware
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('custom')}
                    className={
                      mode === 'custom'
                        ? 'rounded-md bg-card px-3 py-1.5 text-[0.76rem] font-semibold shadow-sm'
                        : 'rounded-md px-3 py-1.5 text-[0.76rem] font-semibold text-muted-foreground hover:text-foreground'
                    }
                  >
                    Custom prompt
                  </button>
                </div>
              </div>

              {mode === 'custom' ? (
                <div className="space-y-2">
                  <Label htmlFor="default-prompt">Default prompt</Label>
                  <Textarea
                    id="default-prompt"
                    value={form.default_prompt}
                    onChange={(event) => set('default_prompt', event.target.value)}
                    className="min-h-20 text-[0.8rem]"
                    maxLength={4000}
                    placeholder="Describe what the model should extract."
                  />
                  <p className="text-[0.68rem] leading-relaxed text-muted-foreground">
                    Keep prompts short and specific. The model&apos;s layout prompt is the most
                    reliable starting point.
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/40 px-3 py-2.5">
                  <code className="font-mono text-[0.74rem]">document parsing.</code>
                  <Badge variant="outline">Recommended</Badge>
                </div>
              )}

              <Separator />

              <div className="space-y-3">
                <div className="flex items-end justify-between">
                  <div>
                    <Label>Default resolution</Label>
                    <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                      Higher DPI reads small type better and uses more memory.
                    </p>
                  </div>
                  <div className="flex items-baseline gap-1">
                    <span className="text-lg font-bold tabular-nums">{form.default_dpi}</span>
                    <span className="text-[0.65rem] font-semibold text-muted-foreground">DPI</span>
                  </div>
                </div>
                <Slider
                  min={120}
                  max={400}
                  step={10}
                  value={[form.default_dpi]}
                  onValueChange={([value]) => set('default_dpi', value)}
                  aria-label="Default resolution"
                />
                <div className="flex justify-between text-[0.62rem] text-muted-foreground">
                  <span>120</span>
                  <span>200 · balanced</span>
                  <span>400</span>
                </div>
              </div>

              <Separator />

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="default-tokens">Default token budget</Label>
                  <span className="text-[0.65rem] text-muted-foreground">per page</span>
                </div>
                <div className="flex gap-2">
                  <Input
                    id="default-tokens"
                    type="number"
                    min={512}
                    max={32768}
                    step={512}
                    value={form.default_max_tokens}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        set('default_max_tokens', Math.min(32768, Math.max(512, Math.round(value))))
                      }
                    }}
                    className="h-8.5 tabular-nums"
                  />
                  <div className="flex gap-1">
                    {tokenPresets.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => set('default_max_tokens', preset)}
                        className={
                          form.default_max_tokens === preset
                            ? 'rounded-md border border-primary/40 bg-primary/10 px-1.5 text-[0.62rem] font-semibold text-primary'
                            : 'rounded-md border border-border/70 px-1.5 text-[0.62rem] font-semibold text-muted-foreground hover:text-foreground'
                        }
                      >
                        {preset / 1024}k
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <Separator />

              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[0.8rem] font-semibold">Start the engine with the studio</div>
                  <p className="mt-0.5 text-[0.7rem] leading-relaxed text-muted-foreground">
                    Load Unlimited-OCR when the backend starts. Takes a few seconds after login.
                  </p>
                </div>
                <Switch
                  checked={form.auto_start_engine}
                  onCheckedChange={(checked) => set('auto_start_engine', checked)}
                  aria-label="Start engine automatically"
                />
              </div>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Model"
            description="Two interchangeable engines. Unlimited-OCR-2 uses Baidu's original weights; the GGUF build is faster but quantized."
            icon={<Layers3 className="size-3.5" />}
          >
            <ModelPicker
              settings={form}
              engines={engines.data}
              loading={engines.isLoading}
              onChange={(patch) => {
                setForm((current) => (current ? { ...current, ...patch } : current))
                setDirty(true)
              }}
            />
          </SettingsSection>

          <SettingsSection
            title="Local storage"
            description="Uploads, renders, and the SQLite archive stay under your project folder."
            icon={<Database className="size-3.5" />}
          >
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card">
              {[
                { label: 'Data folder', value: diagnostics.data?.data_dir, icon: FolderOpen },
                { label: 'Models folder', value: diagnostics.data?.models_dir, icon: HardDrive },
                { label: 'Job database', value: diagnostics.data?.db_path, icon: Database },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3 border-b border-border/60 px-4 py-3 last:border-b-0">
                  <row.icon className="size-3.5 shrink-0 text-muted-foreground/60" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[0.66rem] font-semibold tracking-wide text-muted-foreground uppercase">
                      {row.label}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[0.7rem]" title={row.value}>
                      {row.value ?? 'Loading…'}
                    </div>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => row.value && void copyPath(row.label, row.value)}
                    disabled={!row.value}
                    aria-label={`Copy ${row.label}`}
                  >
                    <Copy />
                  </Button>
                </div>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/80 bg-card px-4 py-3.5">
              <div>
                <div className="text-[0.8rem] font-semibold">Clear the archive</div>
                <p className="mt-0.5 text-[0.7rem] text-muted-foreground">
                  {totalJobs} job{totalJobs === 1 ? '' : 's'} stored · uploads are removed with their
                  jobs.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={activeWork || totalJobs === 0 || clear.isPending}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {clear.isPending ? <Loader2 className="animate-spin" /> : <Trash2 />}
                Clear history
              </Button>
            </div>
            {activeWork && (
              <div className="mt-3">
                <WarningNotice>
                  A job is running or queued. Clear history once the queue is empty.
                </WarningNotice>
              </div>
            )}
          </SettingsSection>
        </div>

        <div className="space-y-6">
          <SettingsSection
            title="Engine"
            description="One model, one local process, loaded on demand."
            icon={<Cpu className="size-3.5" />}
          >
            {health.data ? (
              <div className="space-y-3">
                <EngineControl health={health.data} compact />
                {!health.data.model.ready && (
                  <ErrorNotice
                    compact
                    title="Model not ready"
                    message={health.data.model.message}
                    hint={
                      health.data.model.download_command
                        ? `Run ${health.data.model.download_command}.`
                        : undefined
                    }
                  />
                )}
              </div>
            ) : (
              <Skeleton className="h-24 rounded-xl" />
            )}
          </SettingsSection>

          <SettingsSection
            title="This device"
            description="Hardware assigned to local inference."
            icon={<MonitorCog className="size-3.5" />}
          >
            <div className="rounded-xl border border-border/80 bg-card p-4">
              {health.data ? (
                <div className="divide-y divide-border/60">
                  {[
                    ['Hardware', `${health.data.system.machine} · ${health.data.system.cpu_count} cores`],
                    ['Memory', `${formatBytes(health.data.system.available_ram)} free of ${formatBytes(health.data.system.total_ram)}`],
                    ['Disk', `${formatBytes(health.data.system.disk_free)} free`],
                    ['llama.cpp', health.data.system.llama_version ?? 'Not detected'],
                    ['Model', health.data.model.model?.name ?? 'Missing'],
                  ].map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-3 py-2 first:pt-0 last:pb-0">
                      <span className="text-[0.68rem] text-muted-foreground">{label}</span>
                      <span className="max-w-[60%] truncate text-right text-[0.7rem] font-semibold" title={value}>
                        {value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Skeleton className="h-32" />
              )}
              <Separator className="my-3" />
              <Button variant="outline" size="sm" className="w-full" onClick={() => setSystemOpen(true)}>
                <MonitorCog /> System & engine details
              </Button>
            </div>
          </SettingsSection>

          <SettingsSection
            title="Privacy"
            description="What leaves this machine: nothing."
            icon={<ShieldCheck className="size-3.5" />}
          >
            <div className="rounded-xl border border-border/80 bg-card p-4">
              <div className="flex items-start gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
                <p className="text-[0.72rem] leading-relaxed text-muted-foreground">
                  Documents are rendered and parsed locally by the selected engine. The studio has no
                  telemetry, no accounts, and no remote API keys. The only network request is the
                  first model download, which you ran yourself.
                </p>
              </div>
              <Separator className="my-3" />
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[0.75rem] font-semibold">Unlimited-OCR</div>
                  <p className="text-[0.66rem] text-muted-foreground">Baidu · MIT license</p>
                </div>
                <a
                  href="https://huggingface.co/baidu/Unlimited-OCR"
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[0.68rem] font-semibold text-primary hover:underline"
                >
                  Model card <span aria-hidden>↗</span>
                </a>
              </div>
            </div>
          </SettingsSection>
        </div>
      </div>

      {dirty && (
        <div className="mt-6 flex justify-end border-t border-border/60 pt-4">
          <Button onClick={() => form && save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="animate-spin" /> : <Check />}
            Save changes
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Clear all history?"
        description={`This removes all ${totalJobs} job${totalJobs === 1 ? '' : 's'}, every rendered page, and uploads that are not used elsewhere. The model and settings are kept. This cannot be undone.`}
        confirmLabel="Clear everything"
        destructive
        icon={<Trash2 />}
        onConfirm={async () => {
          await clear.mutateAsync().catch(() => undefined)
        }}
      />

      {health.data && (
        <SystemDialog open={systemOpen} onOpenChange={setSystemOpen} health={health.data} />
      )}
    </div>
  )
}
