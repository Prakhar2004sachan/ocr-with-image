import { expect, test } from '@playwright/test'
import fs from 'node:fs'
import {
  clearHistory,
  openWorkspace,
  samplePdf,
  samplePng,
  samplePng2,
  seedJob,
  startReading,
  tinyPng,
  uploadFiles,
  waitForJob,
} from './helpers'

test.beforeEach(async ({ page, request }) => {
  await clearHistory(request)
  await openWorkspace(page)
})

test('workspace uploads a page, reads it, and exposes result, source, raw, copy and export', async ({
  page,
}) => {
  await expect(page.getByText(/Local · .* · Private/)).toBeVisible()
  await expect(page.getByRole('heading', { name: /every page/i })).toBeVisible()
  await expect(page.getByRole('navigation').getByRole('button', { name: 'History' })).toBeVisible()

  await uploadFiles(page, [samplePng])
  await expect(page.getByText('page-1.png')).toBeVisible()
  await expect(page.getByText('1 page').first()).toBeVisible()

  // Page selection drives the page total and the Start button.
  await page.getByLabel('Page 1 selected').click()
  await expect(page.getByRole('button', { name: 'Start reading' })).toBeDisabled()
  await page.getByRole('button', { name: 'Page 1', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start reading' })).toBeEnabled()

  // A blank custom prompt is rejected before a job is created.
  await page.getByRole('button', { name: 'Custom' }).click()
  await page.getByRole('button', { name: 'Start reading' }).click()
  await expect(page.getByText('The custom prompt is empty.')).toBeVisible()
  await expect(page).not.toHaveURL(/#\/jobs\//)

  // Advanced options toggle and the layout prompt both work.
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.getByRole('switch', { name: 'Retry truncated pages' }).click()
  await page.getByRole('switch', { name: 'Strip repeated margins' }).click()
  await page.getByLabel('Temperature').fill('0.2')
  await page.getByLabel('Seed').fill('42')
  await expect(page.getByLabel('Temperature')).toHaveValue('0.2')
  await page.getByRole('button', { name: 'Layout' }).click()
  await page.getByRole('button', { name: '2k' }).click()
  await expect(page.getByLabel('Token budget')).toHaveValue('2048')

  // Reset restores the defaults from Settings.
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByLabel('Token budget')).toHaveValue('8192')
  await page.getByRole('button', { name: '2k' }).click()

  await startReading(page)
  await waitForJob(page)
  await expect(page.getByText('Fake OCR page 1')).toBeVisible()
  await expect(page.getByText('Fake OCR page 1')).toHaveCount(1)
  // Figure crops found by the OCR pass are visible next to the text.
  await expect(page.getByTestId('page-figures')).toBeVisible()
  await expect(page.getByRole('img', { name: 'image on page 1' })).toBeVisible()

  // Source tab: layout boxes and the block inspector.
  await page.getByRole('tab', { name: 'Source' }).click()
  await expect(page.getByText('6 blocks')).toBeVisible()
  await expect(page.getByRole('switch', { name: 'Show layout boxes' })).toBeChecked()
  await expect(page.getByText('page_number').first()).toBeVisible()

  // Raw tab: the untouched model stream.
  await page.getByRole('tab', { name: 'Raw' }).click()
  await expect(page.getByText('Model output · raw')).toBeVisible()
  await expect(page.locator('pre').filter({ hasText: 'Fake OCR page 1' })).toBeVisible()
  await page.getByRole('button', { name: 'Copy', exact: true }).click()
  await expect(page.getByText('Raw output copied')).toBeVisible()

  // Copy uses the clipboard fallback and reports success.
  await page.getByRole('tab', { name: 'Result' }).click()
  await page.getByRole('button', { name: 'Copy page text' }).click()
  await expect(page.getByText('Page text copied')).toBeVisible()
  const clipboard = await page.evaluate(() => navigator.clipboard.readText())
  expect(clipboard).toContain('Fake OCR page 1')

  // Whole-job Markdown export and single-page export both download files.
  await page.getByRole('button', { name: /Export/ }).click()
  await page.getByRole('menuitem', { name: 'Copy all Markdown' }).click()
  await expect(page.getByText('Job Markdown copied')).toBeVisible()
  await page.getByRole('button', { name: /Export/ }).click()
  const [jobDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: /Markdown \(\.md/ }).click(),
  ])
  expect(jobDownload.suggestedFilename()).toMatch(/\.md$/)
  const downloadedPath = await jobDownload.path()
  expect(downloadedPath).toBeTruthy()
  const markdown = fs.readFileSync(downloadedPath!, 'utf8')
  expect(markdown).toContain('Figures: 1 embedded as inline PNG')
  expect(markdown).toContain('![image](data:image/png;base64,')
  expect(markdown).toContain('Figure 1 from page-1')

  await page.getByRole('button', { name: 'Download this page' }).click()
  const [pageDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('menuitem', { name: 'Page Markdown' }).click(),
  ])
  expect(pageDownload.suggestedFilename()).toMatch(/\.md$/)
  const pageMarkdown = fs.readFileSync((await pageDownload.path())!, 'utf8')
  expect(pageMarkdown).toContain('data:image/png;base64,')
})

