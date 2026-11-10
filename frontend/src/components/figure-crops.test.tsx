import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { JobPage } from '@/lib/types'
import { PageFigures } from './figure-crops'

function page(blocks: JobPage['blocks'], overrides: Partial<JobPage> = {}): JobPage {
  return {
    position: 0,
    upload_id: 'up_1',
    upload_name: 'report.pdf',
    page_number: 1,
    status: 'completed',
    image_url: '/files/uploads/up_1/page-1@200dpi.png',
    thumb_url: '/files/uploads/up_1/thumb-1.jpg',
    width: 1000,
    height: 1400,
    output_clean: 'Body',
    output_raw: 'Body',
    blocks,
    error: null,
    warning: null,
    prompt_tokens: null,
    completion_tokens: null,
    duration_ms: null,
    finish_reason: null,
    ...overrides,
  }
}

describe('PageFigures', () => {
  it('renders a cropped image for normalized figure blocks', () => {
    render(
      <PageFigures
        page={page([
          { label: 'text', box: [10, 10, 100, 100], text: 'Body' },
          { label: 'image', box: [120, 640, 880, 820], text: '' },
        ])}
      />,
    )
    expect(screen.getByTestId('page-figures')).toBeVisible()
    const image = screen.getByRole('img', { name: 'image on page 1' })
    expect(image).toBeVisible()
    expect(image).toHaveStyle({ width: '131.57894736842104%' })
  })

  it('handles pixel-space figure boxes', () => {
    render(
      <PageFigures
        page={page([{ label: 'figure', box: [100, 100, 500, 600], text: '' }], {
          width: 4000,
          height: 5000,
        })}
      />,
    )
    expect(screen.getByRole('img', { name: 'figure on page 1' })).toBeVisible()
  })

  it('renders nothing without figures, a page render, or valid boxes', () => {
    const { container, rerender } = render(<PageFigures page={page([])} />)
    expect(container).toBeEmptyDOMElement()

    rerender(
      <PageFigures page={page([{ label: 'image', box: [10, 10, 10, 20], text: '' }])} />,
    )
    expect(container).toBeEmptyDOMElement()

    rerender(
      <PageFigures
        page={page([{ label: 'image', box: [10, 10, 40, 40], text: '' }], { image_url: null })}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
