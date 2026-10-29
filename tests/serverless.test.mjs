import test from 'node:test'
import assert from 'node:assert/strict'
import healthHandler from '../api/health.mjs'
import searchHandler from '../api/companies/search.mjs'
import enrichHandler from '../api/companies/enrich.mjs'

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.body = payload
      return this
    },
  }
}

test('Vercel health handler returns service status and rejects other methods', () => {
  const ok = mockResponse()
  healthHandler({ method: 'GET' }, ok)
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.body.status, 'ok')
  assert.equal(ok.body.platform, 'vercel')

  const rejected = mockResponse()
  healthHandler({ method: 'POST' }, rejected)
  assert.equal(rejected.statusCode, 405)
  assert.equal(rejected.headers.Allow, 'GET')
})

test('Vercel search handler validates input before calling external services', async () => {
  const invalidName = mockResponse()
  await searchHandler({ method: 'GET', query: { name: 'A', postcode: '75015' } }, invalidName)
  assert.equal(invalidName.statusCode, 400)
  assert.equal(invalidName.body.error.code, 'INVALID_NAME')

  const invalidPostcode = mockResponse()
  await searchHandler({ method: 'GET', query: { name: 'La Poste', postcode: 'Paris' } }, invalidPostcode)
  assert.equal(invalidPostcode.statusCode, 400)
  assert.equal(invalidPostcode.body.error.code, 'INVALID_POSTCODE')
})

test('Vercel enrich handler rejects malformed JSON and SIREN numbers', async () => {
  const invalidJson = mockResponse()
  await enrichHandler({ method: 'POST', body: '{broken' }, invalidJson)
  assert.equal(invalidJson.statusCode, 400)
  assert.equal(invalidJson.body.error.code, 'INVALID_JSON')

  const invalidSiren = mockResponse()
  await enrichHandler({ method: 'POST', body: { name: 'La Poste', postcode: '75015', siren: '123' } }, invalidSiren)
  assert.equal(invalidSiren.statusCode, 400)
  assert.equal(invalidSiren.body.error.code, 'INVALID_SIREN')
})
