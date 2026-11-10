import { useState } from 'react'
import {
  ChevronDown,
  Gauge,
  Layers3,
  Lock,
  ScanText,
  SlidersHorizontal,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import type { JobOptions } from '@/lib/types'
import { formatEstimate, estimateSeconds } from '@/lib/format'
import { LAYOUT_PROMPT } from '@/lib/job-options'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

const tokenPresets = [2048, 4096, 8192, 16384, 32768]

export function OptionsPanel({
  options,
  onChange,
  totalPages,
  running,
  onRun,
  onReset,
  engineReady = true,
}: {
  options: JobOptions
  onChange: (next: JobOptions) => void
  totalPages: number
  running: boolean
  onRun: () => void
  onReset: () => void
  engineReady?: boolean
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const batchEligible = totalPages >= 2 && totalPages <= 4
  const estimate = formatEstimate(estimateSeconds(totalPages, options.dpi, options.batch_mode))
  const advancedCount = [
    options.batch_mode,
    options.strip_repeated_margins,
    options.auto_retry_truncated,
    options.temperature !== 0,
    options.seed !== -1,
  ].filter(Boolean).length
  const canRun = totalPages > 0 && totalPages <= 50 && !running && engineReady

  const set = (patch: Partial<JobOptions>) => onChange({ ...options, ...patch })

  const setMode = (mode: 'layout' | 'custom') => {
    if (mode === 'layout') {
      set({ prompt_mode: 'layout', prompt: LAYOUT_PROMPT })
    } else {
      set({
        prompt_mode: 'custom',
        prompt: options.prompt_mode === 'layout' ? '' : options.prompt,
      })
    }
  }

  return (
    <div className="sticky top-6 overflow-hidden rounded-2xl border border-border/80 bg-card shadow-[0_1px_0_rgba(255,255,255,0.6)_inset,0_18px_48px_-32px_rgba(35,25,8,0.35)]">
      <div className="flex items-center justify-between border-b border-border/70 px-4.5 py-4">
        <div className="flex items-center gap-2.5">
          <div className="flex size-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <SlidersHorizontal className="size-3.5" />
          </div>
          <div>
            <div className="text-[0.82rem] font-semibold">Parse settings</div>
            <div className="text-[0.66rem] text-muted-foreground">Tuned for this device</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onReset}
          className="text-[0.67rem] font-semibold text-muted-foreground transition-colors hover:text-primary"
        >
          Reset
        </button>
      </div>

      <div className="space-y-5 px-4.5 py-4.5">
        <div className="space-y-2">
          <Label>Reading mode</Label>
          <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/80 p-1">
            <button
              type="button"
              onClick={() => setMode('layout')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.74rem] font-semibold transition-all',
                options.prompt_mode !== 'custom'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Layers3 className="size-3.5" /> Layout
            </button>
            <button
              type="button"
              onClick={() => setMode('custom')}
              className={cn(
                'flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.74rem] font-semibold transition-all',
                options.prompt_mode === 'custom'
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <WandSparkles className="size-3.5" /> Custom
            </button>
          </div>

          {options.prompt_mode === 'custom' ? (
            <>
              <Textarea
                value={options.prompt}
                onChange={(event) => set({ prompt: event.target.value, prompt_mode: 'custom' })}
                placeholder="Describe what to extract, e.g. “Extract every table as Markdown.”"
                className="min-h-20 text-[0.8rem]"
                maxLength={4000}
              />
              <p className="flex items-start gap-1.5 text-[0.67rem] leading-relaxed text-warning">
                <Sparkles className="mt-0.5 size-3 shrink-0" />
                Free-form prompts can trigger repetition loops. The layout prompt is the most
                reliable.
              </p>
            </>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/45 px-3 py-2">
              <code className="font-mono text-[0.73rem] text-foreground">{LAYOUT_PROMPT}</code>
              <Badge variant="outline" className="border-border/70 text-[0.56rem]">
                default
              </Badge>
            </div>
          )}
        </div>

        <div className="space-y-2.5">
          <div className="flex items-end justify-between">
            <Label>Resolution</Label>
            <div className="flex items-baseline gap-1">
              <span className="text-sm font-bold tabular-nums">{options.dpi}</span>
              <span className="text-[0.65rem] font-semibold text-muted-foreground">DPI</span>
            </div>
          </div>
          <Slider
            min={120}
            max={400}
            step={10}
            value={[options.dpi]}
            onValueChange={([value]) => set({ dpi: value })}
            aria-label="Render resolution in DPI"
          />
          <div className="flex justify-between text-[0.62rem] text-muted-foreground">
            <span>120 · faster</span>
            <button
              type="button"
              onClick={() => set({ dpi: 200 })}
              className="font-semibold text-muted-foreground transition-colors hover:text-primary"
            >
              200 · recommended
            </button>
            <span>400 · sharp</span>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-end justify-between">
            <Label htmlFor="max-tokens">Token budget</Label>
            <span className="text-[0.65rem] text-muted-foreground">per page</span>
          </div>
          <div className="flex gap-2">
            <Input
              id="max-tokens"
              type="number"
              min={512}
              max={32768}
              step={512}
              value={options.max_tokens}
              onChange={(event) => {
                const value = Number(event.target.value)
                if (Number.isFinite(value)) {
                  set({ max_tokens: Math.min(32768, Math.max(512, Math.round(value))) })
                }
              }}
              className="h-8.5 text-[0.8rem] tabular-nums"
            />
            <div className="flex gap-1">
              {tokenPresets.slice(0, 4).map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => set({ max_tokens: preset })}
                  className={cn(
                    'rounded-md border px-1.5 text-[0.62rem] font-semibold tabular-nums transition-colors',
                    options.max_tokens === preset
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/70 text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                  )}
                >
                  {preset / 1024}k
                </button>
              ))}
            </div>
          </div>
          <p className="text-[0.66rem] leading-relaxed text-muted-foreground">
            Raise it for dense tables or long pages. Truncated pages show a warning.
          </p>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between rounded-lg border border-transparent py-1 text-left transition-colors hover:text-primary"
            >
              <span className="flex items-center gap-1.5 text-[0.72rem] font-semibold text-muted-foreground">
                <Gauge className="size-3.5" /> Advanced
                {advancedCount > 0 && (
                  <Badge variant="primary" className="ml-1 px-1.5 py-0 text-[0.55rem]">
                    {advancedCount}
                  </Badge>
                )}
              </span>
              <ChevronDown
                className={cn(
                  'size-3.5 text-muted-foreground transition-transform',
                  advancedOpen && 'rotate-180',
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-4 rounded-xl border border-border/70 bg-muted/30 p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[0.76rem] font-semibold">One-request batch</div>
                  <p className="mt-0.5 text-[0.65rem] leading-relaxed text-muted-foreground">
                    {batchEligible
                      ? 'Parse up to four pages in a single pass.'
                      : 'Available for jobs with 2–4 pages.'}
                  </p>
                </div>
                <Switch
                  checked={options.batch_mode && batchEligible}
                  disabled={!batchEligible}
                  onCheckedChange={(checked) => set({ batch_mode: checked && batchEligible })}
                  aria-label="Use batch mode"
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[0.76rem] font-semibold">Strip running margins</div>
                  <p className="mt-0.5 text-[0.65rem] leading-relaxed text-muted-foreground">
                    Remove repeated headers and footers across 3+ pages.
                  </p>
                </div>
                <Switch
                  checked={options.strip_repeated_margins}
                  onCheckedChange={(checked) => set({ strip_repeated_margins: checked })}
                  aria-label="Strip repeated margins"
                />
              </div>

              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[0.76rem] font-semibold">Retry truncated pages</div>
                  <p className="mt-0.5 text-[0.65rem] leading-relaxed text-muted-foreground">
                    One automatic retry with double the token budget.
                  </p>
                </div>
                <Switch
                  checked={options.auto_retry_truncated}
                  onCheckedChange={(checked) => set({ auto_retry_truncated: checked })}
                  aria-label="Retry truncated pages"
                />
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-border/60 pt-3.5">
                <div className="space-y-1.5">
                  <Label htmlFor="temperature" className="text-[0.68rem]">
                    Temperature
                  </Label>
                  <Input
                    id="temperature"
                    type="number"
                    min={0}
                    max={1.5}
                    step={0.1}
                    value={options.temperature}
                    onChange={(event) => {
                      const value = Number(event.target.value)
                      if (Number.isFinite(value)) {
                        set({ temperature: Math.min(1.5, Math.max(0, value)) })
                      }
                    }}
                    className="h-8 text-[0.75rem] tabular-nums"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="seed" className="text-[0.68rem]">
                    Seed
                  </Label>
                  <Input
                    id="seed"
                    type="number"
                    value={options.seed}
                    onChange={(event) => set({ seed: Math.round(Number(event.target.value) || -1) })}
                    className="h-8 text-[0.75rem] tabular-nums"
                  />
                </div>
              </div>
              <div className="flex items-start gap-1.5 text-[0.63rem] leading-relaxed text-muted-foreground">
                <Lock className="mt-0.5 size-3 shrink-0" />
                Temperature 0 and seed −1 are the most faithful defaults for OCR.
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      <div className="border-t border-border/70 bg-muted/25 px-4.5 py-4">
        <div className="mb-3 flex items-center justify-between text-[0.72rem]">
          <span className="text-muted-foreground">
            {totalPages} page{totalPages === 1 ? '' : 's'} selected
          </span>
          <span className="flex items-center gap-1.5 font-semibold text-muted-foreground">
            <ScanText className="size-3.5" /> {estimate}
          </span>
        </div>
        {totalPages > 50 && (
          <p className="mb-2 text-[0.7rem] font-medium text-destructive">
            Select at most 50 pages per job.
          </p>
        )}
        {!engineReady && (
          <p className="mb-2 text-[0.7rem] font-medium text-warning">
            The local model is not ready. Check System & engine.
          </p>
        )}
        <Button
          size="lg"
          className="w-full rounded-xl shadow-md shadow-primary/15"
          onClick={onRun}
          disabled={!canRun}
        >
          {running ? (
            <>
              <span className="size-3.5 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
              Queueing job…
            </>
          ) : (
            <>
              <ScanText /> Start reading
            </>
          )}
        </Button>
        <p className="mt-2.5 text-center text-[0.63rem] text-muted-foreground">
          Runs locally · ~{options.dpi} DPI · {options.prompt_mode === 'custom' ? 'custom prompt' : 'layout-aware'}
        </p>
      </div>
    </div>
  )
}