test('upload zone rejects unsupported files and accepts pasted images', async ({ page }) => {
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('not a document'),
  })
  await expect(page.getByText(/not a supported document or image/)).toBeVisible()

  const base64 = fs.readFileSync(tinyPng).toString('base64')
  await page.evaluate((payload) => {
    const bytes = Uint8Array.from(atob(payload), (char) => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'pasted.png', { type: 'image/png' }))
    window.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }),
    )
  }, base64)
  await expect(page.getByText('pasted.png')).toBeVisible()
})

test('PDF page selection, keyboard navigation and arrow keys work', async ({ page }) => {
  await uploadFiles(page, [samplePdf])
  await expect(page.getByText('14 pages').first()).toBeVisible()

  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  await page.getByRole('button', { name: 'Page 1', exact: true }).click()
  await page.getByRole('button', { name: 'Page 2', exact: true }).click()
  await expect(page.getByText('2 pages', { exact: true })).toBeVisible()

  await startReading(page)
  await waitForJob(page)
  // The live runner pins the last running page; keyboard navigation starts there.
  await expect(page.getByRole('heading', { name: /Page [12]/ })).toBeVisible()

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('heading', { name: 'Page 1' })).toBeVisible()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('heading', { name: 'Page 2' })).toBeVisible()

  // Filmstrip selection pins a page.
  await page.locator('button[title*="page 2"]').click()
  await expect(page.getByRole('heading', { name: 'Page 2' })).toBeVisible()
})

test('batch mode groups two pages into one request', async ({ page }) => {
  await uploadFiles(page, [samplePng, samplePng2])
  await expect(page.getByText('page-2.png')).toBeVisible()
  await page.getByRole('button', { name: /Advanced/ }).click()
  await page.getByRole('switch', { name: 'Use batch mode' }).click()
  await startReading(page)
  await waitForJob(page)
  await expect(page.getByText('Batch', { exact: true }).first()).toBeVisible()
  // The live view pins the last running page; inspect both batch results.
  await page.locator('button[title*="page-1.png"]').click()
  await expect(page.getByText('Fake OCR page 1')).toBeVisible()
  await page.locator('button[title*="page-2.png"]').click()
  await expect(page.getByText('Fake OCR page 2')).toBeVisible()
})

test('a running job shows live streaming and can be canceled', async ({ page }) => {
  await uploadFiles(page, [samplePdf])
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  for (const pageNumber of [1, 2, 3, 4]) {
    await page.getByRole('button', { name: `Page ${pageNumber}`, exact: true }).click()
  }
  await startReading(page)

  await expect(page.getByText('Live').first()).toBeVisible()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await page.getByRole('button', { name: 'Cancel job' }).click()
  await expect(page.getByText(/canceled/i).first()).toBeVisible({ timeout: 45_000 })
  await expect(page.getByText('Canceled', { exact: true }).first()).toBeVisible()
})

test('history search, filter, rerun and delete work, including empty states', async ({
  page,
  request,
}) => {
  await seedJob(request, 'alpha.png')
  await seedJob(request, 'beta.png')
  await page.goto('/#/history')
  await expect(page.getByText('2 jobs in total')).toBeVisible()
  await expect(page.getByText('alpha')).toBeVisible()
  await expect(page.getByText('beta')).toBeVisible()

  await page.getByLabel('Search jobs').fill('alpha')
  await expect(page.getByText('1 job matched')).toBeVisible()
  await expect(page.getByText('beta')).toHaveCount(0)

  await page.getByLabel('Clear search').click()
  await page.getByLabel('Filter by status').click()
  await page.getByRole('option', { name: 'Completed' }).click()
  await expect(page.getByText('2 jobs matched')).toBeVisible()

  await page.getByText('alpha').click()
  await expect(page.getByRole('heading', { name: 'alpha' })).toBeVisible()
  await page.getByRole('button', { name: 'Rerun' }).click()
  await expect(page.getByText('Rerun queued')).toBeVisible()
  await page.waitForURL(/#\/jobs\/job_/)
  await waitForJob(page)

  await page.goto('/#/history')
  await expect(page.getByText('3 jobs in total')).toBeVisible()

  const betaRow = page.locator('div.group').filter({ hasText: 'beta' }).first()
  await betaRow.getByRole('button', { name: 'Job actions' }).click()
  await page.getByRole('menuitem', { name: /Delete/ }).click()
  await page.getByRole('button', { name: 'Delete job' }).click()
  await expect(page.getByText('2 jobs in total')).toBeVisible()

  await clearHistory(request)
  await page.reload()
  await expect(page.getByText('A quiet archive.')).toBeVisible()
  await page.getByLabel('Search jobs').fill('nothing')
  await expect(page.getByText('Nothing matches.')).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).first().click()
  await expect(page.getByText('A quiet archive.')).toBeVisible()
})

