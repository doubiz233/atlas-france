import * as cheerio from 'cheerio'
import dns from 'node:dns/promises'
import net from 'node:net'

const REGISTRY_API = 'https://recherche-entreprises.api.gouv.fr/search'
const USER_AGENT = 'AtlasFrance/1.0 (+public-company-contact-verifier)'
const SEARCH_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36'
const MAX_HTML_BYTES = 1_500_000
const searchCache = new Map()
const enrichmentCache = new Map()

const STOP_WORDS = new Set(['la', 'le', 'les', 'de', 'des', 'du', 'et', 'en', 'au', 'aux', 'the', 'and', 'france', 'sas', 'sasu', 'sarl', 'eurl', 'sa', 'ei', 'eirl', 'sci', 'scp', 'groupe', 'group'])
const DIRECTORY_DOMAINS = ['facebook.', 'instagram.', 'linkedin.', 'twitter.', 'x.com', 'youtube.', 'tiktok.', 'pagesjaunes.', 'societe.com', 'pappers.', 'verif.', 'annuaire-entreprises.', 'indeed.', 'glassdoor.', 'wikipedia.', 'google.', 'bing.', 'apple.', 'amazon.', 'gov.', 'gouv.', 'manageo.', 'europages.', 'kompass.', 'dnb.com']
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi

