import { enrichCompany, searchCompanies, ServiceError, validateSearchInput } from '../../server/company-service.mjs'
import { allowMethod, jsonBody, prepareResponse, sendServiceError } from '../../server/serverless-utils.mjs'

export const config = { maxDuration: 60 }

export default async function handler(req, res) {
  prepareResponse(res)
  if (!allowMethod(req, res, 'POST')) return
  try {
    const body = jsonBody(req)
    const name = String(body.name || '').trim()
    const postcode = String(body.postcode || '').trim()
    const siren = String(body.siren || '')
    validateSearchInput(name, postcode)
    if (!/^\d{9}$/.test(siren)) throw new ServiceError('SIREN 编号格式不正确。', 400, 'INVALID_SIREN')
    const registry = await searchCompanies(name, postcode)
    const company = registry.candidates.find((item) => item.siren === siren)
    if (!company) throw new ServiceError('公司登记信息已变化，请重新查询。', 409, 'COMPANY_CHANGED')
    res.status(200).json(await enrichCompany(company))
  } catch (error) {
    sendServiceError(res, error)
  }
}
