import { describe, expect, it } from 'bun:test'
import type { SkillsNavigationState } from '../../../shared/types'
import { isDetailNavState } from '../nav-helpers'

describe('isDetailNavState skills navigation', () => {
  it('treats statistics as content in compact mode', () => {
    const statsState: SkillsNavigationState = {
      navigator: 'skills',
      details: null,
      viewMode: 'stats',
    }

    expect(isDetailNavState(statsState)).toBe(true)
  })

  it('keeps the skill collection in navigator mode', () => {
    const listState: SkillsNavigationState = {
      navigator: 'skills',
      details: null,
    }

    expect(isDetailNavState(listState)).toBe(false)
  })

  it('keeps an individual skill in content mode', () => {
    const detailState: SkillsNavigationState = {
      navigator: 'skills',
      details: { type: 'skill', skillSlug: 'example-skill' },
    }

    expect(isDetailNavState(detailState)).toBe(true)
  })
})
