import { expect, type APIRequestContext, type Page } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
export const samples = path.join(root, 'samples')
export const samplePng = path.join(samples, 'page-1.png')
export const samplePng2 = path.join(samples, 'page-2.png')
export const samplePdf = path.join(samples, 'Unlimited-OCR-paper.pdf')
export const tinyPng = path.join(samples, 'baidu.png')

export function pngBuffer(): Buffer {
  return fs.readFileSync(tinyPng)
}

export async function clearHistory(request: APIRequestContext): Promise<void> {
  const response = await request.post('/api/system/clear-history')
  expect(response.ok()).toBeTruthy()
}

export async function seedJob(
  request: APIRequestContext,
  name = 'seeded.png',
): Promise<{ id: string; uploadId: string }> {
  const upload = await request.post('/api/uploads', {
    multipart: {
      files: { name, mimeType: 'image/png', buffer: pngBuffer() },
    },
  })
  expect(upload.ok()).toBeTruthy()
  const uploaded = await upload.json()
  expect(uploaded.errors).toEqual([])
  const uploadId = uploaded.uploads[0].id as string

  const created = await request.post('/api/jobs', {
    data: {
      upload_ids: [uploadId],
      options: {
        prompt: 'document parsing.',
        dpi: 120,
        page_selection: { [uploadId]: 'all' },
      },
    },
  })
  expect(created.status()).toBe(201)
  const job = await created.json()

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const poll = await request.get(`/api/jobs/${job.id}`)
    const current = await poll.json()
    if (['completed', 'failed', 'partial', 'canceled'].includes(current.status)) {
      expect(current.status).toBe('completed')
      return { id: current.id as string, uploadId }
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`Seeded job ${job.id} did not complete`)
}

export async function openWorkspace(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await expect(page.getByRole('heading', { name: /every page/i })).toBeVisible()
}

export async function uploadFiles(page: Page, files: string[]): Promise<void> {
  await page.locator('input[type=file]').first().setInputFiles(files)
}

export async function startReading(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Start reading' }).click()
  await expect(page).toHaveURL(/#\/jobs\/job_/)
}

export async function waitForJob(page: Page, status: RegExp = /completed/i): Promise<void> {
  await expect(page.getByText(status).first()).toBeVisible({ timeout: 45_000 })
}
