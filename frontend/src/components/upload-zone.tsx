import { useCallback, useMemo, useState } from 'react'
import { useDropzone, type FileRejection } from 'react-dropzone'
import { AlertCircle, ArrowUpRight, FilePlus2, Loader2, UploadCloud } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { formatBytes } from '@/lib/format'

const ACCEPT = {
  'application/pdf': ['.pdf'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/tiff': ['.tif', '.tiff'],
  'image/bmp': ['.bmp'],
  'image/gif': ['.gif'],
  'image/heic': ['.heic', '.heif'],
  'image/avif': ['.avif'],
}

const MAX_SIZE = 80 * 1024 * 1024

function rejectionMessage(rejection: FileRejection): string {
  const code = rejection.errors[0]?.code
  if (code === 'file-too-large') {
    return `${rejection.file.name} is ${formatBytes(rejection.file.size)} — the limit is 80 MB.`
  }
  if (code === 'file-invalid-type') {
    return `${rejection.file.name} is not a supported document or image.`
  }
  if (code === 'too-many-files') {
    return 'Choose at most 20 files at once.'
  }
  return rejection.errors[0]?.message ?? `${rejection.file.name} could not be added.`
}

export function UploadZone({
  onFiles,
  uploading,
  progress,
  compact = false,
  disabled = false,
}: {
  onFiles: (files: File[]) => void
  uploading: boolean
  progress: number
  compact?: boolean
  disabled?: boolean
}) {
  const [rejections, setRejections] = useState<string[]>([])

  const handleDrop = useCallback(
    (accepted: File[]) => {
      setRejections([])
      if (accepted.length) onFiles(accepted)
    },
    [onFiles],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDropAccepted: handleDrop,
    onDropRejected: (items) => setRejections(items.map(rejectionMessage)),
    accept: ACCEPT,
    maxSize: MAX_SIZE,
    maxFiles: 20,
    multiple: true,
    disabled: disabled || uploading,
  })

  const visibleRejections = useMemo(() => rejections.slice(0, 4), [rejections])

  if (compact) {
    return (
      <div>
        <div
          {...getRootProps()}
          className={cn(
            'group flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-border/90 bg-card/35 px-4 py-3.5 transition-colors hover:border-primary/40 hover:bg-card/70',
            isDragActive && 'border-primary bg-primary/5',
            (disabled || uploading) && 'pointer-events-none opacity-55',
          )}
        >
          <input {...getInputProps()} />
          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <FilePlus2 className="size-4" />}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[0.8rem] font-semibold">
              {uploading ? `Uploading… ${progress}%` : 'Add more pages'}
            </div>
            <div className="truncate text-[0.7rem] text-muted-foreground">
              Drop files or click to browse · PDF, images up to 80 MB
            </div>
          </div>
          <ArrowUpRight className="size-4 text-muted-foreground/60 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
        {uploading && <Progress value={progress} className="mt-2 h-1" />}
        {visibleRejections.length > 0 && (
          <div className="mt-2 space-y-1">
            {visibleRejections.map((message) => (
              <div key={message} className="flex items-start gap-1.5 text-[0.72rem] text-destructive">
                <AlertCircle className="mt-0.5 size-3 shrink-0" />
                {message}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          'group relative cursor-pointer overflow-hidden rounded-2xl border border-dashed border-border bg-card/55 px-6 py-10 text-center transition-all duration-300 hover:border-primary/45 hover:bg-card/85 sm:px-10 sm:py-14',
          isDragActive && 'scale-[1.005] border-primary bg-primary/[0.055] shadow-lg shadow-primary/5',
          (disabled || uploading) && 'pointer-events-none opacity-70',
        )}
      >
        <input {...getInputProps()} />
        <div className="grid-paper pointer-events-none absolute inset-0 opacity-[0.22]" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
        {!uploading && (
          <div className="pointer-events-none absolute inset-x-8 top-0 h-20 animate-scan bg-gradient-to-b from-transparent via-primary/[0.055] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        )}

        <div className="relative">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-border/80 bg-background/80 text-primary shadow-sm transition-transform duration-300 group-hover:-translate-y-0.5">
            {uploading ? (
              <Loader2 className="size-6 animate-spin" />
            ) : (
              <UploadCloud className="size-6" strokeWidth={1.6} />
            )}
          </div>

          <h2 className="font-display mt-5 text-2xl leading-tight sm:text-[2rem]">
            {uploading ? 'Reading your pages…' : isDragActive ? 'Drop it right here.' : 'Drop pages here.'}
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
            {uploading
              ? 'Uploading locally. Your files never leave this device.'
              : 'A PDF, a screenshot, a photograph, a whole report — the model reads layout, tables, formulas, and handwriting.'}
          </p>

          {uploading ? (
            <div className="mx-auto mt-6 w-full max-w-sm">
              <Progress value={progress} />
              <div className="mt-2 text-[0.72rem] font-semibold text-muted-foreground">
                {progress}% uploaded
              </div>
            </div>
          ) : (
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-border bg-background/70 px-4 py-2 text-[0.78rem] font-semibold shadow-xs transition-colors group-hover:border-primary/30 group-hover:text-primary">
              Browse files
              <ArrowUpRight className="size-3.5" />
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 text-[0.66rem] font-semibold tracking-wide text-muted-foreground/80">
            {['PDF', 'PNG', 'JPEG', 'WebP', 'TIFF', 'HEIC'].map((type) => (
              <span key={type} className="rounded border border-border/70 bg-background/40 px-1.5 py-0.5">
                {type}
              </span>
            ))}
            <span className="text-muted-foreground/50">·</span>
            <span>20 files</span>
            <span className="text-muted-foreground/50">·</span>
            <span>80 MB each</span>
          </div>
        </div>
      </div>

      {visibleRejections.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {visibleRejections.map((message) => (
            <div
              key={message}
              className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-[0.75rem] text-destructive"
            >
              <AlertCircle className="mt-0.5 size-3 shrink-0" />
              {message}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
