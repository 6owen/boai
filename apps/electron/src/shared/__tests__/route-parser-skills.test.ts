import { describe, expect, it } from 'bun:test'
import { buildCompoundRoute, buildRouteFromNavigationState, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('route-parser: skill collection routes', () => {
  it('parses installed and own list routes', () => {
    expect(parseCompoundRoute('skills/installed')).toEqual({
      navigator: 'skills',
      skillFilter: { kind: 'collection', collection: 'installed' },
      details: null,
    })
    expect(parseCompoundRoute('skills/own')).toEqual({
      navigator: 'skills',
      skillFilter: { kind: 'collection', collection: 'own' },
      details: null,
    })
  })

  it('preserves collection when opening a skill detail', () => {
    const state = parseRouteToNavigationState('skills/own/skill/my-skill')
    expect(state).toEqual({
      navigator: 'skills',
      filter: { kind: 'collection', collection: 'own' },
      details: { type: 'skill', skillSlug: 'my-skill' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('skills/own/skill/my-skill')
  })

  it('builds collection routes and keeps legacy skills routes compatible', () => {
    expect(buildCompoundRoute({
      navigator: 'skills',
      skillFilter: { kind: 'collection', collection: 'installed' },
      details: { type: 'skill', id: 'one' },
    })).toBe('skills/installed/skill/one')
    expect(parseRouteToNavigationState('skills/skill/legacy')).toEqual({
      navigator: 'skills',
      filter: undefined,
      details: { type: 'skill', skillSlug: 'legacy' },
    })
  })

  it('round-trips navigation keys with collection context', () => {
    const state = {
      navigator: 'skills' as const,
      filter: { kind: 'collection' as const, collection: 'own' as const },
      details: { type: 'skill' as const, skillSlug: 'saved' },
    }
    const key = getNavigationStateKey(state)
    expect(key).toBe('skills/own/skill/saved')
    expect(parseNavigationStateKey(key)).toEqual(state)
  })

  it('treats statistics as a dedicated skills view instead of a collection', () => {
    expect(routes.view.skillsStats()).toBe('skills/stats')
    expect(parseCompoundRoute('skills/stats')).toEqual({
      navigator: 'skills',
      skillViewMode: 'stats',
      details: null,
    })

    const state = parseRouteToNavigationState('skills/stats')
    expect(state).toEqual({
      navigator: 'skills',
      viewMode: 'stats',
      details: null,
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('skills/stats')
  })

  it('round-trips the statistics navigation key', () => {
    const state = {
      navigator: 'skills' as const,
      viewMode: 'stats' as const,
      details: null,
    }
    const key = getNavigationStateKey(state)
    expect(key).toBe('skills/stats')
    expect(parseNavigationStateKey(key)).toEqual(state)
  })

  it('rejects skill details nested under the statistics view', () => {
    expect(parseCompoundRoute('skills/stats/skill/not-valid')).toBeNull()
  })
})