test('settings persist, reset, switch device, control the engine, and clear the archive', async ({
  page,
  request,
}) => {
  await page.goto('/#/settings')
  await expect(page.getByRole('heading', { name: 'Settings.' })).toBeVisible()

  await page.getByLabel('Default token budget').fill('4096')
  await page.getByLabel('Default resolution').focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('button', { name: 'Save changes' }).first().click()
  await expect(page.getByText('Settings saved')).toBeVisible()

  await page.getByRole('button', { name: 'Custom prompt' }).click()
  await page.getByLabel('Default prompt').fill('extract every table')
  await page.getByRole('button', { name: 'Save changes' }).first().click()
  await expect(page.getByText('Settings saved')).toBeVisible()
  await page.reload()
  await expect(page.getByLabel('Default prompt')).toHaveValue('extract every table')

  await page.getByRole('button', { name: 'Reset defaults' }).click()
  await expect(page.getByText('Defaults restored')).toBeVisible()

  await expect(page.getByText('This device')).toBeVisible()
  await page.getByRole('button', { name: 'CPU', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes' }).first().click()
  await expect(page.getByText('Settings saved')).toBeVisible()

  await expect(
    page.getByRole('button', { name: /Unlimited-OCR-2/ }),
  ).toBeDisabled()
  await expect(page.getByRole('button', { name: /Unlimited-OCR · Q8_0/ })).toBeDisabled()

  await page.getByRole('button', { name: 'Stop' }).click()
  await page.getByRole('button', { name: 'Stop engine' }).click()
  await expect(page.getByRole('main').getByText('Engine stopped')).toBeVisible()
  await page.getByRole('button', { name: 'Start engine' }).click()
  await expect(page.getByRole('main').getByText('Engine ready')).toBeVisible()
  await page.getByRole('button', { name: 'Restart' }).click()
  await expect(page.getByText('Engine restarted')).toBeVisible()

  await seedJob(request, 'clear-me.png')
  await page.reload()
  await page.getByRole('button', { name: 'Clear history' }).click()
  await page.getByRole('button', { name: 'Clear everything' }).click()
  await expect(page.getByText('History cleared.')).toBeVisible()

  await page.getByRole('button', { name: 'System & engine details' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('This device', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Platform')).toBeVisible()
  await expect(dialog.getByText('Accelerator')).toBeVisible()
  await dialog.getByRole('tab', { name: 'Logs' }).click()
  await dialog.getByRole('button', { name: /Refresh/ }).click()
  await expect(dialog.locator('pre')).toBeVisible()
  await dialog.getByRole('button', { name: 'Copy report' }).click()
  await expect(page.getByText('Diagnostics copied')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('theme toggles and persists, and mobile navigation works', async ({ page }) => {
  const toggle = page.getByRole('button', { name: /Switch to (dark|light) theme/ })
  const startDark = await page.evaluate(() => document.documentElement.classList.contains('dark'))
  await toggle.click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(!startDark)
  await page.reload()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
    .toBe(!startDark)

  await page.setViewportSize({ width: 390, height: 800 })
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'History' }).click()
  await expect(page).toHaveURL(/#\/history/)
  await expect(page.getByRole('heading', { name: 'The archive.' })).toBeVisible()

  await page.getByRole('button', { name: 'Engine status' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
})

test('an unreachable backend shows the offline screen and retry recovers', async ({ page }) => {
  await page.route('**/api/health', (route) => route.abort())
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'The backend is off.' })).toBeVisible()
  await expect(page.getByText(/scripts[\\/]start/).first()).toBeVisible()
  await page.unroute('**/api/health')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: /every page/i })).toBeVisible()
})

test('a deleted or unknown job shows a recoverable not-found screen', async ({ page }) => {
  await page.goto('/#/jobs/job_missing')
  await expect(page.getByRole('heading', { name: 'This job has left the archive.' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to history' }).click()
  await expect(page.getByRole('heading', { name: 'The archive.' })).toBeVisible()
})
