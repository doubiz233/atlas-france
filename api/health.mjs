import { allowMethod, prepareResponse } from '../server/serverless-utils.mjs'

export default function handler(req, res) {
  prepareResponse(res)
  if (!allowMethod(req, res, 'GET')) return
  res.status(200).json({ status: 'ok', service: 'Atlas France', platform: 'vercel' })
}
