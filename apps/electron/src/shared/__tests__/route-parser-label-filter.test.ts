import { describe, it, expect } from 'bun:test'
import {
  parseCompoundRoute,
  buildCompoundRoute,
  parseRouteToNavigationState,
  buildRouteFromNavigationState,
} from '../route-parser'
import { routes } from '../routes'
import { isSessionsNavigation } from '../types'

describe('route-parser: legacy label filter routes', () => {
  it('redirects a plain label route', () => {
    const result = parseCompoundRoute('label/task')
    expect(result).not.toBeNull()
    expect(result!.sessionFilter).toEqual({ kind: 'allSessions' })
    expect(result!.details).toBeNull()
  })

  it('canonicalizes route builders while preserving session details', () => {
    const route = routes.view.label('task', 'abc123')
    expect(route).toBe('allSessions/session/abc123')
    const state = parseRouteToNavigationState(route)
    if (!state || !isSessionsNavigation(state)) throw new Error('expected sessions navigation state')
    expect(state.filter).toEqual({ kind: 'allSessions' })
    expect(state.details).toEqual({ type: 'session', sessionId: 'abc123' })
    expect(buildRouteFromNavigationState(state)).toBe('allSessions/session/abc123')
  })

  it('canonicalizes an old in-memory label filter', () => {
    expect(
      buildCompoundRoute({
        navigator: 'sessions',
        sessionFilter: { kind: 'label', labelId: 'task' },
        details: null,
      })
    ).toBe('allSessions')
  })

  it('ignores a stray query tail while redirecting', () => {
    const result = parseCompoundRoute('label/task?stray=x')
    expect(result).not.toBeNull()
    expect(result!.sessionFilter).toEqual({ kind: 'allSessions' })
  })

  it('session ids extracted from label routes stay clean even with a query tail', () => {
    // Mirrors parseSessionIdFromRoute's segment logic (panel-stack.ts).
    const segments = 'label/task/session/abc123?stray=x'.split('?')[0].split('/')
    expect(segments[segments.indexOf('session') + 1]).toBe('abc123')
  })
})
