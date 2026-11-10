import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api, apiUrl } from '@/lib/api'
import { isActive, isTerminal } from '@/lib/job-options'
import type { Job, JobEvent } from '@/lib/types'

export type StreamState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed'

export function useJob(jobId: string | undefined) {
  return useQuery({
    queryKey: ['job', jobId],
    queryFn: () => api.job(jobId!),
    enabled: Boolean(jobId),
    staleTime: 2000,
    refetchInterval: (query) => {
      const job = query.state.data
      return job && isActive(job.status) ? 10_000 : false
    },
  })
}

export function useJobStream(jobId: string | undefined, enabled: boolean) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<StreamState>('idle')
  const [batchLive, setBatchLive] = useState('')

  useEffect(() => {
    if (!jobId || !enabled) {
      setState('idle')
      return
    }

    let source: EventSource | null = null
    let retryTimer: number | undefined
    let attempt = 0
    let stopped = false

    const close = () => {
      stopped = true
      source?.close()
      if (retryTimer) window.clearTimeout(retryTimer)
    }

    const isFinished = (job: Job | undefined): boolean => {
      if (!job || !isTerminal(job.status)) return false
      if (job.status === 'canceled' && job.pages.some((page) => page.status === 'running')) {
        return false
      }
      return true
    }

    const finish = () => {
      setState('closed')
      setBatchLive('')
      close()
      void queryClient.invalidateQueries({ queryKey: ['jobs'] })
      void queryClient.invalidateQueries({ queryKey: ['health'] })
    }

    const handle = (event: JobEvent) => {
      const key = ['job', jobId] as const
      switch (event.type) {
        case 'snapshot':
        case 'job_done': {
          if (!event.job) return
          queryClient.setQueryData<Job>(key, event.job)
          if (event.type === 'job_done' || isFinished(event.job)) finish()
          break
        }
        case 'job_update': {
          const patch = event.job
          if (!patch) return
          queryClient.setQueryData<Job>(key, (current) =>
            current
              ? {
                  ...current,
                  completed_pages: patch.completed_pages ?? current.completed_pages,
                  failed_pages: patch.failed_pages ?? current.failed_pages,
                }
              : current,
          )
          break
        }
        case 'page_start': {
          if (event.position === undefined) return
          queryClient.setQueryData<Job>(key, (current) =>
            current
              ? {
                  ...current,
                  pages: current.pages.map((page) =>
                    page.position === event.position ? { ...page, status: 'running' } : page,
                  ),
                }
              : current,
          )
          break
        }
        case 'page_update': {
          if (!event.page) return
          queryClient.setQueryData<Job>(key, (current) =>
            current
              ? {
                  ...current,
                  pages: current.pages.map((page) =>
                    page.position === event.page!.position ? event.page! : page,
                  ),
                }
              : current,
          )
          break
        }
        case 'page_delta': {
          if (event.position === undefined || !event.text) return
          queryClient.setQueryData<Job>(key, (current) =>
            current
              ? {
                  ...current,
                  pages: current.pages.map((page) =>
                    page.position === event.position
                      ? {
                          ...page,
                          status: page.status === 'pending' ? 'running' : page.status,
                          output_raw: `${page.output_raw ?? ''}${event.text}`,
                        }
                      : page,
                  ),
                }
              : current,
          )
          break
        }
        case 'job_delta': {
          if (event.text) setBatchLive((text) => text + event.text)
          break
        }
      }
    }

    const connect = () => {
      if (stopped) return
      setState(attempt === 0 ? 'connecting' : 'reconnecting')
      source = new EventSource(apiUrl(`/api/jobs/${encodeURIComponent(jobId)}/events`))
      source.onopen = () => {
        attempt = 0
        setState('open')
      }
      source.onmessage = (message) => {
        try {
          const event = JSON.parse(message.data) as JobEvent
          handle(event)
        } catch {
          /* ignore malformed event */
        }
      }
      source.onerror = () => {
        if (stopped) return
        source?.close()
        const current = queryClient.getQueryData<Job>(['job', jobId])
        if (isFinished(current)) {
          finish()
          return
        }
        attempt += 1
        setState('reconnecting')
        retryTimer = window.setTimeout(connect, Math.min(12_000, 750 * 2 ** Math.min(attempt, 4)))
      }
    }

    connect()
    return () => {
      close()
      setState('idle')
      setBatchLive('')
    }
  }, [jobId, enabled, queryClient])

  return { state, batchLive }
}
