import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ErrorNotice, WarningNotice } from './error-notice'

describe('ErrorNotice', () => {
  it('shows the title, message, hint and retry action', async () => {
    const onRetry = vi.fn()
    render(
      <ErrorNotice
        title="Engine failed"
        message="llama-server is missing"
        hint="Install it"
        code="engine_unavailable"
        onRetry={onRetry}
      />,
    )
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('Engine failed')).toBeVisible()
    expect(screen.getByText('llama-server is missing')).toBeVisible()
    expect(screen.getByText('Install it')).toBeVisible()
    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('can dismiss itself', async () => {
    const onDismiss = vi.fn()
    render(<ErrorNotice compact message="Nope" onDismiss={onDismiss} />)
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }))
    expect(onDismiss).toHaveBeenCalled()
  })
})

describe('WarningNotice', () => {
  it('renders children', () => {
    render(<WarningNotice>Output was truncated</WarningNotice>)
    expect(screen.getByText('Output was truncated')).toBeVisible()
  })
})
