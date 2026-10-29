import { defineConfig } from '@playwright/test'
import { existsSync } from 'node:fs'

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:7100',
    viewport: { width: 1440, height: 1000 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: existsSync(edgePath) ? { executablePath: edgePath } : {},
  },
  webServer: {
    command: 'node server.mjs --port 7100',
    url: 'http://127.0.0.1:7100/api/health',
    reuseExistingServer: false,
    timeout: 30_000,
  },
})
