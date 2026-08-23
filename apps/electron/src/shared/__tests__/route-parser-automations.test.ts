import { describe, expect, it } from 'bun:test'
import { parseCompoundRoute, buildCompoundRoute } from '../route-parser'

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
})