export class ServiceError extends Error {
  constructor(message, status = 500, code = 'SERVICE_ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

export function validateSearchInput(name, postcode) {
  if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) throw new ServiceError('公司名称应为 2—80 个字符。', 400, 'INVALID_NAME')
  if (typeof postcode !== 'string' || !/^\d{5}$/.test(postcode)) throw new ServiceError('法国邮编应为 5 位数字。', 400, 'INVALID_POSTCODE')
}

export function normalizeText(value = '') {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

export function nameTokens(value = '') {
  return [...new Set(normalizeText(value).split(' ').filter((token) => token.length > 1 && !STOP_WORDS.has(token)))]
}

function compactNameVariants(value) {
  const tokens = nameTokens(value)
  const full = normalizeText(value).split(' ').filter((token) => !['sas', 'sasu', 'sarl', 'eurl', 'sa', 'ei', 'eirl'].includes(token)).join('')
  return [...new Set([full, tokens.join(''), tokens.slice(0, 2).join('')].filter((item) => item.length >= 3))]
}

export function tokenCoverage(value, tokens) {
  if (!tokens.length) return 0
  const normalized = normalizeText(value)
  return tokens.filter((token) => normalized.includes(token)).length / tokens.length
}

export function companyMatchScore(query, candidateName) {
  const queryNormalized = normalizeText(query)
  const candidateNormalized = normalizeText(candidateName)
  if (queryNormalized === candidateNormalized) return 100
  const queryTokens = nameTokens(query)
  const coverage = tokenCoverage(candidateNormalized, queryTokens)
  const reverseCoverage = tokenCoverage(queryNormalized, nameTokens(candidateName))
  let score = Math.round(coverage * 72 + reverseCoverage * 18)
  if (candidateNormalized.startsWith(queryNormalized)) score += 8
  else if (candidateNormalized.includes(queryNormalized)) score += 5
  return Math.min(98, score)
}

function matchLabel(score) {
  if (score >= 95) return '名称精确匹配'
  if (score >= 80) return '名称高度匹配'
  if (score >= 60) return '名称部分匹配'
  return '请人工确认'
}

function mapCompany(raw, query, postcode) {
  const establishments = Array.isArray(raw.matching_etablissements) ? raw.matching_etablissements : []
  const matching = establishments.find((item) => item.code_postal === postcode && item.etat_administratif !== 'F')
    || establishments.find((item) => item.code_postal === postcode)
  const site = raw.siege?.code_postal === postcode ? raw.siege : matching || raw.siege || {}
  const name = raw.nom_complet || raw.nom_raison_sociale || raw.sigle || query
  const matchScore = companyMatchScore(query, name)
  return {
    siren: raw.siren,
    siret: site.siret || raw.siege?.siret || '',
    name,
    address: site.adresse || [site.complement_adresse, site.numero_voie, site.type_voie, site.libelle_voie, site.code_postal, site.libelle_commune].filter(Boolean).join(' '),
    postcode: site.code_postal || postcode,
    city: site.libelle_commune || '',
    active: (site.etat_administratif || raw.etat_administratif) !== 'F',
    matchScore,
    matchLabel: matchLabel(matchScore),
    sourceUrl: `https://annuaire-entreprises.data.gouv.fr/entreprise/${raw.siren}`,
  }
}

export async function searchCompanies(name, postcode) {
  const key = `${normalizeText(name)}:${postcode}`
  const cached = searchCache.get(key)
  if (cached && Date.now() - cached.time < 15 * 60_000) return cached.value

  const params = new URLSearchParams({ q: name, code_postal: postcode, per_page: '10' })
  let response
  try {
    response = await fetch(`${REGISTRY_API}?${params}`, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new ServiceError('法国企业登记服务暂时无法连接，请稍后重试。', 502, 'REGISTRY_UNAVAILABLE')
  }
  if (!response.ok) {
    throw new ServiceError('法国企业登记服务暂时繁忙，请稍后重试。', 502, 'REGISTRY_ERROR')
  }
  const payload = await response.json()
  const candidates = (payload.results || [])
    .filter((item) => item.siren)
    .map((item) => mapCompany(item, name, postcode))
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 6)
  const top = candidates[0]
  const second = candidates[1]
  const autoSelect = top && top.matchScore >= 80 && (!second || top.matchScore === 100 || top.matchScore - second.matchScore >= 12) ? top : null
  const value = { candidates, autoSelect, total: payload.total_results || candidates.length, searchedAt: new Date().toISOString() }
  searchCache.set(key, { time: Date.now(), value })
  return value
}

function isPrivateAddress(address) {
  if (address.includes(':')) {
    const ip = address.toLowerCase()
    return ip === '::1' || ip === '::' || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('::ffff:127.') || ip.startsWith('::ffff:10.') || ip.startsWith('::ffff:192.168.')
  }
  const parts = address.split('.').map(Number)
  if (parts.length !== 4) return true
  return parts[0] === 0 || parts[0] === 10 || parts[0] === 127 || parts[0] >= 224
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
}

async function assertPublicUrl(value) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsupported URL protocol')
  if (url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.local')) throw new Error('Private URL blocked')
  const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await dns.lookup(url.hostname, { all: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error('Private address blocked')
  return url
}

async function readLimited(response) {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let size = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_HTML_BYTES) {
      await reader.cancel()
      throw new Error('HTML response too large')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged)
}

export async function fetchHtml(value, timeout = 10_000) {
  let current = (await assertPublicUrl(value)).toString()
  for (let redirects = 0; redirects < 5; redirects += 1) {
    const response = await fetch(current, {
      headers: { 'User-Agent': SEARCH_UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.6' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeout),
    })
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location) throw new Error('Redirect without location')
      current = (await assertPublicUrl(new URL(location, current).toString())).toString()
      continue
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const contentType = response.headers.get('content-type') || ''
    if (contentType && !contentType.includes('text/html') && !contentType.includes('application/xhtml')) throw new Error('Not HTML')
    const html = await readLimited(response)
    return { url: current, html }
  }
  throw new Error('Too many redirects')
}

function unwrapSearchUrl(value) {
  try {
    const url = new URL(value)
    if (url.hostname.endsWith('bing.com') && url.pathname === '/ck/a') {
      const encoded = url.searchParams.get('u')
      if (encoded?.startsWith('a1')) {
        const base64 = encoded.slice(2).replace(/-/g, '+').replace(/_/g, '/')
        return Buffer.from(base64, 'base64').toString('utf-8')
      }
    }
    return value
  } catch {
    return value
  }
}

export async function bingSearch(query, limit = 6) {
  const url = `https://www.bing.com/search?${new URLSearchParams({ q: query, count: String(Math.max(limit, 5)), setlang: 'fr-FR', cc: 'fr', mkt: 'fr-FR' })}`
  const { html } = await fetchHtml(url, 12_000)
  const $ = cheerio.load(html)
  const results = []
  $('li.b_algo').each((_, element) => {
    if (results.length >= limit) return
    const anchor = $(element).find('h2 a').first()
    const href = unwrapSearchUrl(anchor.attr('href') || '')
    const title = anchor.text().replace(/\s+/g, ' ').trim()
    const snippet = $(element).find('.b_caption p').first().text().replace(/\s+/g, ' ').trim()
    try {
      const parsed = new URL(href)
      if (['http:', 'https:'].includes(parsed.protocol) && title) results.push({ title, url: parsed.toString(), snippet })
    } catch {
      // Ignore malformed search results.
    }
  })
  return results
}

function officialWebsiteScore(result, name, postcode, city) {
  const hostname = new URL(result.url).hostname.toLowerCase()
  if (DIRECTORY_DOMAINS.some((domain) => hostname.includes(domain))) return 0
  const tokens = nameTokens(name)
  const textCoverage = tokenCoverage(`${result.title} ${result.snippet}`, tokens)
  const hostCoverage = tokenCoverage(hostname.replace(/[.-]/g, ' '), tokens)
  let score = Math.round(textCoverage * 58 + hostCoverage * 32)
  const location = normalizeText(`${result.title} ${result.snippet}`)
  if (location.includes(normalizeText(postcode)) || (city && location.includes(normalizeText(city)))) score += 8
  if (/officiel|official|site internet/i.test(`${result.title} ${result.snippet}`)) score += 5
  return Math.min(100, score)
}

async function discoverWebsite(name, postcode, city, warnings) {
  const compactNames = compactNameVariants(name)
  const queries = [...new Set([...compactNames, ...compactNames.map((item) => `${item} ${postcode}`), `"${name}" France site officiel`])]
  for (const query of queries) {
    try {
      const results = await bingSearch(query, 8)
      const ranked = results.map((result) => ({ ...result, score: officialWebsiteScore(result, name, postcode, city) }))
        .filter((result) => result.score >= 48)
        .sort((a, b) => b.score - a.score)
      if (ranked[0]) return ranked[0]
    } catch {
      warnings.push('公开网页搜索暂时受限，官网与社媒可能无法完整显示。')
      return null
    }
  }
  return null
}

function decodeCloudflareEmail(encoded) {
  try {
    const key = Number.parseInt(encoded.slice(0, 2), 16)
    let email = ''
    for (let index = 2; index < encoded.length; index += 2) email += String.fromCharCode(Number.parseInt(encoded.slice(index, index + 2), 16) ^ key)
    return email
  } catch {
    return null
  }
}

export function validEmail(value) {
  const email = value.trim().replace(/^mailto:/i, '').split('?')[0]
  if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email)) return null
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(email)) return null
  if (/@(example|domain|email|sentry|wixpress)\./i.test(email) || /(yourmail|email@address|nom@)/i.test(email)) return null
  return email.toLowerCase()
}

