import { searchCompanies, validateSearchInput } from '../../server/company-service.mjs'
import { allowMethod, prepareResponse, sendServiceError } from '../../server/serverless-utils.mjs'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  prepareResponse(res)
  if (!allowMethod(req, res, 'GET')) return
  try {
    const name = String(req.query.name || '').trim()
    const postcode = String(req.query.postcode || '').trim()
    validateSearchInput(name, postcode)
    const result = await searchCompanies(name, postcode)
    res.setHeader('Cache-Control', 'private, max-age=60')
    res.status(200).json(result)
  } catch (error) {
    sendServiceError(res, error)
  }
}
