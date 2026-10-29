import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const companies = [
  {
    siren: '123456789', siret: '12345678900021', name: 'ATELIER LUMIÈRE',
    address: '12 RUE DE LA FOLIE MÉRICOURT 75011 PARIS', postcode: '75011', city: 'PARIS',
    active: true, matchScore: 96, matchLabel: '名称高度匹配',
    sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/123456789',
  },
  {
    siren: '987654321', siret: '98765432100011', name: 'ATELIER LUMIÈRE PARIS',
    address: '8 RUE SAINT-MAUR 75011 PARIS', postcode: '75011', city: 'PARIS',
    active: true, matchScore: 82, matchLabel: '名称高度匹配',
    sourceUrl: 'https://annuaire-entreprises.data.gouv.fr/entreprise/987654321',
  },
]

const enrichedResult = {
  company: companies[0],
  enrichment: {
    website: { value: 'atelierlumiere.fr', url: 'https://www.atelierlumiere.fr/', sourceUrl: 'https://www.atelierlumiere.fr/', sourceLabel: '公司官网' },
    websiteConfidence: 'verified',
    emails: [{ value: 'bonjour@atelierlumiere.fr', url: 'mailto:bonjour@atelierlumiere.fr', sourceUrl: 'https://www.atelierlumiere.fr/contact', sourceLabel: '公司官网' }],
    contactPage: { value: 'www.atelierlumiere.fr', url: 'https://www.atelierlumiere.fr/contact', sourceUrl: 'https://www.atelierlumiere.fr/', sourceLabel: '公司官网' },
    socials: [
      { platform: 'facebook', url: 'https://facebook.com/atelierlumiere', handle: '@atelierlumiere', confidence: 'verified', sourceUrl: 'https://www.atelierlumiere.fr/' },
      { platform: 'instagram', url: 'https://instagram.com/atelierlumiere', handle: '@atelierlumiere', confidence: 'verified', sourceUrl: 'https://www.atelierlumiere.fr/' },
      { platform: 'linkedin', url: 'https://linkedin.com/company/atelierlumiere', handle: '@atelierlumiere', confidence: 'candidate', sourceUrl: 'https://linkedin.com/company/atelierlumiere' },
    ],
    checkedAt: '2026-10-29T15:00:00.000Z',
    pagesChecked: ['https://www.atelierlumiere.fr/', 'https://www.atelierlumiere.fr/contact'],
    warnings: [],
  },
}

async function mockSearch(page, payload) {
  await page.route('**/api/companies/search?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) }))
}

test('validates required company name and five-digit postcode', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: /找到公司/ })).toBeVisible()
  await page.getByRole('button', { name: '开始查询' }).click()
  await expect(page.getByText('请输入至少 2 个字符的公司名称')).toBeVisible()
  await expect(page.getByText('法国邮编应为 5 位数字')).toBeVisible()
  await page.getByLabel(/公司名称/).fill('AB')
  await page.getByLabel(/法国邮编/).fill('75')
  await expect(page.getByLabel(/法国邮编/)).toHaveValue('75')
  await page.getByRole('button', { name: '开始查询' }).click()
  await expect(page.getByText('法国邮编应为 5 位数字')).toBeVisible()
})

test('requires disambiguation, renders sourced results and exports matching CSV', async ({ page }) => {
  await mockSearch(page, { candidates: companies, autoSelect: null, total: 2, searchedAt: '2026-10-29T14:59:00.000Z' })
  await page.route('**/api/companies/enrich', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(enrichedResult) }))
  await page.goto('/')
  await page.getByLabel(/公司名称/).fill('Atelier Lumière')
  await page.getByLabel(/法国邮编/).fill('75011')
  await page.getByRole('button', { name: '开始查询' }).click()
  await expect(page.getByRole('heading', { name: '确认你要找的公司' })).toBeVisible()
  await expect(page.locator('.candidate-list button')).toHaveCount(2)
  await page.locator('.candidate-list button').first().click()
  await expect(page.getByRole('heading', { name: 'ATELIER LUMIÈRE', exact: true })).toBeVisible()
  await expect(page.getByText('12 RUE DE LA FOLIE MÉRICOURT 75011 PARIS')).toBeVisible()
  await expect(page.getByRole('link', { name: 'bonjour@atelierlumiere.fr' })).toHaveAttribute('href', 'mailto:bonjour@atelierlumiere.fr')
  await expect(page.locator('.social-row').nth(0).getByRole('link')).toHaveAttribute('href', 'https://facebook.com/atelierlumiere')
  await expect(page.locator('.social-row').nth(0).getByText('官网验证')).toBeVisible()
  await expect(page.locator('.social-row').nth(2).getByText('待确认')).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出 CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('atelier-lumi-re-123456789.csv')
  const content = await readFile(await download.path(), 'utf8')
  expect(content).toContain('bonjour@atelierlumiere.fr')
  expect(content).toContain('https://facebook.com/atelierlumiere')
  expect(content).toContain('123456789')
})

test('shows a truthful no-result state instead of fabricated contact data', async ({ page }) => {
  await mockSearch(page, { candidates: [], autoSelect: null, total: 0, searchedAt: '2026-10-29T14:59:00.000Z' })
  await page.goto('/')
  await page.getByLabel(/公司名称/).fill('Société Inexistante')
  await page.getByLabel(/法国邮编/).fill('75001')
  await page.getByRole('button', { name: '开始查询' }).click()
  await expect(page.getByRole('heading', { name: '这次查询还没有完成' })).toBeVisible()
  await expect(page.getByText(/没有找到名称与邮编同时匹配的公司/)).toBeVisible()
  await expect(page.getByRole('button', { name: '重新查询' })).toBeVisible()
})

test('keeps the search workspace usable on a narrow mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByLabel(/公司名称/)).toBeVisible()
  await expect(page.getByRole('button', { name: '开始查询' })).toBeVisible()
  const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client)
  await page.getByLabel(/公司名称/).fill('La Poste')
  await page.getByLabel(/法国邮编/).fill('75015')
  await expect(page.getByLabel(/法国邮编/)).toHaveValue('75015')
})
