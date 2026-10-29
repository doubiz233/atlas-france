export type SocialPlatform = 'facebook' | 'instagram' | 'linkedin'

export interface CompanyCandidate {
  siren: string
  siret: string
  name: string
  address: string
  postcode: string
  city: string
  active: boolean
  matchScore: number
  matchLabel: string
  sourceUrl: string
}

export interface SearchResponse {
  candidates: CompanyCandidate[]
  autoSelect: CompanyCandidate | null
  total: number
  searchedAt: string
}

export interface LinkInfo {
  value: string
  url: string
  sourceUrl: string
  sourceLabel: string
}

export interface SocialProfile {
  platform: SocialPlatform
  url: string
  handle: string
  confidence: 'verified' | 'candidate'
  sourceUrl: string
}

export interface Enrichment {
  website: LinkInfo | null
  websiteConfidence: 'verified' | 'candidate' | 'not_found'
  emails: LinkInfo[]
  contactPage: LinkInfo | null
  socials: SocialProfile[]
  checkedAt: string
  pagesChecked: string[]
  warnings: string[]
}

export interface CompanyResult {
  company: CompanyCandidate
  enrichment: Enrichment
}

export interface RecentQuery {
  name: string
  postcode: string
}
