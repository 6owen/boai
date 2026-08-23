import { describe, expect, it } from 'bun:test'
import {
  buildCompoundRoute,
  buildRouteFromNavigationState,
  parseCompoundRoute,
  parseRouteToNavigationState,
} from '../route-parser'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

const legacyRoutes = [
  'flagged',
  'archived',
  'state/in-progress',
  'label/important',
  'view/recent',
  'board',
]

describe('canonical session routes', () => {
  for (const route of legacyRoutes) {
    it(`redirects legacy ${route} to all sessions`, () => {
      const parsed = parseCompoundRoute(route)
      expect(parsed).toEqual({
        navigator: 'sessions',
        sessionFilter: { kind: 'allSessions' },
        details: null,
      })
      expect(parsed && buildCompoundRoute(parsed)).toBe('allSessions')
      expect(parseRouteToNavigationState(route)).toEqual({
        navigator: 'sessions',
        filter: { kind: 'allSessions' },
        details: null,
      })
    })
  }

  it('keeps the selected session when redirecting a legacy filtered route', () => {
    const state = parseRouteToNavigationState('label/important/session/session-1')
    expect(state).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: 'session-1' },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe('allSessions/session/session-1')
  })

  it('serializes legacy in-memory filters as the canonical route and key', () => {
    const legacyState = {
      navigator: 'sessions' as const,
      filter: { kind: 'flagged' as const },
      details: null,
    }
    expect(buildRouteFromNavigationState(legacyState)).toBe('allSessions')
    expect(getNavigationStateKey(legacyState)).toBe('allSessions')
  })

  it('redirects persisted legacy filter keys while preserving a selected session', () => {
    expect(parseNavigationStateKey('state:todo')).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: null,
    })
    expect(parseNavigationStateKey('label:important/chat/session-1')).toEqual({
      navigator: 'sessions',
      filter: { kind: 'allSessions' },
      details: { type: 'session', sessionId: 'session-1' },
    })
  })
})
