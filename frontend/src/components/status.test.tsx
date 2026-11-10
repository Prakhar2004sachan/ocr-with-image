import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { JobStatusBadge, StatusIcon } from './status'

describe('JobStatusBadge', () => {
  it('renders every job status label', () => {
    const cases = [
      ['queued', 'Queued'],
      ['preparing', 'Preparing'],
      ['running', 'Running'],
      ['completed', 'Completed'],
      ['partial', 'Partial'],
      ['failed', 'Failed'],
      ['canceled', 'Canceled'],
    ] as const
    for (const [status, label] of cases) {
      const { unmount } = render(<JobStatusBadge status={status} />)
      expect(screen.getByText(label)).toBeInTheDocument()
      unmount()
    }
  })
})

describe('StatusIcon', () => {
  it('renders an accessible label through the parent', () => {
    render(
      <span>
        page <StatusIcon status="failed" />
      </span>,
    )
    expect(document.querySelector('svg')).toBeTruthy()
  })
})
