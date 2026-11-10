import type { Job, JobOptions } from './types'

export const LAYOUT_PROMPT = 'document parsing.'

export const defaultOptions: JobOptions = {
  prompt: LAYOUT_PROMPT,
  prompt_mode: 'layout',
  dpi: 200,
  max_tokens: 8192,
  temperature: 0,
  top_p: 1,
  seed: -1,
  batch_mode: false,
  strip_repeated_margins: false,
  auto_retry_truncated: false,
  page_selection: {},
}

export function compactRange(pages: number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const parts: string[] = []
  let start = sorted[0]
  let previous = sorted[0]
  for (let index = 1; index <= sorted.length; index += 1) {
    const current = sorted[index]
    if (index < sorted.length && current === previous + 1) {
      previous = current
      continue
    }
    if (start === undefined) break
    if (start === previous) parts.push(String(start))
    else if (previous === start + 1) parts.push(`${start},${previous}`)
    else parts.push(`${start}-${previous}`)
    start = current
    previous = current
  }
  return parts.join(',')
}

export function specForSelection(pages: number[], pageCount: number): string {
  if (pages.length === 0) return ''
  if (pages.length === pageCount) return 'all'
  return compactRange(pages)
}

export function selectionLabel(pages: number[], pageCount: number): string {
  if (pages.length === pageCount) return `All ${pageCount} page${pageCount === 1 ? '' : 's'}`
  if (pages.length === 0) return 'No pages'
  return `${pages.length} of ${pageCount} pages`
}

export function totalPages(selection: Record<string, number[]>): number {
  return Object.values(selection).reduce((sum, pages) => sum + pages.length, 0)
}

export function clampSelection(pages: number[], pageCount: number): number[] {
  return [...new Set(pages)].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b)
}

export interface Draft {
  uploadIds: string[]
  selection: Record<string, number[]>
  options: JobOptions
  savedAt: number
}

const DRAFT_KEY = 'unlimited-ocr.draft.v1'

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Draft
    if (!Array.isArray(draft.uploadIds) || typeof draft.selection !== 'object') return null
    return {
      ...draft,
      options: { ...defaultOptions, ...draft.options },
    }
  } catch {
    return null
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    /* storage may be full or blocked */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    /* noop */
  }
}

export function optionsFromJob(job: Job): JobOptions {
  return { ...defaultOptions, ...job.options }
}

export const isTerminal = (status: Job['status']): boolean =>
  status === 'completed' || status === 'failed' || status === 'canceled' || status === 'partial'

export const isActive = (status: Job['status']): boolean =>
  status === 'queued' || status === 'preparing' || status === 'running'
