import { ServiceError } from './company-service.mjs'

export function prepareResponse(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.setHeader('Cache-Control', 'no-store')
}

export function allowMethod(req, res, method) {
  if (req.method === method) return true
  res.setHeader('Allow', method)
  res.status(405).json({ error: { message: '请求方法不正确。', code: 'METHOD_NOT_ALLOWED' } })
  return false
}

export function sendServiceError(res, error) {
  const status = error instanceof ServiceError ? error.status : 500
  if (status >= 500) console.error('[Atlas France Serverless]', error)
  res.status(status).json({
    error: {
      message: error instanceof ServiceError ? error.message : '服务暂时无法完成查询，请稍后重试。',
      code: error instanceof ServiceError ? error.code : 'INTERNAL_ERROR',
    },
  })
}

export function jsonBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      throw new ServiceError('请求内容不是有效的 JSON。', 400, 'INVALID_JSON')
    }
  }
  return req.body
}
