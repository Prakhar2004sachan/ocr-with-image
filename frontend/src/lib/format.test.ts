import { describe, expect, it } from 'vitest'
import {
  estimateSeconds,
  formatBytes,
  formatClock,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEstimate,
  formatNumber,
  formatRelative,
  jobTitle,
  percent,
  stem,
  titleCase,
  truncate,
} from './format'

describe('formatBytes', () => {
  it('formats every unit and the empty value', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(15 * 1024)).toBe('15 KB')
    expect(formatBytes(3.4 * 1024 * 1024)).toBe('3.4 MB')
    expect(formatBytes(2.2 * 1024 * 1024 * 1024)).toBe('2.2 GB')
  })
})

describe('formatDuration', () => {
  it('formats milliseconds through hours', () => {
    expect(formatDuration(null)).toBe('—')
    expect(formatDuration(999)).toBe('999 ms')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(formatDuration(15_000)).toBe('15 s')
    expect(formatDuration(65_000)).toBe('1m 5s')
    expect(formatDuration(3_665_000)).toBe('1h 1m')
  })

  it('formats clocks', () => {
    expect(formatClock(0)).toBe('00:00')
    expect(formatClock(65_000)).toBe('01:05')
    expect(formatClock(-5)).toBe('00:00')
  })
})

describe('date helpers', () => {
  it('handles invalid values', () => {
    expect(formatRelative(null)).toBe('—')
    expect(formatRelative('not-a-date')).toBe('—')
    expect(formatDateTime(null)).toBe('—')
    expect(formatDate(null)).toBe('—')
  })

  it('formats valid ISO values', () => {
    expect(formatRelative(new Date(Date.now() - 60_000).toISOString())).toContain('ago')
    expect(formatDate('2024-01-15T10:00:00Z')).toMatch(/2024/)
  })
})

describe('small formatters', () => {
  it('formats numbers and percentages', () => {
    expect(formatNumber(null)).toBe('—')
    expect(formatNumber(1234)).toBe('1,234')
    expect(percent(1, 4)).toBe(25)
    expect(percent(0, 0)).toBe(0)
    expect(percent(5, 4)).toBe(100)
  })

  it('derives job titles from upload names', () => {
    expect(jobTitle([])).toBe('Untitled job')
    expect(jobTitle([{ original_name: 'report.pdf' }])).toBe('report')
    expect(jobTitle([{ original_name: 'a.pdf' }, { original_name: 'b.pdf' }])).toBe('a +1')
    expect(stem('archive.tar.gz')).toBe('archive.tar')
  })

  it('estimates and labels durations', () => {
    expect(estimateSeconds(0, 200, false)).toBe(0)
    expect(estimateSeconds(1, 200, false)).toBeGreaterThan(0)
    expect(estimateSeconds(4, 200, true)).toBeLessThan(estimateSeconds(4, 200, false))
    expect(formatEstimate(0)).toBe('—')
    expect(formatEstimate(30)).toBe('~30s')
    expect(formatEstimate(125)).toBe('~2m')
    expect(formatEstimate(140)).toBe('~2m 20s')
  })

  it('title-cases and truncates', () => {
    expect(titleCase('page_number here')).toBe('Page_Number Here')
    expect(truncate('short', 10)).toBe('short')
    expect(truncate('a very long sentence', 8)).toBe('a very…')
  })
})
