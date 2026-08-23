import { describe, expect, it } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute } from '../route-parser'
import { DEFAULT_NAVIGATION_STATE, parseNavigationStateKey } from '../types'

describe('route-parser: legacy automations routes', () => {
  const legacyRoutes = [
    'automations',
    'automations/scheduled',
    'automations/event',
    'automations/agentic',
    'automations/scheduled/automation/automation-1',
    'automations/automation/automation-1',
  ]

  for (const route of legacyRoutes) {
    it(`redirects "${route}" to all sessions`, () => {
      const parsed = parseCompoundRoute(route)

      expect(parsed).toEqual({
        navigator: 'sessions',
        sessionFilter: { kind: 'allSessions' },
        details: null,
      })
      expect(buildCompoundRoute(parsed!)).toBe('allSessions')
    })
  }

  it('redirects persisted automation navigation keys to the default state', () => {
    expect(parseNavigationStateKey('automations')).toEqual(DEFAULT_NAVIGATION_STATE)
    expect(parseNavigationStateKey('automations/automation/automation-1')).toEqual(DEFAULT_NAVIGATION_STATE)
  })
})