function sameWebsite(hostname, rootHostname) {
  return hostname === rootHostname || hostname.endsWith(`.${rootHostname}`) || rootHostname.endsWith(`.${hostname}`)
}

function cleanUrl(value) {
  const url = new URL(value)
  ;['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((key) => url.searchParams.delete(key))
  url.hash = ''
  return url.toString()
}

export function extractPageData(html, pageUrl, rootUrl) {
  const $ = cheerio.load(html)
  $('script, style, noscript, svg, template').remove()
  const rootHostname = new URL(rootUrl).hostname
  const emails = new Set()
  $('a[href^="mailto:"]').each((_, element) => {
    const email = validEmail($(element).attr('href') || '')
    if (email) emails.add(email)
  })
  $('[data-cfemail]').each((_, element) => {
    const email = validEmail(decodeCloudflareEmail($(element).attr('data-cfemail') || '') || '')
    if (email) emails.add(email)
  })
  const text = $('body').text().replace(/\s+/g, ' ')
  for (const match of text.match(EMAIL_PATTERN) || []) {
    const email = validEmail(match)
    if (email) emails.add(email)
  }

  const contactLinks = []
  const crawlLinks = new Map()
  const socials = new Map()
  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href') || ''
    try {
      const url = new URL(rawHref, pageUrl)
      if (!['http:', 'https:'].includes(url.protocol)) return
      const hostname = url.hostname.toLowerCase()
      const label = `${$(element).text()} ${rawHref}`.replace(/\s+/g, ' ').trim()
      const social = socialFromUrl(url.toString())
      if (social) {
        if (!socials.has(social.platform)) socials.set(social.platform, { ...social, sourceUrl: pageUrl })
        return
      }
      if (!sameWebsite(hostname, rootHostname)) return
      const href = cleanUrl(url.toString())
      if (/contact|nous-contacter|contactez|service-client|customer-service/i.test(label)) contactLinks.push({ url: href, score: /contact/i.test(label) ? 10 : 6 })
      if (/mentions-legales|legal|a-propos|about|qui-sommes-nous/i.test(label) && !crawlLinks.has(href)) crawlLinks.set(href, /mentions-legales|legal/i.test(label) ? 4 : 2)
    } catch {
      // Ignore invalid links in third-party pages.
    }
  })
  return { emails: [...emails], contactLinks, crawlLinks: [...crawlLinks.entries()].map(([url, score]) => ({ url, score })), socials: [...socials.values()] }
}

