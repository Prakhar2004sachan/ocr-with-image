import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTheme } from './use-theme'

describe('useTheme', () => {
  it('defaults to the stored theme and applies the dark class', () => {
    localStorage.setItem('unlimited-ocr.theme', 'dark')
    const { result } = renderHook(() => useTheme())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(false)
    act(() => result.current.setTheme('dark'))
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })

  it('toggles and persists the choice', () => {
    const { result } = renderHook(() => useTheme())
    act(() => result.current.setTheme('light'))
    expect(result.current.theme).toBe('light')
    expect(localStorage.getItem('unlimited-ocr.theme')).toBe('light')
    act(() => result.current.toggle())
    expect(result.current.theme).toBe('dark')
    expect(document.documentElement.classList.contains('dark')).toBe(true)
  })
})
