import { formatDistanceToNowStrict, parseISO } from 'date-fns'

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[index]}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  if (minutes < 60) return `${minutes}m ${rest}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true })
  } catch {
    return '—'
  }
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(parseISO(iso))
  } catch {
    return iso
  }
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(parseISO(iso))
  } catch {
    return iso
  }
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  return new Intl.NumberFormat().format(value)
}

export function percent(done: number, total: number): number {
  if (!total) return 0
  return Math.min(100, Math.round((done / total) * 100))
}

export function stem(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

export function jobTitle(uploads: { original_name: string }[]): string {
  if (!uploads.length) return 'Untitled job'
  if (uploads.length === 1) return stem(uploads[0].original_name)
  return `${stem(uploads[0].original_name)} +${uploads.length - 1}`
}

export function estimateSeconds(pages: number, dpi: number, batch: boolean): number {
  if (pages <= 0) return 0
  const perPage = 5.4 + Math.pow(dpi / 100, 1.45) * 1.9
  const startup = 2
  if (batch && pages > 1) return Math.round(startup + perPage * pages * 0.82)
  return Math.round(startup + perPage * pages)
}

export function formatEstimate(seconds: number): string {
  if (seconds <= 0) return '—'
  if (seconds < 60) return `~${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest > 10 ? `~${minutes}m ${rest}s` : `~${minutes}m`
}

export function titleCase(value: string): string {
  return value.replace(/(^|[\s_-])([a-z])/g, (_, prefix: string, char: string) => `${prefix}${char.toUpperCase()}`)
}

export function truncate(value: string, length: number): string {
  if (value.length <= length) return value
  return `${value.slice(0, length - 1).trimEnd()}…`
}
