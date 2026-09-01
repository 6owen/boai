import { describe, expect, it } from 'bun:test'
import { buildRouteFromNavigationState, parseCompoundRoute, parseRouteToNavigationState } from '../route-parser'
import { routes } from '../routes'
import { getNavigationStateKey, parseNavigationStateKey } from '../types'

describe('route-parser: Skill marketplace routes', () => {
  it('builds provider list routes', () => {
    expect(routes.view.skillMarketplace('skills-sh')).toBe('skill-marketplace/skills-sh')
    expect(parseCompoundRoute('skill-marketplace/clawhub')).toEqual({
      navigator: 'skill-marketplace',
      marketplaceProvider: 'clawhub',
      details: null,
    })
  })

  it('round-trips provider skill ids that contain slashes', () => {
    const route = routes.view.skillMarketplace('skills-sh', 'vercel-labs/agent-skills/react-best-practices')
    expect(route).toBe('skill-marketplace/skills-sh/skill/vercel-labs%2Fagent-skills%2Freact-best-practices')
    const state = parseRouteToNavigationState(route)
    expect(state).toEqual({
      navigator: 'skill-marketplace',
      provider: 'skills-sh',
      details: {
        type: 'marketplace-skill',
        skillId: 'vercel-labs/agent-skills/react-best-practices',
      },
    })
    expect(state && buildRouteFromNavigationState(state)).toBe(route)
  })

  it('persists and restores marketplace navigation state', () => {
    const state = {
      navigator: 'skill-marketplace' as const,
      provider: 'skillhub' as const,
      details: { type: 'marketplace-skill' as const, skillId: '@owner/useful-skill' },
    }
    const key = getNavigationStateKey(state)
    expect(key).toBe('skill-marketplace/skillhub/skill/%40owner%2Fuseful-skill')
    expect(parseNavigationStateKey(key)).toEqual(state)
  })

  it('rejects unsupported providers', () => {
    expect(parseCompoundRoute('skill-marketplace/unknown')).toBeNull()
  })
})
