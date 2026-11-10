import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark'

const KEY = 'unlimited-ocr.theme'
let current: Theme | null = null
const listeners = new Set<() => void>()

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', theme === 'dark' ? '#0d0c09' : '#17140f')
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    /* noop */
  }
}

function read(): Theme {
  if (current) return current
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') {
      current = stored
      return current
    }
  } catch {
    /* noop */
  }
  current = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  return current
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function setTheme(theme: Theme): void {
  current = theme
  apply(theme)
  for (const listener of listeners) listener()
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, read)
  return {
    theme,
    setTheme,
    toggle: () => setTheme(read() === 'dark' ? 'light' : 'dark'),
  }
}
