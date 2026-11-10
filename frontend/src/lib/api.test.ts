import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, apiUrl, fetchExportText, uploadFiles } from './api'
import type { Health } from './types'

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('request', () => {
  it('returns parsed JSON for a healthy call', async () => {
    const payload = { status: 'ok', version: '1.0.0' } as Health
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload))
    vi.stubGlobal('fetch', fetchMock)

    const health = await api.health()
    expect(health.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledWith('/api/health', expect.objectContaining({
      headers: expect.objectContaining({ Accept: 'application/json' }),
    }))
  })

  it('maps the backend error envelope onto ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({ detail: 'No engine', code: 'engine_unavailable', hint: 'Start it' }, 503),
      ),
    )
    await expect(api.health()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      code: 'engine_unavailable',
      message: 'No engine',
      hint: 'Start it',
    })
  })

  it('uses a readable fallback for plain-text errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('upstream exploded', { status: 502 })),
    )
    const error = await api.health().catch((reason) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.status).toBe(502)
    expect(error.message).toBe('upstream exploded')
  })

  it('reports a network failure like an unreachable backend', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    await expect(api.health()).rejects.toMatchObject({
      status: 0,
      code: 'backend_unreachable',
    })
  })

  it('sends JSON bodies and methods', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ default_dpi: 300 }))
    vi.stubGlobal('fetch', fetchMock)
    await api.updateSettings({ default_dpi: 300 })
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/settings')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ default_dpi: 300 })
    expect(init.headers['Content-Type']).toBe('application/json')
  })
})

describe('URL helpers', () => {
  it('builds api and export URLs with encoding', () => {
    expect(apiUrl('/api/health')).toBe('/api/health')
    expect(api.exportUrl('job 1', 'md')).toBe('/api/jobs/job%201/export?format=md')
    expect(api.exportUrl('job_1', 'json', 2)).toBe('/api/jobs/job_1/export?format=json&page=2')
  })

  it('builds job query strings only when needed', async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ items: [], total: 0, limit: 24, offset: 0 })),
    )
    vi.stubGlobal('fetch', fetchMock)
    await api.jobs({ limit: 10, offset: 5 })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/jobs?limit=10&offset=5&status=all')
    await api.jobs({ q: 'contract' })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/jobs?limit=24&offset=0&status=all&q=contract')
  })
})

class XhrStub {
  static nextStatus = 200
  static nextResponse: unknown = { uploads: [], errors: [] }
  upload = { onprogress: null as ((event: { lengthComputable: boolean; loaded: number; total: number }) => void) | null }
  responseType = ''
  status = 0
  response: unknown = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  method = ''
  url = ''

  open(method: string, url: string) {
    this.method = method
    this.url = url
  }

  send() {
    this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 })
    this.status = XhrStub.nextStatus
    this.response = XhrStub.nextResponse
    if (this.status >= 200 && this.status < 300) this.onload?.()
    else this.onload?.()
  }
}

describe('fetchExportText', () => {
  it('returns the Markdown body used by copy and export', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('# OCR\n\n![image](data:image/png;base64,AAA)')),
    )
    const text = await fetchExportText('job_1')
    expect(text).toContain('data:image/png;base64,')
  })

  it('maps export failures onto ApiError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse({ detail: 'No job', code: 'job_missing' }, 404)),
    )
    await expect(fetchExportText('job_missing')).rejects.toMatchObject({
      status: 404,
      code: 'job_missing',
    })
  })
})

describe('uploadFiles', () => {
  it('reports progress and resolves the batch response', async () => {
    XhrStub.nextStatus = 200
    XhrStub.nextResponse = { uploads: [{ id: 'up_1' }], errors: [] }
    vi.stubGlobal('XMLHttpRequest', XhrStub)
    const progress: number[] = []
    const result = await uploadFiles(
      [new File(['x'], 'page.png', { type: 'image/png' })],
      (value) => progress.push(value),
    )
    expect(progress).toEqual([50, 100])
    expect(result.uploads[0].id).toBe('up_1')
  })

  it('rejects with the backend error envelope', async () => {
    XhrStub.nextStatus = 413
    XhrStub.nextResponse = { detail: 'Too large', code: 'payload_too_large', hint: 'Compress it' }
    vi.stubGlobal('XMLHttpRequest', XhrStub)
    await expect(
      uploadFiles([new File(['x'], 'huge.pdf', { type: 'application/pdf' })]),
    ).rejects.toMatchObject({ status: 413, code: 'payload_too_large', message: 'Too large' })
  })
})
