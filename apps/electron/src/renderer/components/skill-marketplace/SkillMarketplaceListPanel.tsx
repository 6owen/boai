import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, CheckCircle2 } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { Button } from '@/components/ui/button'
import { EntityRow } from '@/components/ui/entity-row'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  getCachedSkillMarketplaceSequence,
  loadSkillMarketplacePage,
} from '@/lib/skill-marketplace-cache'
import type {
  SkillMarketplaceItem,
  SkillMarketplaceListRequest,
  SkillMarketplaceProvider,
  SkillMarketplaceSort,
} from '../../../shared/types'
import {
  SKILL_MARKETPLACE_PROVIDER_META,
  SkillMarketplaceProviderIcon,
} from './provider-meta'

const PAGE_SIZE = 40

interface SkillMarketplaceListPanelProps {
  provider: SkillMarketplaceProvider
  selectedSkillId?: string | null
  refreshKey?: number
  searchActive: boolean
  searchQuery: string
  onSearchChange: (query: string) => void
  onSearchClose: () => void
  onSkillClick: (item: SkillMarketplaceItem) => void
}

interface Continuation {
  hasMore: boolean
  nextPage?: number
  nextCursor?: string
}

function formatMetric(value: number | undefined, locale: string): string | null {
  if (value === undefined) return null
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

function mergeItems(current: SkillMarketplaceItem[], incoming: SkillMarketplaceItem[]): SkillMarketplaceItem[] {
  const seen = new Set(current.map(item => `${item.provider}:${item.id}`))
  const merged = [...current]
  for (const item of incoming) {
    const identity = `${item.provider}:${item.id}`
    if (seen.has(identity)) continue
    seen.add(identity)
    merged.push(item)
  }
  return merged
}

export function SkillMarketplaceListPanel({
  provider,
  selectedSkillId,
  refreshKey = 0,
  searchActive,
  searchQuery,
  onSearchChange,
  onSearchClose,
  onSkillClick,
}: SkillMarketplaceListPanelProps) {
  const { t, i18n } = useTranslation()
  const providerMeta = SKILL_MARKETPLACE_PROVIDER_META[provider]
  const [debouncedQuery, setDebouncedQuery] = React.useState(searchQuery.trim())
  const [sort, setSort] = React.useState<SkillMarketplaceSort>(providerMeta.sorts[0])
  const effectiveSort = providerMeta.sorts.includes(sort) ? sort : providerMeta.sorts[0]
  const [initialCache] = React.useState(() => getCachedSkillMarketplaceSequence({
    provider,
    query: debouncedQuery || undefined,
    sort: effectiveSort,
    limit: PAGE_SIZE,
  }))
  const [items, setItems] = React.useState<SkillMarketplaceItem[]>(initialCache?.items ?? [])
  const [visibleCount, setVisibleCount] = React.useState(PAGE_SIZE)
  const [total, setTotal] = React.useState<number | undefined>(initialCache?.total)
  const [continuation, setContinuation] = React.useState<Continuation>({
    hasMore: initialCache?.hasMore === true,
    nextPage: initialCache?.nextPage,
    nextCursor: initialCache?.nextCursor,
  })
  const [loading, setLoading] = React.useState(!initialCache)
  const [loadingMore, setLoadingMore] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = React.useState<string | null>(null)
  const [reloadKey, setReloadKey] = React.useState(0)
  const searchInputRef = React.useRef<HTMLInputElement>(null)
  const scrollViewportRef = React.useRef<HTMLDivElement>(null)
  const loadingMoreRef = React.useRef(false)
  const autoSelectedProviderRef = React.useRef<SkillMarketplaceProvider | null>(null)

  React.useEffect(() => {
    setSort(providerMeta.sorts[0])
    autoSelectedProviderRef.current = null
  }, [provider, providerMeta.sorts])

  React.useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 250)
    return () => window.clearTimeout(timeout)
  }, [searchQuery])

  React.useEffect(() => {
    if (searchActive) searchInputRef.current?.focus()
  }, [searchActive])

  const incompleteSearch = searchQuery.trim().length === 1
  const baseRequest = React.useMemo<SkillMarketplaceListRequest>(() => ({
    provider,
    query: debouncedQuery || undefined,
    sort: effectiveSort,
    limit: PAGE_SIZE,
  }), [debouncedQuery, effectiveSort, provider])
  const sequenceKey = React.useMemo(
    () => JSON.stringify([provider, debouncedQuery, effectiveSort, refreshKey, reloadKey]),
    [debouncedQuery, effectiveSort, provider, refreshKey, reloadKey],
  )
  const sequenceKeyRef = React.useRef(sequenceKey)
  sequenceKeyRef.current = sequenceKey

  React.useLayoutEffect(() => {
    if (scrollViewportRef.current) scrollViewportRef.current.scrollTop = 0
  }, [sequenceKey])

  React.useEffect(() => {
    if (incompleteSearch) {
      setItems([])
      setVisibleCount(PAGE_SIZE)
      setTotal(undefined)
      setContinuation({ hasMore: false })
      setLoading(false)
      setError(null)
      setLoadMoreError(null)
      return
    }

    let cancelled = false
    const cached = getCachedSkillMarketplaceSequence(baseRequest)
    if (cached) {
      setItems(cached.items)
      setVisibleCount(PAGE_SIZE)
      setTotal(cached.total)
      setContinuation({
        hasMore: cached.hasMore === true,
        nextPage: cached.nextPage,
        nextCursor: cached.nextCursor,
      })
      setLoading(false)
      setError(null)
      setLoadMoreError(null)
      return
    }

    setItems([])
    setVisibleCount(PAGE_SIZE)
    setTotal(undefined)
    setContinuation({ hasMore: false })
    setLoading(true)
    setError(null)
    setLoadMoreError(null)
    void loadSkillMarketplacePage({ ...baseRequest, page: 0 })
      .then(result => {
        if (cancelled) return
        setItems(result.items)
        setVisibleCount(PAGE_SIZE)
        setTotal(result.total)
        setContinuation({
          hasMore: result.hasMore === true,
          nextPage: result.nextPage,
          nextCursor: result.nextCursor,
        })
      })
      .catch(reason => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [baseRequest, incompleteSearch, sequenceKey])

  const loadMore = React.useCallback(async () => {
    if (loading || loadingMoreRef.current || incompleteSearch) return
    if (visibleCount < items.length) {
      setVisibleCount(current => Math.min(current + PAGE_SIZE, items.length))
      return
    }
    if (!continuation.hasMore) return
    if (continuation.nextPage === undefined && !continuation.nextCursor) return
    const activeSequenceKey = sequenceKeyRef.current
    loadingMoreRef.current = true
    setLoadingMore(true)
    setLoadMoreError(null)
    const request: SkillMarketplaceListRequest = continuation.nextCursor
      ? { ...baseRequest, page: undefined, cursor: continuation.nextCursor }
      : { ...baseRequest, page: continuation.nextPage, cursor: undefined }
    try {
      const result = await loadSkillMarketplacePage(request)
      if (sequenceKeyRef.current !== activeSequenceKey) return
      setItems(current => mergeItems(current, result.items))
      setVisibleCount(current => current + PAGE_SIZE)
      setTotal(result.total ?? total)
      setContinuation({
        hasMore: result.hasMore === true,
        nextPage: result.nextPage,
        nextCursor: result.nextCursor,
      })
    } catch (reason) {
      if (sequenceKeyRef.current === activeSequenceKey) {
        setLoadMoreError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      loadingMoreRef.current = false
      if (sequenceKeyRef.current === activeSequenceKey) setLoadingMore(false)
    }
  }, [baseRequest, continuation, incompleteSearch, items.length, loading, total, visibleCount])

  React.useEffect(() => {
    if ((visibleCount >= items.length && !continuation.hasMore) || loadMoreError) return
    const viewport = scrollViewportRef.current
    if (!viewport) return
    const check = () => {
      const { scrollTop, scrollHeight, clientHeight } = viewport
      if (scrollHeight - scrollTop - clientHeight < 240) void loadMore()
    }
    if (viewport.scrollHeight <= viewport.clientHeight) void loadMore()
    viewport.addEventListener('scroll', check, { passive: true })
    return () => viewport.removeEventListener('scroll', check)
  }, [continuation.hasMore, items.length, loadMore, loadMoreError, visibleCount])

  React.useEffect(() => {
    if (
      loading
      || selectedSkillId
      || items.length === 0
      || items[0]?.provider !== provider
      || autoSelectedProviderRef.current === provider
    ) return
    autoSelectedProviderRef.current = provider
    onSkillClick(items[0])
  }, [items, loading, onSkillClick, provider, selectedSkillId])

  const metricLabel = React.useCallback((item: SkillMarketplaceItem) => {
    const metric = item.installs && item.installs > 0
      ? item.installs
      : item.downloads ?? item.installs
    return formatMetric(metric, i18n.language)
  }, [i18n.language])

  const sortLabel = React.useCallback((option: SkillMarketplaceSort) => {
    if (provider === 'skills-sh') {
      if (option === 'all-time') return t('skillMarketplace.sort.installs')
      if (option === 'trending') return t('skillMarketplace.sort.trending24h')
      if (option === 'hot') return t('skillMarketplace.sort.hot1h')
    }
    return t(`skillMarketplace.sort.${option}`)
  }, [provider, t])
  const visibleItems = React.useMemo(() => items.slice(0, visibleCount), [items, visibleCount])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={onSearchChange}
          onSearchClose={onSearchClose}
          onKeyDown={(event) => {
            if (event.key === 'Escape') searchInputRef.current?.blur()
          }}
          isSearching={loading}
          resultCount={total ?? items.length}
          placeholder={t('skillMarketplace.searchPlaceholder')}
          inputRef={searchInputRef}
        />
      )}

      <div className="shrink-0 overflow-x-auto border-b border-border/40 px-2 py-1.5 scrollbar-hide">
        <Tabs value={effectiveSort} onValueChange={value => setSort(value as SkillMarketplaceSort)}>
          <TabsList
            aria-label={t('skillMarketplace.sortLabel')}
            className="h-7 rounded-[7px] bg-foreground/[0.045] p-0.5"
          >
            {providerMeta.sorts.map(option => (
              <TabsTrigger
                key={option}
                value={option}
                onClick={() => setSort(option)}
                className="h-6 rounded-[5px] px-2 py-0 text-xs data-[state=active]:shadow-minimal"
              >
                {sortLabel(option)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {incompleteSearch ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-sm text-muted-foreground">
          {t('skillMarketplace.minimumSearchLength')}
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner className="text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-5 text-center">
          <AlertCircle className="h-7 w-7 text-destructive" />
          <p className="text-sm font-medium">{t('skillMarketplace.loadFailed')}</p>
          <p className="line-clamp-3 text-xs text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReloadKey(value => value + 1)}>
            {t('common.retry')}
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-sm text-muted-foreground">
          {t('skillMarketplace.noResults')}
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1" viewportRef={scrollViewportRef}>
          <div className="py-1" role="listbox" aria-label={t(providerMeta.labelKey)}>
            {visibleItems.map((item, index) => {
              const metric = metricLabel(item)
              return (
                <EntityRow
                  key={`${item.provider}:${item.id}`}
                  icon={<SkillMarketplaceProviderIcon provider={provider} />}
                  title={item.name}
                  subtitle={item.source || item.owner || t(providerMeta.labelKey)}
                  titleTrailing={metric ? <span className="text-xs tabular-nums text-muted-foreground">{metric}</span> : undefined}
                  titleSuffix={item.verified ? <CheckCircle2 className="h-3.5 w-3.5 text-accent" aria-label={t('skillMarketplace.verified')} /> : undefined}
                  isSelected={selectedSkillId === item.id}
                  showSeparator={index > 0}
                  onClick={() => onSkillClick(item)}
                  buttonProps={{
                    role: 'option',
                    'aria-selected': selectedSkillId === item.id,
                    className: 'min-h-[62px]',
                  }}
                />
              )
            })}
            <div className="flex min-h-12 items-center justify-center px-3 py-2" aria-live="polite">
              {loadingMore ? (
                <Spinner className="text-muted-foreground" />
              ) : loadMoreError ? (
                <Button variant="ghost" size="sm" onClick={() => void loadMore()}>
                  {t('common.retry')}
                </Button>
              ) : null}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
