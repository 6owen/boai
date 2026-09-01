import type {
  SkillMarketplaceDetailRequest,
  SkillMarketplaceItem,
  SkillMarketplaceListRequest,
  SkillMarketplaceListResult,
  SkillMarketplaceProvider,
  SkillMarketplaceSort,
} from '@craft-agent/shared/skills'

const REQUEST_TIMEOUT_MS = 15_000
const DEFAULT_LIMIT = 30
const MAX_LIMIT = 50

type FetchLike = typeof fetch

function clampLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return DEFAULT_LIMIT
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value!)))
}

function clampPage(value: number | undefined): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value!))
}

async function fetchResponse(fetchImpl: FetchLike, url: string): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json, text/markdown;q=0.9, */*;q=0.8' },
      redirect: 'follow',
      signal: controller.signal,
    })
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Marketplace request failed (${response.status}): ${body.slice(0, 240)}`)
    }
    return response
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJson<T>(fetchImpl: FetchLike, url: string): Promise<T> {
  const response = await fetchResponse(fetchImpl, url)
  return await response.json() as T
}

function timestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }
  return undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function sortItems(items: SkillMarketplaceItem[], sort: SkillMarketplaceSort): SkillMarketplaceItem[] {
  if (sort === 'updated') {
    return items.toSorted((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
  }
  if (sort === 'downloads') {
    return items.toSorted((a, b) => (b.downloads ?? b.installs ?? 0) - (a.downloads ?? a.installs ?? 0))
  }
  return items
}

interface SkillsShRawSkill {
  id?: string
  skillId?: string
  slug?: string
  name?: string
  source?: string
  installs?: number
  installUrl?: string | null
  url?: string
  isOfficial?: boolean
}

interface SkillsShSearchResponse {
  skills?: SkillsShRawSkill[]
  count?: number
}

function mapSkillsShItem(skill: SkillsShRawSkill): SkillMarketplaceItem | null {
  const source = typeof skill.source === 'string' ? skill.source.trim() : ''
  const suppliedId = typeof skill.id === 'string' ? skill.id.trim() : ''
  const slug = (skill.skillId || skill.slug || skill.name || suppliedId.split('/').at(-1) || '').trim()
  const id = suppliedId || (source && slug ? `${source}/${slug}` : '')
  if (!id || !source || !slug) return null
  const owner = source.split('/')[0]
  return {
    id,
    provider: 'skills-sh',
    slug,
    name: (skill.name || slug).trim(),
    owner,
    source,
    homepage: skill.url || `https://skills.sh/${id}`,
    repository: skill.installUrl || `https://github.com/${source}`,
    installs: numberValue(skill.installs),
    verified: skill.isOfficial,
    install: { kind: 'git', source, slug },
  }
}

async function searchSkillsSh(
  fetchImpl: FetchLike,
  query: string,
  limit: number,
): Promise<SkillsShSearchResponse> {
  const params = new URLSearchParams({ q: query, limit: String(limit) })
  return await fetchJson<SkillsShSearchResponse>(fetchImpl, `https://skills.sh/api/search?${params}`)
}

async function listSkillsSh(
  request: SkillMarketplaceListRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceListResult> {
  const limit = clampLimit(request.limit)
  const query = request.query?.trim() ?? ''
  if (query.length >= 2) {
    const response = await searchSkillsSh(fetchImpl, query, limit)
    const items = (response.skills ?? [])
      .map(mapSkillsShItem)
      .filter((item): item is SkillMarketplaceItem => item !== null)
    return { items, total: response.count, hasMore: false }
  }

  const page = clampPage(request.page)
  const view = request.sort === 'trending' || request.sort === 'hot'
    ? request.sort
    : 'all-time'
  const response = await fetchJson<{
    skills?: SkillsShRawSkill[]
    total?: number
    page?: number
    hasMore?: boolean
  }>(fetchImpl, `https://skills.sh/api/skills/${view}/${page}`)
  const items = (response.skills ?? [])
    .map(mapSkillsShItem)
    .filter((item): item is SkillMarketplaceItem => item !== null)
  const hasMore = response.hasMore === true
  return {
    items,
    total: response.total,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

interface ClawHubListSkill {
  slug?: string
  displayName?: string
  summary?: string
  description?: string
  icon?: string | null
  stats?: { downloads?: number; installs?: number; stars?: number }
  latestVersion?: { version?: string }
  updatedAt?: number
}

interface ClawHubSearchSkill {
  slug?: string
  displayName?: string
  summary?: string
  downloads?: number
  icon?: string | null
  ownerHandle?: string
  owner?: { handle?: string; displayName?: string; image?: string }
  metrics?: { updatedAt?: number }
  native?: { skill?: ClawHubListSkill & { isSuspicious?: boolean }; owner?: { handle?: string; image?: string } }
  official?: boolean
}

function clawHubHomepage(owner: string | undefined, slug: string): string {
  return owner
    ? `https://clawhub.ai/${encodeURIComponent(owner)}/skills/${encodeURIComponent(slug)}`
    : `https://clawhub.ai/skills/${encodeURIComponent(slug)}`
}

function mapClawHubListItem(skill: ClawHubListSkill): SkillMarketplaceItem | null {
  const slug = skill.slug?.trim() ?? ''
  if (!slug) return null
  return {
    id: slug,
    provider: 'clawhub',
    slug,
    name: skill.displayName?.trim() || slug,
    description: skill.summary || skill.description,
    homepage: clawHubHomepage(undefined, slug),
    iconUrl: skill.icon || undefined,
    version: skill.latestVersion?.version,
    installs: numberValue(skill.stats?.installs),
    downloads: numberValue(skill.stats?.downloads),
    stars: numberValue(skill.stats?.stars),
    updatedAt: timestamp(skill.updatedAt),
  }
}

function mapClawHubSearchItem(result: ClawHubSearchSkill): SkillMarketplaceItem | null {
  const slug = result.slug?.trim() ?? result.native?.skill?.slug?.trim() ?? ''
  const owner = result.ownerHandle?.trim() || result.owner?.handle?.trim() || result.native?.owner?.handle?.trim()
  if (!slug || !owner) return null
  const native = result.native?.skill
  return {
    id: `${owner}/${slug}`,
    provider: 'clawhub',
    slug,
    name: result.displayName?.trim() || native?.displayName?.trim() || slug,
    owner,
    source: owner,
    description: result.summary || native?.summary || native?.description,
    homepage: clawHubHomepage(owner, slug),
    iconUrl: result.icon || result.owner?.image || result.native?.owner?.image || undefined,
    installs: numberValue(native?.stats?.installs),
    downloads: numberValue(result.downloads) ?? numberValue(native?.stats?.downloads),
    stars: numberValue(native?.stats?.stars),
    updatedAt: timestamp(result.metrics?.updatedAt ?? native?.updatedAt),
    verified: result.official,
    suspicious: native?.isSuspicious,
    install: {
      kind: 'url',
      source: `https://clawhub.ai/api/v1/download?slug=${encodeURIComponent(slug)}&ownerHandle=${encodeURIComponent(owner)}`,
      slug,
    },
  }
}

function clawHubSort(sort: SkillMarketplaceSort): string {
  if (sort === 'downloads') return 'downloads'
  if (sort === 'trending') return 'trending'
  if (sort === 'updated') return 'updated'
  return 'recommended'
}

async function listClawHub(
  request: SkillMarketplaceListRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceListResult> {
  const limit = clampLimit(request.limit)
  const query = request.query?.trim() ?? ''
  if (query) {
    const params = new URLSearchParams({ q: query, nonSuspiciousOnly: 'true' })
    const data = await fetchJson<{ results?: ClawHubSearchSkill[] }>(
      fetchImpl,
      `https://clawhub.ai/api/v1/search?${params}`,
    )
    const items = (data.results ?? []).map(mapClawHubSearchItem).filter((item): item is SkillMarketplaceItem => item !== null)
    return { items: items.slice(0, limit), total: items.length }
  }

  const params = new URLSearchParams({
    limit: String(limit),
    sort: clawHubSort(request.sort ?? 'recommended'),
    nonSuspiciousOnly: 'true',
  })
  if (request.cursor) params.set('cursor', request.cursor)
  const data = await fetchJson<{ items?: ClawHubListSkill[]; nextCursor?: string }>(
    fetchImpl,
    `https://clawhub.ai/api/v1/skills?${params}`,
  )
  const items = (data.items ?? []).map(mapClawHubListItem).filter((item): item is SkillMarketplaceItem => item !== null)
  return {
    items,
    hasMore: Boolean(data.nextCursor),
    nextCursor: data.nextCursor || undefined,
  }
}

interface SkillHubListSkill {
  slug?: string
  name?: string
  displayName?: string
  description?: string
  description_zh?: string
  summary?: string
  ownerName?: string
  owner_name?: string
  namespace?: { canonicalName?: string; displayName?: string; handle?: string }
  homepage?: string
  iconUrl?: string | null
  icon_url?: string | null
  version?: string
  installs?: number
  downloads?: number
  stars?: number
  updated_at?: number
  updatedAt?: number
  verified?: boolean
  source?: string
}

function mapSkillHubItem(skill: SkillHubListSkill): SkillMarketplaceItem | null {
  const slug = skill.slug?.trim() ?? ''
  if (!slug) return null
  const owner = skill.ownerName?.trim() || skill.owner_name?.trim() || skill.namespace?.displayName?.trim()
  return {
    id: skill.namespace?.canonicalName || `${owner || 'skillhub'}/${slug}`,
    provider: 'skillhub',
    slug,
    name: skill.displayName?.trim() || skill.name?.trim() || slug,
    owner,
    source: skill.source,
    description: skill.description_zh || skill.summary || skill.description,
    homepage: skill.homepage || `https://skillhub.cn/skills/${encodeURIComponent(slug)}`,
    iconUrl: skill.iconUrl || skill.icon_url || undefined,
    version: skill.version,
    installs: numberValue(skill.installs),
    downloads: numberValue(skill.downloads),
    stars: numberValue(skill.stars),
    updatedAt: timestamp(skill.updatedAt ?? skill.updated_at),
    verified: skill.verified,
    install: {
      kind: 'url',
      source: `https://api.skillhub.cn/api/v1/download?slug=${encodeURIComponent(slug)}`,
      slug,
    },
  }
}

async function listSkillHub(
  request: SkillMarketplaceListRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceListResult> {
  const limit = clampLimit(request.limit)
  const query = request.query?.trim() ?? ''
  let rawItems: SkillHubListSkill[] = []
  let total: number | undefined

  if (query) {
    const params = new URLSearchParams({ q: query, limit: String(limit) })
    const data = await fetchJson<{ results?: SkillHubListSkill[] }>(
      fetchImpl,
      `https://api.skillhub.cn/api/v1/search?${params}`,
    )
    rawItems = data.results ?? []
    total = rawItems.length
  } else {
    const page = clampPage(request.page)
    const params = new URLSearchParams({ page: String(page + 1), pageSize: String(limit) })
    const data = await fetchJson<{ data?: { skills?: SkillHubListSkill[]; total?: number } }>(
      fetchImpl,
      `https://api.skillhub.cn/api/skills?${params}`,
    )
    rawItems = data.data?.skills ?? []
    total = data.data?.total
  }

  const items = rawItems.map(mapSkillHubItem).filter((item): item is SkillMarketplaceItem => item !== null)
  const page = clampPage(request.page)
  const hasMore = !query && (typeof total === 'number'
    ? (page + 1) * limit < total
    : rawItems.length === limit)
  return {
    items: sortItems(items, request.sort ?? 'recommended'),
    total,
    hasMore,
    nextPage: hasMore ? page + 1 : undefined,
  }
}

async function resolveClawHubIdentity(
  fetchImpl: FetchLike,
  id: string,
): Promise<{ owner?: string; slug: string }> {
  const lastSlash = id.lastIndexOf('/')
  if (lastSlash > 0) {
    return { owner: id.slice(0, lastSlash), slug: id.slice(lastSlash + 1) }
  }

  const params = new URLSearchParams({ q: id, mode: 'exact', nonSuspiciousOnly: 'true' })
  const data = await fetchJson<{ results?: ClawHubSearchSkill[] }>(
    fetchImpl,
    `https://clawhub.ai/api/v1/search?${params}`,
  )
  const matches = (data.results ?? [])
    .map(mapClawHubSearchItem)
    .filter((item): item is SkillMarketplaceItem => item !== null && item.slug === id)
    .toSorted((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0))
  return { owner: matches[0]?.owner, slug: id }
}

async function getClawHubDetail(
  request: SkillMarketplaceDetailRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceItem> {
  const { owner, slug } = await resolveClawHubIdentity(fetchImpl, request.id)
  const detailParams = new URLSearchParams()
  if (owner) detailParams.set('ownerHandle', owner)
  const suffix = detailParams.size > 0 ? `?${detailParams}` : ''
  const data = await fetchJson<{
    skill?: ClawHubListSkill & { description?: string; isSuspicious?: boolean }
    owner?: { handle?: string; displayName?: string; image?: string }
    latestVersion?: { version?: string }
    moderation?: { verdict?: string } | null
  }>(fetchImpl, `https://clawhub.ai/api/v1/skills/${encodeURIComponent(slug)}${suffix}`)
  const skill = data.skill
  if (!skill) throw new Error('ClawHub skill not found')
  const resolvedOwner = data.owner?.handle || owner
  const item = mapClawHubSearchItem({
    slug,
    displayName: skill.displayName,
    summary: skill.summary,
    downloads: skill.stats?.downloads,
    ownerHandle: resolvedOwner,
    owner: { handle: resolvedOwner, displayName: data.owner?.displayName, image: data.owner?.image },
    native: { skill },
  })
  if (!item) throw new Error('ClawHub returned an invalid skill record')
  return {
    ...item,
    description: skill.summary || skill.description,
    content: skill.description,
    version: data.latestVersion?.version || skill.latestVersion?.version,
    suspicious: skill.isSuspicious || data.moderation?.verdict === 'malicious',
  }
}

async function getSkillHubDetail(
  request: SkillMarketplaceDetailRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceItem> {
  const slug = request.id.split('/').at(-1)?.replace(/^@/, '') ?? request.id
  const data = await fetchJson<{
    skill?: SkillHubListSkill & {
      displayName?: string
      summary?: string
      summary_zh?: string
      sourceUrl?: string
      stats?: { downloads?: number; installs?: number; stars?: number }
    }
    owner?: { handle?: string; displayName?: string; image?: string }
    latestVersion?: { version?: string }
    namespace?: { canonicalName?: string; displayName?: string }
    securityReports?: Record<string, { status?: string; statusText?: string; reportUrl?: string }>
  }>(fetchImpl, `https://api.skillhub.cn/api/v1/skills/${encodeURIComponent(slug)}`)
  if (!data.skill) throw new Error('SkillHub skill not found')
  const base = mapSkillHubItem({
    ...data.skill,
    slug,
    name: data.skill.displayName,
    description_zh: data.skill.summary_zh,
    description: data.skill.summary,
    ownerName: data.owner?.displayName || data.owner?.handle,
    namespace: data.namespace,
    version: data.latestVersion?.version,
    installs: data.skill.stats?.installs,
    downloads: data.skill.stats?.downloads,
    stars: data.skill.stats?.stars,
    homepage: data.skill.sourceUrl,
  })
  if (!base) throw new Error('SkillHub returned an invalid skill record')

  let content: string | undefined
  try {
    const contentResponse = await fetchResponse(
      fetchImpl,
      `https://api.skillhub.cn/api/v1/skills/${encodeURIComponent(slug)}/file?path=SKILL.md`,
    )
    content = await contentResponse.text()
  } catch {
    // Some imported records do not expose their source file. Metadata remains useful.
  }

  const securityReports = Object.entries(data.securityReports ?? {}).map(([provider, report]) => ({
    provider,
    status: report.status || 'unknown',
    statusText: report.statusText,
    reportUrl: report.reportUrl,
  }))
  return { ...base, content, securityReports }
}

async function getSkillsShDetail(
  request: SkillMarketplaceDetailRequest,
  fetchImpl: FetchLike,
): Promise<SkillMarketplaceItem> {
  const slug = request.id.split('/').at(-1) ?? request.id
  const data = await searchSkillsSh(fetchImpl, slug, MAX_LIMIT)
  const exact = (data.skills ?? []).find(skill => skill.id === request.id)
  const item = exact ? mapSkillsShItem(exact) : null
  if (!item) throw new Error('skills.sh skill not found')
  return item
}

export async function listSkillMarketplace(
  request: SkillMarketplaceListRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SkillMarketplaceListResult> {
  if (request.provider === 'skills-sh') return await listSkillsSh(request, fetchImpl)
  if (request.provider === 'clawhub') return await listClawHub(request, fetchImpl)
  if (request.provider === 'skillhub') return await listSkillHub(request, fetchImpl)
  throw new Error(`Unsupported Skill marketplace provider: ${String(request.provider)}`)
}

export async function getSkillMarketplaceDetail(
  request: SkillMarketplaceDetailRequest,
  fetchImpl: FetchLike = fetch,
): Promise<SkillMarketplaceItem> {
  if (!request.id.trim()) throw new Error('Skill marketplace id is required')
  if (request.provider === 'skills-sh') return await getSkillsShDetail(request, fetchImpl)
  if (request.provider === 'clawhub') return await getClawHubDetail(request, fetchImpl)
  if (request.provider === 'skillhub') return await getSkillHubDetail(request, fetchImpl)
  throw new Error(`Unsupported Skill marketplace provider: ${String(request.provider)}`)
}

export const SKILL_MARKETPLACE_PROVIDERS: readonly SkillMarketplaceProvider[] = [
  'skills-sh',
  'clawhub',
  'skillhub',
]
