import { describe, expect, it } from 'vitest'
import {
  clearDraft,
  clampSelection,
  compactRange,
  defaultOptions,
  isActive,
  isTerminal,
  loadDraft,
  optionsFromJob,
  saveDraft,
  selectionLabel,
  specForSelection,
  totalPages,
} from './job-options'
import type { Job } from './types'

describe('compactRange', () => {
  it('renders single pages, pairs and ranges', () => {
    expect(compactRange([1])).toBe('1')
    expect(compactRange([1, 2])).toBe('1,2')
    expect(compactRange([1, 2, 3])).toBe('1-3')
    expect(compactRange([1, 3, 4, 7, 8, 9])).toBe('1,3,4,7-9')
  })

  it('sorts and de-duplicates input', () => {
    expect(compactRange([5, 3, 3, 4, 1])).toBe('1,3-5')
  })

  it('returns an empty string for no pages', () => {
    expect(compactRange([])).toBe('')
  })
})

describe('selection helpers', () => {
  it('uses `all` only when every page is selected', () => {
    expect(specForSelection([1, 2, 3], 3)).toBe('all')
    expect(specForSelection([1, 3], 3)).toBe('1,3')
    expect(specForSelection([], 3)).toBe('')
  })

  it('labels selections', () => {
    expect(selectionLabel([1, 2], 2)).toBe('All 2 pages')
    expect(selectionLabel([1], 3)).toBe('1 of 3 pages')
    expect(selectionLabel([], 3)).toBe('No pages')
    expect(selectionLabel([1], 1)).toBe('All 1 page')
  })

  it('totals and clamps selections', () => {
    expect(totalPages({ a: [1, 2], b: [3] })).toBe(3)
    expect(clampSelection([0, 1, 2, 2, 9], 3)).toEqual([1, 2])
  })
})

describe('draft persistence', () => {
  it('round-trips a draft and merges defaults', () => {
    saveDraft({
      uploadIds: ['up_1'],
      selection: { up_1: [1, 2] },
      options: { ...defaultOptions, dpi: 300 },
      savedAt: 1,
    })
    const draft = loadDraft()
    expect(draft?.uploadIds).toEqual(['up_1'])
    expect(draft?.options.dpi).toBe(300)
    expect(draft?.options.prompt).toBe(defaultOptions.prompt)
  })

  it('returns null for corrupt or missing drafts', () => {
    expect(loadDraft()).toBeNull()
    localStorage.setItem('unlimited-ocr.draft.v1', 'not-json')
    expect(loadDraft()).toBeNull()
    localStorage.setItem('unlimited-ocr.draft.v1', JSON.stringify({ uploadIds: 'x' }))
    expect(loadDraft()).toBeNull()
  })

  it('clears drafts', () => {
    saveDraft({ uploadIds: [], selection: {}, options: defaultOptions, savedAt: 1 })
    clearDraft()
    expect(loadDraft()).toBeNull()
  })
})

describe('job state helpers', () => {
  it('identifies terminal and active statuses', () => {
    expect(isTerminal('completed')).toBe(true)
    expect(isTerminal('failed')).toBe(true)
    expect(isTerminal('partial')).toBe(true)
    expect(isTerminal('canceled')).toBe(true)
    expect(isTerminal('running')).toBe(false)
    expect(isActive('queued')).toBe(true)
    expect(isActive('preparing')).toBe(true)
    expect(isActive('running')).toBe(true)
    expect(isActive('failed')).toBe(false)
  })

  it('merges job options over defaults', () => {
    const job = {
      options: { ...defaultOptions, dpi: 320, batch_mode: true },
    } as unknown as Job
    const options = optionsFromJob(job)
    expect(options.dpi).toBe(320)
    expect(options.batch_mode).toBe(true)
    expect(options.prompt_mode).toBe('layout')
  })
})
