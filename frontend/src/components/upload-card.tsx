import { useState } from 'react'
import { Check, ChevronDown, FileText, Image as ImageIcon, Trash2 } from 'lucide-react'
import type { Upload } from '@/lib/types'
import { formatBytes } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

export function UploadCard({
  upload,
  selected,
  onChange,
  onRemove,
  disabled = false,
}: {
  upload: Upload
  selected: number[]
  onChange: (pages: number[]) => void
  onRemove: () => void
  disabled?: boolean
}) {
  const [expanded, setExpanded] = useState(true)
  const selectedSet = new Set(selected)
  const allSelected = selected.length === upload.page_count
  const noneSelected = selected.length === 0

  const togglePage = (page: number) => {
    if (selectedSet.has(page)) onChange(selected.filter((value) => value !== page))
    else onChange([...selected, page].sort((a, b) => a - b))
  }

  return (
    <div
      className={cn(
        'rounded-xl border border-border/80 bg-card p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.55)_inset] transition-colors',
        noneSelected && 'border-dashed opacity-80',
      )}
    >
      <div className="flex items-start gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-muted/70 text-muted-foreground">
          {upload.kind === 'pdf' ? <FileText className="size-4.5" /> : <ImageIcon className="size-4.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="truncate text-[0.88rem] leading-snug font-semibold" title={upload.original_name}>
                {upload.original_name}
              </h3>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.68rem] text-muted-foreground">
                <span className="font-semibold tracking-wide uppercase">
                  {upload.kind === 'pdf' ? 'PDF' : upload.mime.replace('image/', '').toUpperCase().replace('JPEG', 'JPG')}
                </span>
                <span className="text-border">·</span>
                <span>{upload.page_count} page{upload.page_count === 1 ? '' : 's'}</span>
                <span className="text-border">·</span>
                <span>{formatBytes(upload.size)}</span>
              </div>
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={onRemove}
              disabled={disabled}
              className="shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              aria-label={`Remove ${upload.original_name}`}
              title="Remove from queue"
            >
              <Trash2 />
            </Button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="inline-flex items-center gap-1 rounded-md py-0.5 text-[0.7rem] font-semibold text-muted-foreground transition-colors hover:text-foreground"
            >
              <ChevronDown className={cn('size-3 transition-transform', !expanded && '-rotate-90')} />
              {allSelected ? 'All pages' : noneSelected ? 'No pages' : `${selected.length} of ${upload.page_count} pages`}
            </button>
            <span className="text-border">·</span>
            <button
              type="button"
              onClick={() => onChange(upload.pages.map((page) => page.page_number))}
              disabled={allSelected || disabled}
              className="text-[0.7rem] font-semibold text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
            >
              Select all
            </button>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={noneSelected || disabled}
              className="text-[0.7rem] font-semibold text-muted-foreground transition-colors hover:text-primary disabled:opacity-35"
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="thin-scrollbar mt-3 grid max-h-[238px] grid-cols-5 gap-1.5 overflow-y-auto border-t border-border/60 pt-3 pr-0.5 sm:grid-cols-7 md:grid-cols-6 xl:grid-cols-8">
          {upload.pages.map((page) => {
            const isSelected = selectedSet.has(page.page_number)
            return (
              <button
                key={page.id}
                type="button"
                onClick={() => togglePage(page.page_number)}
                disabled={disabled}
                aria-pressed={isSelected}
                aria-label={`Page ${page.page_number}${isSelected ? ' selected' : ''}`}
                className={cn(
                  'group/page relative aspect-[3/4] overflow-hidden rounded-md border bg-muted text-left transition-all duration-150',
                  isSelected
                    ? 'border-primary/50 ring-1 ring-primary/25'
                    : 'border-border/60 opacity-55 grayscale-[0.6] hover:opacity-90 hover:grayscale-0',
                  disabled && 'pointer-events-none',
                )}
              >
                <img
                  src={page.thumb_url}
                  alt={`Page ${page.page_number}`}
                  loading="lazy"
                  className="size-full object-cover object-top"
                />
                <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1 pt-3 pb-0.5 text-[0.58rem] font-bold text-white">
                  {page.page_number}
                </span>
                <span
                  className={cn(
                    'absolute top-1 right-1 flex size-3.5 items-center justify-center rounded-full border transition-all',
                    isSelected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-white/60 bg-black/20 opacity-0 group-hover/page:opacity-100',
                  )}
                >
                  {isSelected && <Check className="size-2.5" strokeWidth={3} />}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
