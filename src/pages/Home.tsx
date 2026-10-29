import { useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  Building2,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Facebook,
  FileJson,
  FileSpreadsheet,
  Globe2,
  Instagram,
  Link2,
  Linkedin,
  Mail,
  MapPin,
  RotateCcw,
  ShieldCheck,
  X,
} from 'lucide-react'
import { ApiError, enrichCompany, searchCompanies } from '@/lib/company-api'
import type {
  CompanyCandidate,
  CompanyResult,
  RecentQuery,
  SocialPlatform,
} from '@/types/company'
import '../App.css'

type Phase = 'idle' | 'searching' | 'selecting' | 'enriching' | 'success' | 'error'
type CopyState = string | null

const socialMeta: Record<SocialPlatform, { label: string; short: string }> = {
  facebook: { label: 'Facebook', short: '优先核验' },
  instagram: { label: 'Instagram', short: '公开账号' },
  linkedin: { label: 'LinkedIn', short: '企业主页' },
}

const socialIcons: Record<SocialPlatform, ReactNode> = {
  facebook: <Facebook size={19} strokeWidth={1.8} />,
  instagram: <Instagram size={19} strokeWidth={1.8} />,
  linkedin: <Linkedin size={19} strokeWidth={1.8} />,
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function downloadFile(content: string, type: string, filename: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function readRecent(): RecentQuery[] {
  try {
    const saved = JSON.parse(localStorage.getItem('atlas-recent') || '[]')
    return Array.isArray(saved) ? saved.slice(0, 3) : []
  } catch {
    localStorage.removeItem('atlas-recent')
    return []
  }
}

export default function Home() {
  const [name, setName] = useState('')
  const [postcode, setPostcode] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; postcode?: string }>({})
  const [phase, setPhase] = useState<Phase>('idle')
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([])
  const [result, setResult] = useState<CompanyResult | null>(null)
  const [pendingCompany, setPendingCompany] = useState<CompanyCandidate | null>(null)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<CopyState>(null)
  const [recent, setRecent] = useState<RecentQuery[]>(readRecent)
  const abortRef = useRef<AbortController | null>(null)

  const busy = phase === 'searching' || phase === 'enriching'

  const remember = (query: RecentQuery) => {
    const next = [query, ...recent.filter((item) => item.name !== query.name || item.postcode !== query.postcode)].slice(0, 3)
    setRecent(next)
    localStorage.setItem('atlas-recent', JSON.stringify(next))
  }

  const copyText = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(key)
      window.setTimeout(() => setCopied((current) => (current === key ? null : current)), 1800)
    } catch {
      setError('浏览器未允许复制，请手动选择文本复制。')
    }
  }

  const runEnrich = async (company: CompanyCandidate, controller: AbortController) => {
    setPhase('enriching')
    setPendingCompany(company)
    try {
      const enriched = await enrichCompany(company, controller.signal)
      setResult(enriched)
      setPhase('success')
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof ApiError ? caught.message : '官网信息提取失败，请检查网络后重试。')
      setPhase('error')
    }
  }

  const runSearch = async (queryName: string, queryPostcode: string) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setName(queryName)
    setPostcode(queryPostcode)
    setPhase('searching')
    setResult(null)
    setPendingCompany(null)
    setCandidates([])
    setError('')

    try {
      const response = await searchCompanies(queryName, queryPostcode, controller.signal)
      if (!response.candidates.length) {
        setError('没有找到名称与邮编同时匹配的公司。请检查拼写，或尝试公司的完整注册名称。')
        setPhase('error')
        return
      }
      remember({ name: queryName, postcode: queryPostcode })
      setCandidates(response.candidates)
      if (response.autoSelect) {
        await runEnrich(response.autoSelect, controller)
      } else {
        setPhase('selecting')
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof ApiError ? caught.message : '无法连接查询服务，请检查网络后重试。')
      setPhase('error')
    }
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanName = name.trim()
    const cleanPostcode = postcode.trim()
    const errors: { name?: string; postcode?: string } = {}
    if (cleanName.length < 2) errors.name = '请输入至少 2 个字符的公司名称'
    if (!/^\d{5}$/.test(cleanPostcode)) errors.postcode = '法国邮编应为 5 位数字'
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    void runSearch(cleanName, cleanPostcode)
  }

  const cancel = () => {
    abortRef.current?.abort()
    setPhase('idle')
    setPendingCompany(null)
    setResult(null)
  }

  const selectCandidate = (company: CompanyCandidate) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setError('')
    void runEnrich(company, controller)
  }

  const exportResult = (format: 'csv' | 'json') => {
    if (!result) return
    const { company, enrichment } = result
    const safeName = company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || company.siren
    if (format === 'json') {
      downloadFile(JSON.stringify(result, null, 2), 'application/json;charset=utf-8', `${safeName}-${company.siren}.json`)
      return
    }
    const social = (platform: SocialPlatform) => enrichment.socials.find((item) => item.platform === platform)?.url || ''
    const rows = [
      ['公司名称', 'SIREN', 'SIRET', '地址', '邮编', '城市', '官网', '邮箱', '联系页', 'Facebook', 'Instagram', 'LinkedIn', '登记信息来源'],
      [company.name, company.siren, company.siret, company.address, company.postcode, company.city, enrichment.website?.url || '', enrichment.emails.map((item) => item.value).join(' | '), enrichment.contactPage?.url || '', social('facebook'), social('instagram'), social('linkedin'), company.sourceUrl],
    ]
    const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')}`
    downloadFile(csv, 'text/csv;charset=utf-8', `${safeName}-${company.siren}.csv`)
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="/" aria-label="Atlas France 首页">
          <svg className="brand-mark" viewBox="0 0 34 34" aria-hidden="true">
            <path d="M3 28 15.5 5h3L31 28h-6.2l-2.4-4.8H11.3L8.9 28H3Zm10.8-9.6h6.1l-3.1-6.2-3 6.2Z" fill="currentColor" fillRule="evenodd" />
          </svg>
          <span>ATLAS</span>
          <span className="brand-country">FRANCE</span>
        </a>
        <div className="header-note">
          <span className="header-rule" />
          法国企业公开信息核验
          <span className="header-lang">中文 / FR</span>
        </div>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div>
            <p className="eyebrow"><span>Base Sirene</span> / 官方网站 / 公开社媒</p>
            <h1 id="page-title">找到公司，<br />也找到<span>正确的联系方式。</span></h1>
          </div>
          <p className="intro-note">
            输入法国公司名称与邮编，一次核验登记地址、公开邮箱、联系页面及社媒账号。
            <strong>每个结果都附来源，未公开就不猜测。</strong>
          </p>
        </section>

        <section className="search-section" aria-label="公司查询">
          <form onSubmit={submit} noValidate>
            <div className="field-group">
              <label htmlFor="company-name">公司名称 <span>Nom de l’entreprise</span></label>
              <div className={`input-wrap ${fieldErrors.name ? 'has-error' : ''}`}>
                <Building2 size={19} aria-hidden="true" />
                <input
                  id="company-name"
                  value={name}
                  onChange={(event) => { setName(event.target.value); setFieldErrors((old) => ({ ...old, name: undefined })) }}
                  placeholder="例如：La Poste"
                  autoComplete="organization"
                  disabled={busy}
                  aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.name)}
                />
              </div>
              {fieldErrors.name && <p className="field-error" id="name-error">{fieldErrors.name}</p>}
            </div>
            <div className="field-group postcode-field">
              <label htmlFor="postcode">法国邮编 <span>Code postal</span></label>
              <div className={`input-wrap ${fieldErrors.postcode ? 'has-error' : ''}`}>
                <MapPin size={19} aria-hidden="true" />
                <input
                  id="postcode"
                  value={postcode}
                  onChange={(event) => { setPostcode(event.target.value.replace(/\D/g, '').slice(0, 5)); setFieldErrors((old) => ({ ...old, postcode: undefined })) }}
                  placeholder="75015"
                  inputMode="numeric"
                  autoComplete="postal-code"
                  maxLength={5}
                  disabled={busy}
                  aria-describedby={fieldErrors.postcode ? 'postcode-error' : undefined}
                  aria-invalid={Boolean(fieldErrors.postcode)}
                />
              </div>
              {fieldErrors.postcode && <p className="field-error" id="postcode-error">{fieldErrors.postcode}</p>}
            </div>
            <button className="search-button" type="submit" disabled={busy}>
              <span>{phase === 'searching' ? '匹配登记信息…' : phase === 'enriching' ? '核验公开网页…' : '开始查询'}</span>
              {busy ? <span className="query-caret" aria-hidden="true" /> : <ArrowRight size={20} />}
            </button>
          </form>
          <div className="search-meta">
            <span><ShieldCheck size={14} /> 仅查询公开企业信息</span>
            {busy ? (
              <button type="button" className="text-button" onClick={cancel}><X size={14} /> 取消本次查询</button>
            ) : recent.length ? (
              <div className="recent-list"><span>最近查询</span>{recent.map((item) => <button key={`${item.name}-${item.postcode}`} onClick={() => void runSearch(item.name, item.postcode)}>{item.name} · {item.postcode}</button>)}</div>
            ) : (
              <button type="button" className="example-query" onClick={() => void runSearch('La Poste', '75015')}>试试 La Poste · 75015 <ArrowUpRight size={13} /></button>
            )}
          </div>
        </section>

        {phase === 'idle' && (
          <section className="method-ledger" aria-label="信息核验方式">
            <div className="ledger-heading"><span>COMMENT ÇA MARCHE</span><p>从注册主体到公开联络方式，三步交叉核验。</p></div>
            <div className="ledger-item"><span className="ledger-number">01</span><div><h2>确认公司主体</h2><p>通过法国政府开放数据匹配名称、邮编、SIREN 与登记地址。</p></div></div>
            <div className="ledger-item"><span className="ledger-number">02</span><div><h2>查找官方网站</h2><p>从官网页面提取公开邮箱与联系页，保留每一项的来源链接。</p></div></div>
            <div className="ledger-item"><span className="ledger-number">03</span><div><h2>核验社媒账号</h2><p>优先检查 Facebook，同时查找 Instagram 与 LinkedIn 企业主页。</p></div></div>
          </section>
        )}

        {busy && (
          <section className="query-progress" aria-live="polite">
            <div className="progress-topline"><span>RECHERCHE EN COURS</span><span>{name} · {postcode}</span></div>
            <h2>{phase === 'searching' ? '正在确认最匹配的登记主体' : `正在核验 ${pendingCompany?.name || name} 的公开联络信息`}</h2>
            <div className="progress-steps">
              <div className={phase === 'enriching' ? 'complete' : 'active'}><span>{phase === 'enriching' ? <Check size={15} /> : '1'}</span><p>政府企业登记<small>名称、邮编与地址</small></p></div>
              <div className={phase === 'enriching' ? 'active' : ''}><span>2</span><p>官方网站<small>邮箱与联系页面</small></p></div>
              <div className={phase === 'enriching' ? 'active' : ''}><span>3</span><p>公开社媒<small>Facebook 优先</small></p></div>
            </div>
            <p className="progress-note">网页核验通常需要几秒；未找到的信息会如实标注。</p>
          </section>
        )}

        {phase === 'selecting' && (
          <section className="candidate-section" aria-labelledby="candidate-title">
            <div className="section-kicker">VÉRIFICATION REQUISE</div>
            <div className="candidate-heading"><div><h2 id="candidate-title">确认你要找的公司</h2><p>发现多个相似主体。选择后才会继续查询联系方式，避免误配。</p></div><span>{candidates.length} 个候选</span></div>
            <div className="candidate-list">
              {candidates.map((company, index) => (
                <button key={company.siren} onClick={() => selectCandidate(company)}>
                  <span className="candidate-index">{String(index + 1).padStart(2, '0')}</span>
                  <span className="candidate-main"><strong>{company.name}</strong><small>{company.address}</small></span>
                  <span className="candidate-id"><small>SIREN</small>{company.siren}</span>
                  <span className={`match-label ${company.matchScore >= 85 ? 'high' : ''}`}>{company.matchLabel}</span>
                  <ChevronRight size={19} />
                </button>
              ))}
            </div>
          </section>
        )}

        {phase === 'error' && (
          <section className="error-state" role="alert">
            <AlertCircle size={28} strokeWidth={1.6} />
            <div><p className="section-kicker">RECHERCHE INTERROMPUE</p><h2>这次查询还没有完成</h2><p>{error}</p></div>
            <button onClick={() => void runSearch(name.trim(), postcode.trim())}><RotateCcw size={16} /> 重新查询</button>
          </section>
        )}

        {phase === 'success' && result && (
          <section className="result-section" aria-labelledby="company-result-title">
            <div className="result-toolbar">
              <span><CheckCircle2 size={16} /> 查询完成 · {new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(result.enrichment.checkedAt))}</span>
              <div><button className="secondary-button" onClick={() => exportResult('csv')}><FileSpreadsheet size={15} /> 导出 CSV</button><button className="secondary-button icon-only" aria-label="导出 JSON" title="导出 JSON" onClick={() => exportResult('json')}><FileJson size={16} /></button></div>
            </div>
            <div className="company-heading">
              <div>
                <p className="section-kicker">FICHE ENTREPRISE / {result.company.siren}</p>
                <h2 id="company-result-title">{result.company.name}</h2>
                <div className="company-tags"><span className={result.company.active ? 'active-tag' : 'closed-tag'}>{result.company.active ? '正常登记' : '已停止登记'}</span><span>SIREN {result.company.siren}</span><button onClick={() => void copyText('siren', result.company.siren)} aria-label="复制 SIREN">{copied === 'siren' ? <Check size={13} /> : <Copy size={13} />}</button></div>
              </div>
              <a className="registry-link" href={result.company.sourceUrl} target="_blank" rel="noreferrer">查看官方登记 <ArrowUpRight size={16} /></a>
            </div>

            <div className="result-grid">
              <div className="primary-results">
                <section className="data-section">
                  <div className="data-label"><MapPin size={17} /><span>登记地址</span><small>ADRESSE OFFICIELLE</small></div>
                  <div className="address-value"><p>{result.company.address}</p><button className="copy-button" onClick={() => void copyText('address', result.company.address)}>{copied === 'address' ? <Check size={15} /> : <Copy size={15} />}{copied === 'address' ? '已复制' : '复制'}</button></div>
                  <a className="source-line" href={result.company.sourceUrl} target="_blank" rel="noreferrer">来源：Annuaire des Entreprises <ExternalLink size={12} /></a>
                </section>

                <section className="data-section">
                  <div className="data-label"><Mail size={17} /><span>公开邮箱</span><small>E-MAIL</small></div>
                  {result.enrichment.emails.length ? (
                    <div className="email-list">{result.enrichment.emails.map((email) => <div className="email-row" key={`${email.value}-${email.sourceUrl}`}><a href={`mailto:${email.value}`}>{email.value}</a><button className="copy-button" onClick={() => void copyText(`email-${email.value}`, email.value)} aria-label={`复制 ${email.value}`}>{copied === `email-${email.value}` ? <Check size={15} /> : <Copy size={15} />}</button><a className="row-source" href={email.sourceUrl} target="_blank" rel="noreferrer" title={`来源：${email.sourceLabel}`}>{hostOf(email.sourceUrl)} <ArrowUpRight size={12} /></a></div>)}</div>
                  ) : <div className="not-found"><span>—</span><p>未在已核验的公开官网页面中找到邮箱<small>不代表该公司没有邮箱，建议通过联系页询问。</small></p></div>}
                </section>

                <section className="data-section contact-section">
                  <div className="data-label"><Link2 size={17} /><span>联系页面</span><small>CONTACT</small></div>
                  {result.enrichment.contactPage ? <a className="contact-link" href={result.enrichment.contactPage.url} target="_blank" rel="noreferrer"><span>{hostOf(result.enrichment.contactPage.url)}<small>{result.enrichment.contactPage.url}</small></span><ArrowUpRight size={20} /></a> : <div className="not-found"><span>—</span><p>未找到明确的公开联系页面</p></div>}
                </section>
              </div>

              <aside className="secondary-results">
                <section className="website-section">
                  <div className="data-label"><Globe2 size={17} /><span>官方网站</span></div>
                  {result.enrichment.website ? <><a href={result.enrichment.website.url} target="_blank" rel="noreferrer">{hostOf(result.enrichment.website.url)} <ArrowUpRight size={15} /></a><small className={result.enrichment.websiteConfidence === 'verified' ? 'verified-text' : 'candidate-text'}>{result.enrichment.websiteConfidence === 'verified' ? '名称与公开网页交叉匹配' : '搜索候选，请打开后确认'}</small></> : <p className="aside-empty">未找到可确认的官方网站</p>}
                </section>

                <section className="social-section">
                  <div className="aside-heading"><div><p className="section-kicker">RÉSEAUX SOCIAUX</p><h3>社媒账号</h3></div><span>{result.enrichment.socials.length}/3</span></div>
                  <div className="social-list">
                    {(['facebook', 'instagram', 'linkedin'] as SocialPlatform[]).map((platform) => {
                      const profile = result.enrichment.socials.find((item) => item.platform === platform)
                      return <div className={`social-row ${platform === 'facebook' ? 'priority-social' : ''}`} key={platform}>
                        <div className="social-platform">{socialIcons[platform]}<span>{socialMeta[platform].label}<small>{socialMeta[platform].short}</small></span></div>
                        {profile ? <div className="social-value"><a href={profile.url} target="_blank" rel="noreferrer">{profile.handle}<ArrowUpRight size={13} /></a><small className={profile.confidence === 'verified' ? 'verified-text' : 'candidate-text'}>{profile.confidence === 'verified' ? '官网验证' : '待确认'}</small></div> : <span className="social-missing">未找到</span>}
                      </div>
                    })}
                  </div>
                  <p className="social-note">“待确认”表示来自公开搜索候选，打开页面核对公司主体后再使用。</p>
                </section>

                <section className="audit-section">
                  <div className="aside-heading"><div><p className="section-kicker">TRAÇABILITÉ</p><h3>来源与核验</h3></div><ShieldCheck size={20} /></div>
                  <ul>
                    <li><Check size={14} /><span>政府登记信息<small>SIREN / SIRET / 地址</small></span></li>
                    <li className={result.enrichment.website ? '' : 'muted-check'}>{result.enrichment.website ? <Check size={14} /> : <X size={14} />}<span>官网公开页面<small>{result.enrichment.pagesChecked.length ? `已检查 ${result.enrichment.pagesChecked.length} 个页面` : '未发现可访问官网'}</small></span></li>
                    <li><Check size={14} /><span>公开搜索交叉查找<small>社媒候选已标注可信度</small></span></li>
                  </ul>
                  {result.enrichment.warnings.map((warning) => <p className="audit-warning" key={warning}>{warning}</p>)}
                </section>
              </aside>
            </div>
            <div className="result-footer"><span>信息提取于 {new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(result.enrichment.checkedAt))}</span><p>公开信息可能变化，用于重要业务前请通过官网再次确认。</p></div>
          </section>
        )}
      </main>

      <footer className="site-footer"><span>ATLAS FRANCE</span><p>企业公开信息查询工具 · 不展示或推断私人联系方式</p><span>SIRENE + WEB PUBLIC</span></footer>
      <div className="sr-only" aria-live="polite">{copied ? '已复制到剪贴板' : ''}</div>
    </div>
  )
}
