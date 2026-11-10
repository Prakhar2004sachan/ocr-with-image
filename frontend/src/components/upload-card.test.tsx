import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Upload } from '@/lib/types'
import { UploadCard } from './upload-card'

const upload: Upload = {
  id: 'up_1',
  original_name: 'report.pdf',
  mime: 'application/pdf',
  size: 1024 * 1024,
  kind: 'pdf',
  page_count: 3,
  created_at: '2024-01-01T00:00:00Z',
  pages: [1, 2, 3].map((page) => ({
    id: `pg_${page}`,
    page_number: page,
    thumb_url: `/files/uploads/up_1/thumb-${page}.jpg`,
    image_url: null,
    width: 100,
    height: 140,
  })),
}

describe('UploadCard', () => {
  it('renders file metadata and every page thumbnail', () => {
    render(
      <UploadCard upload={upload} selected={[1, 3]} onChange={() => undefined} onRemove={() => undefined} />,
    )
    expect(screen.getByText('report.pdf')).toBeVisible()
    expect(screen.getByText('1.0 MB')).toBeVisible()
    expect(screen.getByText('2 of 3 pages')).toBeVisible()
    expect(screen.getByLabelText('Page 1 selected')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 2')).toBeInTheDocument()
    expect(screen.getByLabelText('Page 3 selected')).toBeInTheDocument()
  })

  it('toggles pages, selects all and clears', async () => {
    const onChange = vi.fn()
    const { rerender } = render(
      <UploadCard upload={upload} selected={[1]} onChange={onChange} onRemove={() => undefined} />,
    )
    await userEvent.click(screen.getByLabelText('Page 2'))
    expect(onChange).toHaveBeenCalledWith([1, 2])

    await userEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(onChange).toHaveBeenCalledWith([1, 2, 3])

    rerender(
      <UploadCard upload={upload} selected={[1, 2, 3]} onChange={onChange} onRemove={() => undefined} />,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('calls onRemove from the remove button', async () => {
    const onRemove = vi.fn()
    render(
      <UploadCard upload={upload} selected={[]} onChange={() => undefined} onRemove={onRemove} />,
    )
    await userEvent.click(screen.getByLabelText('Remove report.pdf'))
    expect(onRemove).toHaveBeenCalledTimes(1)
  })
})
