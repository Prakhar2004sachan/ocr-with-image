const { chromium } = require('../frontend/node_modules/@playwright/test');
const fs = require('fs');
const path = require('path');

async function main() {
  const outDir = path.join(__dirname, '..', 'docs', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true,
  });

  const context = await browser.newContext({
    viewport: { width: 1440, height: 920 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  const page = await context.newPage();

  console.log('Navigating to workspace...');
  await page.goto('http://localhost:5173/#/workspace', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '01-workspace.png') });
  console.log('Captured 01-workspace.png');

  console.log('Navigating to job viewer...');
  await page.goto('http://localhost:5173/#/jobs/job_fd7218caddcf9c5d', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(outDir, '02-job-view.png') });
  console.log('Captured 02-job-view.png');

  console.log('Navigating to history...');
  await page.goto('http://localhost:5173/#/history', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '03-history.png') });
  console.log('Captured 03-history.png');

  console.log('Navigating to settings...');
  await page.goto('http://localhost:5173/#/settings', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, '04-settings.png') });
  console.log('Captured 04-settings.png');

  await browser.close();
  console.log('All screenshots captured successfully!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
