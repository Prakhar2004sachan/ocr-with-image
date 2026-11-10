import { beforeEach, describe, expect, it, vi } from 'vitest'
import { navigate, parseRoute, routeHref } from './router'

beforeEach(() => {
  window.location.hash = ''
})

describe('parseRoute', () => {
  it('defaults to the workspace', () => {
    expect(parseRoute()).toEqual({ name: 'workspace' })
    expect(parseRoute()).toEqual({ name: 'workspace' })
  })

  it('parses history, settings and job routes', () => {
    window.location.hash = '#/history'
    expect(parseRoute()).toEqual({ name: 'history' })
    window.location.hash = '#/settings'
    expect(parseRoute()).toEqual({ name: 'settings' })
    window.location.hash = '#/jobs/job_abc123'
    expect(parseRoute()).toEqual({ name: 'job', id: 'job_abc123' })
  })

  it('decodes job ids and ignores query strings', () => {
    window.location.hash = '#/jobs/job_a%2Fb?tab=raw'
    expect(parseRoute()).toEqual({ name: 'job', id: 'job_a/b' })
  })

  it('falls back to the workspace for unknown routes', () => {
    window.location.hash = '#/nope'
    expect(parseRoute()).toEqual({ name: 'workspace' })
  })
})

describe('navigate', () => {
  it('prefixes paths with a slash', () => {
    navigate('history')
    expect(window.location.hash).toBe('#/history')
    navigate('/settings')
    expect(window.location.hash).toBe('#/settings')
  })

  it('scrolls instead of duplicating the current route', () => {
    window.location.hash = '#/history'
    const scroll = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    navigate('/history')
    expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
  })

  it('builds hash hrefs', () => {
    expect(routeHref('/jobs/job_1')).toBe('#/jobs/job_1')
    expect(routeHref('settings')).toBe('#/settings')
  })
})
