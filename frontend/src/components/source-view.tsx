import { useEffect, useState } from 'react'
import { ImageOff, Layers3, Maximize2, ScanLine } from 'lucide-react'
import type { JobPage, OcrBlock } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'

const labelColors: Record<string, string> = {
  title: '#b84a2b',
  text: '#2d5c88',
  abstract: '#2d5c88',
  table: '#2f6b4f',
  list: '#7a5a1e',
  formula: '#8a4d9e',
  figure: '#3f6d6a',
  image: '#3f6d6a',
  image_caption: '#3f6d6a',
  caption: '#3f6d6a',
  header: '#7d715d',
  footer: '#7d715d',
  page_number: '#7d715d',
  author: '#a0522d',
  date: '#7d715d',
  email: '#2d5c88',
  reference: '#7d715d',
  code: '#4a4a4a',
}

function colorFor(label: string): string {
  return labelColors[label.toLowerCase()] ?? '#6b6252'
}

function PageCanvas({
  page,
  showBoxes,
  activeBlock,
  onActiveBlock,
  className,
}: {
  page: JobPage
  showBoxes: boolean
  activeBlock: number | null
  onActiveBlock: (index: number | null) => void
  className?: string
}) {
  const [failed, setFailed] = useState(false)
  const [loading, setLoading] = useState(true)
  const blocks = page.blocks ?? []
  const aspect = page.width && page.height ? `${page.width} / ${page.height}` : undefined

  useEffect(() => {
    setFailed(false)
    setLoading(true)
  }, [page.image_url])

  if (!page.image_url) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/25 p-8 text-center">
        <ScanLine className="size-6 text-muted-foreground/50" />
        <div>
          <div className="text-sm font-semibold">The page render is not ready</div>
          <p className="mt-1 text-xs text-muted-foreground">
            It appears once the engine reaches this page.
          </p>
        </div>
      </div>
    )
  }

  if (failed) {
    return (
      <div className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-muted/25 p-8 text-center">
        <ImageOff className="size-6 text-muted-foreground/50" />
        <div>
          <div className="text-sm font-semibold">The page image is unavailable</div>
          <p className="mt-1 text-xs text-muted-foreground">
            The upload may have been deleted from local storage.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div
      className={cn('relative mx-auto w-fit max-w-full', className)}
      style={aspect ? { aspectRatio: aspect } : undefined}
    >
      {loading && (
        <div className="absolute inset-0 flex h-full min-h-64 w-full items-center justify-center">
          <Skeleton className="h-full min-h-64 w-full rounded-md" />
          <span className="absolute text-[0.68rem] font-semibold text-muted-foreground">
            Loading the page render…
          </span>
        </div>
      )}
      <img
        src={page.image_url}
        alt={`${page.upload_name} page ${page.page_number}`}
        loading="eager"
        decoding="async"
        onLoad={() => setLoading(false)}
        onError={() => {
          setLoading(false)
          setFailed(true)
        }}
        className={cn(
          'page-shadow block h-auto max-h-[68vh] w-auto max-w-full rounded-md border border-border/50 bg-white object-contain',
          loading && 'opacity-0',
        )}
      />
      {!loading && showBoxes && (
        <div className="pointer-events-none absolute inset-0 rounded-md">
          {blocks.map((block: OcrBlock, index: number) => {
            if (!block.box) return null
            const [x1, y1, x2, y2] = block.box
            const color = colorFor(block.label)
            const active = activeBlock === index
            return (
              <button
                key={`${block.label}-${index}`}
                type="button"
                onMouseEnter={() => onActiveBlock(index)}
                onMouseLeave={() => onActiveBlock(null)}
                onFocus={() => onActiveBlock(index)}
                onBlur={() => onActiveBlock(null)}
                aria-label={`${block.label}: ${block.text.slice(0, 80) || 'no text'}`}
                className="pointer-events-auto absolute cursor-crosshair rounded-[2px] transition-all duration-100"
                style={{
                  left: `${x1 / 10}%`,
                  top: `${y1 / 10}%`,
                  width: `${Math.max(0.4, (x2 - x1) / 10)}%`,
                  height: `${Math.max(0.4, (y2 - y1) / 10)}%`,
                  border: `1.5px solid ${color}`,
                  backgroundColor: `${color}${active ? '30' : '0d'}`,
                  boxShadow: active ? `0 0 0 2px ${color}30` : undefined,
                  zIndex: active ? 10 : 1,
                }}
              >
                <span
                  className="absolute -top-4 left-0 rounded-sm px-1 py-px text-[0.5rem] font-bold tracking-wide text-white uppercase"
                  style={{ backgroundColor: color }}
                >
                  {block.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function SourceView({ page }: { page: JobPage }) {
  const [showBoxes, setShowBoxes] = useState(true)
  const [activeBlock, setActiveBlock] = useState<number | null>(null)
  const [expanded, setExpanded] = useState(false)
  const blocks = page.blocks ?? []

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Switch
            id="show-layout-boxes"
            checked={showBoxes}
            onCheckedChange={setShowBoxes}
            aria-label="Show layout boxes"
          />
          <Label htmlFor="show-layout-boxes" className="flex items-center gap-1.5 text-[0.72rem]">
            <Layers3 className="size-3.5" />
            Layout boxes
          </Label>
          <Badge variant="outline">{blocks.length} blocks</Badge>
        </div>
        <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
          <Maximize2 /> Expand
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/70 bg-[#e9e2d4] p-3 sm:p-5 dark:bg-[#0e0d0a]">
        <PageCanvas
          page={page}
          showBoxes={showBoxes}
          activeBlock={activeBlock}
          onActiveBlock={setActiveBlock}
        />
      </div>

      {blocks.length > 0 && (
        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {blocks.map((block, index) => (
            <button
              key={`${block.label}-${index}`}
              type="button"
              onMouseEnter={() => setActiveBlock(index)}
              onMouseLeave={() => setActiveBlock(null)}
              onClick={() => setActiveBlock(index)}
              className={cn(
                'rounded-lg border px-2.5 py-2 text-left transition-colors',
                activeBlock === index
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/70 bg-card/45 hover:border-border',
              )}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="size-1.5 rounded-full"
                  style={{ backgroundColor: colorFor(block.label) }}
                />
                <span className="text-[0.6rem] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                  {block.label}
                </span>
                {block.box && (
                  <span className="ml-auto font-mono text-[0.55rem] text-muted-foreground/50">
                    {block.box.join(',')}
                  </span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-[0.72rem] leading-snug text-foreground/85">
                {block.text || '—'}
              </p>
            </button>
          ))}
        </div>
      )}

      {blocks.length === 0 && (
        <p className="mt-3 text-center text-[0.72rem] text-muted-foreground">
          This model response did not include layout coordinates.
        </p>
      )}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-6xl p-3 sm:p-4">
          <DialogTitle className="sr-only">
            {page.upload_name} page {page.page_number}
          </DialogTitle>
          <div className="flex items-center justify-between px-1 pb-3">
            <div className="text-xs font-semibold">
              {page.upload_name} · page {page.page_number}
            </div>
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Close
            </Button>
          </div>
          <div className="thin-scrollbar max-h-[80vh] overflow-auto rounded-lg bg-[#e9e2d4] p-3 dark:bg-[#0e0d0a]">
            <PageCanvas
              page={page}
              showBoxes={showBoxes}
              activeBlock={activeBlock}
              onActiveBlock={setActiveBlock}
              className="max-h-none"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
