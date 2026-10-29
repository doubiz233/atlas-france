import type { CompanyCandidate, CompanyResult, SearchResponse } from '@/types/company'

export class ApiError extends Error {
  status: number

  constructor(message: string, status = 500) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new ApiError(payload?.error?.message || '查询服务暂时不可用，请稍后重试。', response.status)
  }
  return payload as T
}

export async function searchCompanies(
  name: string,
  postcode: string,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ name, postcode })
  const response = await fetch(`/api/companies/search?${params}`, { signal })
  return parseResponse<SearchResponse>(response)
}

export async function enrichCompany(
  company: CompanyCandidate,
  signal?: AbortSignal,
): Promise<CompanyResult> {
  const response = await fetch('/api/companies/enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      siren: company.siren,
      name: company.name,
      postcode: company.postcode,
      city: company.city,
    }),
    signal,
  })
  return parseResponse<CompanyResult>(response)
}
