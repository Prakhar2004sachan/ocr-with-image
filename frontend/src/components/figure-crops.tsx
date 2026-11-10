import { Image as ImageIcon } from 'lucide-react'
import type { JobPage, OcrBlock } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'

const FIGURE_LABELS = new Set(['image', 'figure'])

function cropGeometry(block: OcrBlock, page: JobPage) {
  if (!block.box) return null
  const [x1, y1, x2, y2] = block.box
  const width = page.width || 1000
  const height = page.height || 1000
  // The model emits normalized 0-1000 boxes; older/custom outputs may use
  // pixels. Mirror the backend's detection so both render correctly.
  const normalized = Math.max(x2, y2) <= 1000
  const fx1 = normalized ? x1 / 1000 : x1 / width
  const fy1 = normalized ? y1 / 1000 : y1 / height
  const fx2 = normalized ? x2 / 1000 : x2 / width
  const fy2 = normalized ? y2 / 1000 : y2 / height
  const fw = fx2 - fx1
  const fh = fy2 - fy1
  if (fw <= 0 || fh <= 0) return null
  return {
    aspectRatio: `${(fw * width) / (fh * height)}`,
    imageWidth: `${100 / fw}%`,
    imageHeight: `${100 / fh}%`,
    left: `${(-fx1 / fw) * 100}%`,
    top: `${(-fy1 / fh) * 100}%`,
  }
}

/**
 * Shows the figure/image regions the model found, cropped from the rendered
 * page. The exported Markdown embeds the same crops, so what you inspect here
 * is what the download contains.
 */
export function PageFigures({ page, className }: { page: JobPage; className?: string }) {
  if (!page.image_url) return null
  const figures = (page.blocks ?? []).filter((block) => {
    if (!FIGURE_LABELS.has(block.label.toLowerCase())) return false
    return cropGeometry(block, page) !== null
  })
  if (figures.length === 0) return null

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border border-border/70 bg-muted/20 p-3',
        className,
      )}
      data-testid="page-figures"
    >
      <div className="mb-2 flex items-center gap-2 text-[0.66rem] font-bold tracking-[0.14em] text-muted-foreground uppercase">
        <ImageIcon className="size-3.5" />
        Figures on this page
        <Badge variant="outline" className="ml-auto normal-case tracking-normal">
          {figures.length}
        </Badge>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {figures.map((block, index) => {
          const geometry = cropGeometry(block, page)
          if (!geometry) return null
          const label = block.text?.trim() || block.label
          return (
            <figure
              key={`${block.label}-${index}`}
              className="overflow-hidden rounded-lg border border-border/70 bg-card"
            >
              <div
                className="relative w-full overflow-hidden bg-muted"
                style={{ aspectRatio: geometry.aspectRatio }}
              >
                <img
                  src={page.image_url ?? ''}
                  alt={`${block.label} on page ${page.page_number}`}
                  loading="lazy"
                  className="absolute max-w-none"
                  style={{
                    width: geometry.imageWidth,
                    height: geometry.imageHeight,
                    left: geometry.left,
                    top: geometry.top,
                  }}
                />
              </div>
              <figcaption
                className="truncate px-2 py-1.5 text-[0.62rem] font-semibold text-muted-foreground"
                title={label}
              >
                {label}
              </figcaption>
            </figure>
          )
        })}
      </div>
    </div>
  )
}
