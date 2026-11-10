import type {
  AppSettings,
  DeleteResponse,
  Diagnostics,
  EngineFacts,
  EngineStatus,
  ExportFormat,
  Health,
  Job,
  JobList,
  JobOptions,
  SettingsUpdate,
  Upload,
  UploadBatchResponse,
} from './types'

const BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly hint: string | null

  constructor(message: string, status = 0, code = 'network_error', hint: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.hint = hint
  }
}

type ErrorPayload = {
  detail?: string
  code?: string
  hint?: string | null
  message?: string
}

function errorFrom(payload: unknown, status: number): ApiError {
  const body = (payload ?? {}) as ErrorPayload
  const fallback =
    status === 404
      ? 'The requested item no longer exists.'
      : status >= 500
        ? 'The backend ran into a problem.'
        : 'The request could not be completed.'
  return new ApiError(body.detail ?? body.message ?? fallback, status, body.code ?? 'error', body.hint ?? null)
}

function networkError(): ApiError {
  return new ApiError(
    'Could not reach the OCR backend.',
    0,
    'backend_unreachable',
    'Make sure the Python backend is running on port 8000.',
  )
}

async function request<T>(path: string, init?: RequestInit, timeoutMs = 30_000): Promise<T> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${BASE}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    })
    const text = await response.text()
    let payload: unknown = null
    if (text) {
      try {
        payload = JSON.parse(text)
      } catch {
        payload = { detail: text.slice(0, 400) }
      }
    }
    if (!response.ok) throw errorFrom(payload, response.status)
    return payload as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The request timed out.', 0, 'timeout', 'The engine may still be loading.')
    }
    throw networkError()
  } finally {
    window.clearTimeout(timer)
  }
}

export function apiUrl(path: string): string {
  return `${BASE}${path}`
}

export interface JobQuery {
  limit?: number
  offset?: number
  status?: string
  q?: string
}

export const api = {
  health: () => request<Health>('/api/health', undefined, 15_000),
  diagnostics: () => request<Diagnostics>('/api/system/diagnostics', undefined, 20_000),
  models: () => request<Health['model']>('/api/system/models'),
  engineStart: () => request<EngineStatus>('/api/system/engine/start', { method: 'POST' }, 190_000),
  engineStop: () => request<EngineStatus>('/api/system/engine/stop', { method: 'POST' }, 30_000),
  engineRestart: () =>
    request<EngineStatus>('/api/system/engine/restart', { method: 'POST' }, 190_000),
  logs: async (target: 'engine' | 'backend', lines = 300): Promise<string> => {
    const response = await fetch(`${BASE}/api/system/logs?target=${target}&lines=${lines}`, {
      headers: { Accept: 'text/plain' },
    })
    if (!response.ok) throw new Error(`Could not load ${target} logs.`)
    return response.text()
  },
  clearHistory: () => request<DeleteResponse>('/api/system/clear-history', { method: 'POST' }, 60_000),

  uploads: (ids: string[]) =>
    Promise.all(
      ids.map((id) =>
        request<Upload>(`/api/uploads/${encodeURIComponent(id)}`).catch((error) => {
          if (error instanceof ApiError && error.status === 404) return null
          throw error
        }),
      ),
    ),
  deleteUpload: (id: string) =>
    request<DeleteResponse>(`/api/uploads/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  jobs: ({ limit = 24, offset = 0, status = 'all', q = '' }: JobQuery = {}) => {
    const params = new URLSearchParams({
      limit: String(limit),
      offset: String(offset),
      status,
    })
    if (q.trim()) params.set('q', q.trim())
    return request<JobList>(`/api/jobs?${params.toString()}`)
  },
  job: (id: string) => request<Job>(`/api/jobs/${encodeURIComponent(id)}`),
  createJob: (uploadIds: string[], options: JobOptions) =>
    request<Job>(
      '/api/jobs',
      {
        method: 'POST',
        body: JSON.stringify({ upload_ids: uploadIds, options }),
      },
      45_000,
    ),
  cancelJob: (id: string) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }, 30_000),
  rerunJob: (id: string) =>
    request<Job>(`/api/jobs/${encodeURIComponent(id)}/rerun`, { method: 'POST' }, 45_000),
  deleteJob: (id: string) =>
    request<DeleteResponse>(`/api/jobs/${encodeURIComponent(id)}`, { method: 'DELETE' }, 30_000),

  settings: () => request<AppSettings>('/api/settings'),
  updateSettings: (patch: Partial<SettingsUpdate>) =>
    request<AppSettings>('/api/settings', { method: 'PUT', body: JSON.stringify(patch) }),
  resetSettings: () => request<AppSettings>('/api/settings/reset', { method: 'POST' }),
  engines: () => request<EngineFacts>('/api/system/engines'),

  exportUrl: (id: string, format: ExportFormat, page?: number) => {
    const params = new URLSearchParams({ format })
    if (page !== undefined) params.set('page', String(page))
    return `${BASE}/api/jobs/${encodeURIComponent(id)}/export?${params.toString()}`
  },
}

export function uploadFiles(
  files: File[],
  onProgress?: (percent: number) => void,
): Promise<UploadBatchResponse> {
  return new Promise((resolve, reject) => {
    const form = new FormData()
    for (const file of files) form.append('files', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${BASE}/api/uploads`)
    xhr.responseType = 'json'
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100))
    }
    xhr.onload = () => {
      const payload = xhr.response
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100)
        resolve(payload as UploadBatchResponse)
        return
      }
      reject(errorFrom(payload, xhr.status))
    }
    xhr.onerror = () => reject(networkError())
    xhr.onabort = () => reject(new ApiError('Upload canceled.', 0, 'upload_canceled'))
    xhr.send(form)
  })
}

export async function fetchExportText(
  jobId: string,
  format: ExportFormat = 'md',
  page?: number,
): Promise<string> {
  const response = await fetch(api.exportUrl(jobId, format, page), {
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      /* noop */
    }
    throw errorFrom(payload, response.status)
  }
  return response.text()
}

export async function downloadExport(
  job: Job,
  format: ExportFormat,
  page?: number,
): Promise<void> {
  const response = await fetch(api.exportUrl(job.id, format, page), {
    signal: AbortSignal.timeout(120_000),
  })
  if (!response.ok) {
    let payload: unknown = null
    try {
      payload = await response.json()
    } catch {
      /* noop */
    }
    throw errorFrom(payload, response.status)
  }
  const blob = await response.blob()
  const disposition = response.headers.get('Content-Disposition') ?? ''
  const match = /filename="?([^";]+)"?/i.exec(disposition)
  const fallbackStem = (job.uploads[0]?.original_name ?? 'unlimited-ocr').replace(/\.[^.]+$/, '')
  const filename = match?.[1] ?? `${fallbackStem}${page !== undefined ? `-page-${page + 1}` : ''}-ocr.${format}`
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      area.remove()
      return ok
    } catch {
      return false
    }
  }
}
