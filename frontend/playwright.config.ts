import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

const root = path.dirname(fileURLToPath(import.meta.url))
const backend = path.resolve(root, '..', 'backend')
const port = Number(process.env.E2E_PORT ?? 8010)
const dataDir = path.resolve(root, '..', process.env.E2E_DATA_DIR ?? '.e2e-data')
const isWindows = process.platform === 'win32'
const python =
  process.env.E2E_PYTHON ??
  path.join(backend, '.venv', isWindows ? 'Scripts' : 'bin', isWindows ? 'python.exe' : 'python')

// Prefer an installed Chrome/Edge when Playwright's bundled Chromium has not
// been downloaded (`pnpm exec playwright install chromium`), so the suite also
// runs on locked-down machines that only have a system browser.
const systemChrome = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/microsoft-edge',
].find((candidate) => fs.existsSync(candidate))
const channel = process.env.E2E_CHANNEL ?? (systemChrome ? 'chrome' : undefined)

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['clipboard-read', 'clipboard-write'],
    channel,
  },
  // The built UI is served by FastAPI itself, which is the production path.
  // `pnpm run test:e2e` builds it first; this also avoids two dev servers and
  // any proxy differences between the browser and the E2E API client.
  webServer: [
    {
      command: `"${python}" -m uvicorn app.main:app --host 127.0.0.1 --port ${port}`,
      cwd: backend,
      url: `http://127.0.0.1:${port}/api/health`,
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      env: {
        ...process.env,
        OCR_FAKE_ENGINE: '1',
        OCR_FAKE_ENGINE_DELAY: '0.05',
        OCR_DATA_DIR: dataDir,
        OCR_LLAMA_SERVER_BIN: path.join(dataDir, 'missing-llama-server'),
        OCR_MODEL_PATH: path.join(dataDir, 'missing-model.gguf'),
        OCR_MMPROJ_PATH: path.join(dataDir, 'missing-mmproj.gguf'),
        OCR_UOCR2_DIR: path.join(dataDir, 'missing-uocr2'),
        OCR_LOG_LEVEL: 'WARNING',
      },
    },
  ],
})