export function socialFromUrl(value) {
  try {
    const url = new URL(value)
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    const path = url.pathname.replace(/\/+$/, '')
    let platform
    if (hostname === 'facebook.com' || hostname.endsWith('.facebook.com')) platform = 'facebook'
    else if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) platform = 'instagram'
    else if (hostname === 'linkedin.com' || hostname.endsWith('.linkedin.com')) platform = 'linkedin'
    else return null
    if (!path || /^\/(login|sharer|share|dialog|plugins|policies|help|p|reel|reels|explore|stories|posts|pulse|jobs|in)(\/|$)/i.test(path)) return null
    if (platform === 'linkedin' && !/^\/(company|showcase|school)(\/|$)/i.test(path)) return null
    const segments = path.split('/').filter(Boolean)
    const handle = platform === 'linkedin' ? segments[1] : segments[0]
    if (!handle || ['profile.php', 'pages'].includes(handle) && !url.searchParams.get('id')) return null
    const canonical = `${url.protocol}//${hostname}${platform === 'facebook' && handle === 'profile.php' ? `/${url.searchParams.get('id')}` : path}`
    return { platform, url: canonical, handle: handle.startsWith('@') ? handle : `@${handle}` }
  } catch {
    return null
  }
}

function socialSearchScore(result, name, platform) {
  const social = socialFromUrl(result.url)
  if (!social || social.platform !== platform) return 0
  const tokens = nameTokens(name)
  const coverage = tokenCoverage(`${result.title} ${result.snippet} ${social.handle}`, tokens)
  if (coverage < 0.5) return 0
  let score = Math.round(coverage * 90)
  if (/officiel|official/i.test(result.title)) score += 8
  return Math.min(100, score)
}

async function findSocial(name, city, platform, warnings) {
  const compactNames = compactNameVariants(name).slice(0, 2)
  const queries = [...compactNames.map((item) => `${item} ${platform}`), `site:${platform}.com "${name}" ${city || 'France'}`]
  for (const query of queries) {
    try {
      const results = await bingSearch(query, 6)
      const match = results.map((result) => ({ ...result, score: socialSearchScore(result, name, platform) }))
        .filter((result) => result.score > 0)
        .sort((a, b) => b.score - a.score)[0]
      if (match) return match
    } catch {
      warnings.push(`${platform === 'facebook' ? 'Facebook' : platform === 'instagram' ? 'Instagram' : 'LinkedIn'} 公开搜索暂不可用。`)
      return null
    }
  }
  return null
}

