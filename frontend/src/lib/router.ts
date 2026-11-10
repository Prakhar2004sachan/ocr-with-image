import { useSyncExternalStore } from 'react'

export type Route =
  | { name: 'workspace' }
  | { name: 'history' }
  | { name: 'settings' }
  | { name: 'job'; id: string }

export function parseRoute(): Route {
  const raw = window.location.hash.replace(/^#/, '') || '/'
  const path = raw.split('?')[0]
  if (path === '/history') return { name: 'history' }
  if (path === '/settings') return { name: 'settings' }
  const job = /^\/jobs\/([^/]+)$/.exec(path)
  if (job) return { name: 'job', id: decodeURIComponent(job[1]) }
  return { name: 'workspace' }
}

let cachedRoute: Route = parseRoute()
const listeners = new Set<() => void>()

function refresh(): void {
  const next = parseRoute()
  const same =
    next.name === cachedRoute.name &&
    (next.name !== 'job' || (cachedRoute.name === 'job' && next.id === cachedRoute.id))
  cachedRoute = next
  if (!same) for (const listener of listeners) listener()
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback)
  window.addEventListener('hashchange', refresh)
  return () => {
    listeners.delete(callback)
    if (listeners.size === 0) window.removeEventListener('hashchange', refresh)
  }
}

export function useRoute(): Route {
  return useSyncExternalStore(subscribe, () => cachedRoute, () => cachedRoute)
}

export function navigate(path: string): void {
  const next = path.startsWith('/') ? path : `/${path}`
  if (window.location.hash === `#${next}`) {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return
  }
  window.location.hash = next
}

export function routeHref(path: string): string {
  return `#${path.startsWith('/') ? path : `/${path}`}`
}
