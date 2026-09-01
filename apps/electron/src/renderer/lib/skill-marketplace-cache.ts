import type {
  SkillMarketplaceDetailRequest,
  SkillMarketplaceItem,
  SkillMarketplaceListRequest,
  SkillMarketplaceListResult,
  SkillMarketplaceProvider,
} from '../../shared/types'

const CACHE_TTL_MS = 5 * 60 * 1_000
const MAX_LIST_ENTRIES = 100
const MAX_DETAIL_ENTRIES = 100

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

const listCache = new Map<string, CacheEntry<SkillMarketplaceListResult>>()
const detailCache = new Map<string, CacheEntry<SkillMarketplaceItem>>()
const listRequests = new Map<string, Promise<SkillMarketplaceListResult>>()
const detailRequests = new Map<string, Promise<SkillMarketplaceItem>>()
const providerGenerations = new Map<SkillMarketplaceProvider, number>()

function listKey(request: SkillMarketplaceListRequest): string {
  return JSON.stringify([
    request.provider,
    request.query?.trim() ?? '',
    request.sort ?? '',
    request.limit ?? null,
    request.page ?? null,
    request.cursor ?? '',
  ])
}

function detailKey(request: SkillMarketplaceDetailRequest): string {
  return JSON.stringify([request.provider, request.id])
}

function readEntry<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) return undefined
  return entry.value
}

function writeEntry<T>(cache: Map<string, CacheEntry<T>>, key: string, value: T, maxEntries: number): void {
  cache.delete(key)
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS })
  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value
    if (oldestKey === undefined) break
    cache.delete(oldestKey)
  }
}

function generation(provider: SkillMarketplaceProvider): number {
  return providerGenerations.get(provider) ?? 0
}

export function getCachedSkillMarketplacePage(
  request: SkillMarketplaceListRequest,
): SkillMarketplaceListResult | undefined {
  return readEntry(listCache, listKey(request))
}

export function getCachedSkillMarketplaceSequence(
  baseRequest: SkillMarketplaceListRequest,
): SkillMarketplaceListResult | undefined {
  let request: SkillMarketplaceListRequest = {
    ...baseRequest,
    page: 0,
    cursor: undefined,
  }
  const items: SkillMarketplaceItem[] = []
  const itemIds = new Set<string>()
  const pageKeys = new Set<string>()
  let total: number | undefined
  let lastResult: SkillMarketplaceListResult | undefined

  while (true) {
    const key = listKey(request)
    if (pageKeys.has(key)) break
    pageKeys.add(key)
    const result = getCachedSkillMarketplacePage(request)
    if (!result) break
    lastResult = result
    total = result.total ?? total
    for (const item of result.items) {
      const identity = `${item.provider}:${item.id}`
      if (itemIds.has(identity)) continue
      itemIds.add(identity)
      items.push(item)
    }
    if (!result.hasMore) break
    if (result.nextCursor) {
      request = { ...baseRequest, page: undefined, cursor: result.nextCursor }
      continue
    }
    if (result.nextPage !== undefined) {
      request = { ...baseRequest, page: result.nextPage, cursor: undefined }
      continue
    }
    break
  }

  if (!lastResult) return undefined
  return {
    items,
    total,
    hasMore: lastResult.hasMore,
    nextPage: lastResult.nextPage,
    nextCursor: lastResult.nextCursor,
  }
}

export function loadSkillMarketplacePage(
  request: SkillMarketplaceListRequest,
): Promise<SkillMarketplaceListResult> {
  const key = listKey(request)
  const cached = getCachedSkillMarketplacePage(request)
  if (cached) return Promise.resolve(cached)

  const currentGeneration = generation(request.provider)
  const requestKey = `${currentGeneration}:${key}`
  const activeRequest = listRequests.get(requestKey)
  if (activeRequest) return activeRequest

  const promise = window.electronAPI.listSkillMarketplace(request)
    .then(result => {
      if (generation(request.provider) === currentGeneration) {
        writeEntry(listCache, key, result, MAX_LIST_ENTRIES)
      }
      return result
    })
    .finally(() => listRequests.delete(requestKey))
  listRequests.set(requestKey, promise)
  return promise
}

export function getCachedSkillMarketplaceDetail(
  request: SkillMarketplaceDetailRequest,
): SkillMarketplaceItem | undefined {
  return readEntry(detailCache, detailKey(request))
}

export function loadSkillMarketplaceDetail(
  request: SkillMarketplaceDetailRequest,
): Promise<SkillMarketplaceItem> {
  const key = detailKey(request)
  const cached = getCachedSkillMarketplaceDetail(request)
  if (cached) return Promise.resolve(cached)

  const currentGeneration = generation(request.provider)
  const requestKey = `${currentGeneration}:${key}`
  const activeRequest = detailRequests.get(requestKey)
  if (activeRequest) return activeRequest

  const promise = window.electronAPI.getSkillMarketplaceDetail(request)
    .then(result => {
      if (generation(request.provider) === currentGeneration) {
        writeEntry(detailCache, key, result, MAX_DETAIL_ENTRIES)
      }
      return result
    })
    .finally(() => detailRequests.delete(requestKey))
  detailRequests.set(requestKey, promise)
  return promise
}

export function invalidateSkillMarketplaceProvider(provider: SkillMarketplaceProvider): void {
  providerGenerations.set(provider, generation(provider) + 1)
  for (const key of listCache.keys()) {
    if (key.startsWith(`["${provider}",`)) listCache.delete(key)
  }
  for (const key of detailCache.keys()) {
    if (key.startsWith(`["${provider}",`)) detailCache.delete(key)
  }
}