async function inspectWebsite(candidate, name) {
  const inspected = { website: null, websiteConfidence: 'candidate', emails: [], contactPage: null, socials: [], pagesChecked: [], warnings: [] }
  if (!candidate) return { ...inspected, websiteConfidence: 'not_found' }
  const tokens = nameTokens(name)
  try {
    const homepage = await fetchHtml(candidate.url, 12_000)
    const homeData = extractPageData(homepage.html, homepage.url, homepage.url)
    const pageText = cheerio.load(homepage.html)('title').text() + ' ' + cheerio.load(homepage.html)('meta[name="description"]').attr('content')
    const hostname = new URL(homepage.url).hostname
    const verified = tokenCoverage(pageText, tokens) >= 0.5 || tokenCoverage(hostname.replace(/[.-]/g, ' '), tokens) >= 0.8
    inspected.websiteConfidence = verified ? 'verified' : 'candidate'
    inspected.website = { value: hostname.replace(/^www\./, ''), url: homepage.url, sourceUrl: candidate.url, sourceLabel: '公开网页搜索' }
    inspected.pagesChecked.push(homepage.url)
    inspected.emails.push(...homeData.emails.map((value) => ({ value, url: `mailto:${value}`, sourceUrl: homepage.url, sourceLabel: '公司官网' })))
    inspected.socials.push(...homeData.socials.map((social) => ({ ...social, confidence: verified ? 'verified' : 'candidate' })))

    const additional = [...homeData.contactLinks, ...homeData.crawlLinks]
      .sort((a, b) => b.score - a.score)
      .filter((item, index, list) => list.findIndex((other) => other.url === item.url) === index)
      .slice(0, 3)
    const pages = await Promise.all(additional.map(async (item) => {
      try {
        const page = await fetchHtml(item.url, 9_000)
        return { ...page, data: extractPageData(page.html, page.url, homepage.url) }
      } catch {
        return null
      }
    }))
    for (const page of pages.filter(Boolean)) {
      inspected.pagesChecked.push(page.url)
      inspected.emails.push(...page.data.emails.map((value) => ({ value, url: `mailto:${value}`, sourceUrl: page.url, sourceLabel: '公司官网' })))
      for (const social of page.data.socials) {
        if (!inspected.socials.some((item) => item.platform === social.platform)) inspected.socials.push({ ...social, confidence: verified ? 'verified' : 'candidate' })
      }
    }
    const contact = [...homeData.contactLinks, ...pages.filter(Boolean).flatMap((page) => page.data.contactLinks)].sort((a, b) => b.score - a.score)[0]
    if (contact) inspected.contactPage = { value: new URL(contact.url).hostname, url: contact.url, sourceUrl: homepage.url, sourceLabel: '公司官网' }
  } catch {
    inspected.website = { value: new URL(candidate.url).hostname.replace(/^www\./, ''), url: candidate.url, sourceUrl: candidate.url, sourceLabel: '公开网页搜索' }
    inspected.warnings.push('官网当前无法自动读取，已保留搜索候选链接供人工确认。')
  }
  inspected.emails = inspected.emails.filter((item, index, list) => list.findIndex((other) => other.value === item.value) === index).slice(0, 5)
  return inspected
}

export async function enrichCompany(company) {
  const cached = enrichmentCache.get(company.siren)
  if (cached && Date.now() - cached.time < 30 * 60_000) return cached.value
  const warnings = []
  const websiteCandidate = await discoverWebsite(company.name, company.postcode, company.city, warnings)
  const [inspected, ...socialResults] = await Promise.all([
    inspectWebsite(websiteCandidate, company.name),
    ...['facebook', 'instagram', 'linkedin'].map((platform) => findSocial(company.name, company.city, platform, warnings)),
  ])
  const socials = [...inspected.socials]
  for (const [index, result] of socialResults.entries()) {
    const platform = ['facebook', 'instagram', 'linkedin'][index]
    if (!result || socials.some((item) => item.platform === platform)) continue
    const social = socialFromUrl(result.url)
    if (social) socials.push({ ...social, confidence: 'candidate', sourceUrl: result.url })
  }
  const order = { facebook: 0, instagram: 1, linkedin: 2 }
  socials.sort((a, b) => order[a.platform] - order[b.platform])
  const allWarnings = [...new Set([...warnings, ...inspected.warnings])]
  const value = {
    company,
    enrichment: {
      website: inspected.website,
      websiteConfidence: inspected.websiteConfidence,
      emails: inspected.emails,
      contactPage: inspected.contactPage,
      socials,
      checkedAt: new Date().toISOString(),
      pagesChecked: inspected.pagesChecked,
      warnings: allWarnings,
    },
  }
  enrichmentCache.set(company.siren, { time: Date.now(), value })
  return value
}
