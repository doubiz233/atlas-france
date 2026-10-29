import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { enrichCompany, searchCompanies, ServiceError } from './server/company-service.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const isProduction = process.env.NODE_ENV === 'production' || process.argv.includes('--production')
const app = express()
const rateBuckets = new Map()

app.disable('x-powered-by')
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  next()
})
app.use(express.json({ limit: '12kb' }))

function rateLimit(req, res, next) {
  const key = req.ip || req.socket.remoteAddress || 'local'
  const now = Date.now()
  const bucket = rateBuckets.get(key)
  if (!bucket || now - bucket.started > 5 * 60_000) {
    rateBuckets.set(key, { started: now, count: 1 })
    return next()
  }
  bucket.count += 1
  if (bucket.count > 60) return res.status(429).json({ error: { message: '查询次数较频繁，请 5 分钟后再试。', code: 'RATE_LIMITED' } })
  next()
}

function validateSearch(name, postcode) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) throw new ServiceError('公司名称应为 2—80 个字符。', 400, 'INVALID_NAME')
  if (typeof postcode !== 'string' || !/^\d{5}$/.test(postcode)) throw new ServiceError('法国邮编应为 5 位数字。', 400, 'INVALID_POSTCODE')
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'Atlas France' })
})

app.get('/api/companies/search', rateLimit, async (req, res, next) => {
  try {
    const name = String(req.query.name || '').trim()
    const postcode = String(req.query.postcode || '').trim()
    validateSearch(name, postcode)
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.json(await searchCompanies(name, postcode))
  } catch (error) {
    next(error)
  }
})

app.post('/api/companies/enrich', rateLimit, async (req, res, next) => {
  try {
    const name = String(req.body?.name || '').trim()
    const postcode = String(req.body?.postcode || '').trim()
    const siren = String(req.body?.siren || '')
    validateSearch(name, postcode)
    if (!/^\d{9}$/.test(siren)) throw new ServiceError('SIREN 编号格式不正确。', 400, 'INVALID_SIREN')
    const registry = await searchCompanies(name, postcode)
    const company = registry.candidates.find((item) => item.siren === siren)
    if (!company) throw new ServiceError('公司登记信息已变化，请重新查询。', 409, 'COMPANY_CHANGED')
    res.json(await enrichCompany(company))
  } catch (error) {
    next(error)
  }
})

app.use('/api', (_req, res) => {
  res.status(404).json({ error: { message: '查询接口不存在。', code: 'NOT_FOUND' } })
})

app.use((error, _req, res, _next) => {
  const status = error instanceof ServiceError ? error.status : 500
  if (status >= 500) console.error('[Atlas France]', error)
  res.status(status).json({
    error: {
      message: error instanceof ServiceError ? error.message : '服务暂时无法完成查询，请稍后重试。',
      code: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR',
    },
  })
})

if (isProduction) {
  app.use(express.static(path.join(root, 'dist')))
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next()
    res.sendFile(path.join(root, 'dist', 'index.html'))
  })
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({
    root,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

function cliOption(flag) {
  const index = process.argv.indexOf(flag)
  return index >= 0 ? process.argv[index + 1] : undefined
}

const port = Number(cliOption('--port') || process.env.PORT || 7100)
const host = cliOption('--host') || '0.0.0.0'
app.listen(port, host, () => {
  console.log(`Atlas France is ready at http://localhost:${port}`)
})
