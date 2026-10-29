import { chromium } from '@playwright/test'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'

const server = spawn(process.execPath, ['server.mjs', '--port', '7100'], { stdio: 'ignore' })
let browser
try {
  await new Promise((resolve) => setTimeout(resolve, 1800))
  browser = await chromium.launch({ executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' })
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await mkdir('artifacts', { recursive: true })
  await page.goto('http://127.0.0.1:7100', { waitUntil: 'networkidle' })
  await page.screenshot({ path: 'artifacts/atlas-home.png', fullPage: true })
  await page.getByLabel(/公司名称/).fill('La Poste')
  await page.getByLabel(/法国邮编/).fill('75015')
  await page.getByRole('button', { name: '开始查询' }).click()
  await page.getByRole('heading', { name: 'LA POSTE', exact: true }).waitFor({ timeout: 120_000 })
  await page.screenshot({ path: 'artifacts/atlas-result.png', fullPage: true })
  const audit = await page.evaluate(() => ({
    pageWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    facebook: document.querySelector('.social-row a')?.getAttribute('href'),
    emails: document.querySelectorAll('.email-row').length,
  }))
  console.log(JSON.stringify({ ...audit, runtimeErrors: errors }, null, 2))
  if (errors.length) process.exitCode = 1
} finally {
  await browser?.close()
  server.kill()
}
