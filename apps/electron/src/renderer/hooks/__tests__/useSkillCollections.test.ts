import { describe, expect, it } from 'bun:test'
import {
  addSkillToOwnCollectionState,
  getSkillCollectionKey,
  isSelfAuthoredSkill,
  isSkillInOwnCollection,
} from '../useSkillCollections'

describe('skill collections', () => {
  const globalSkill = { slug: 'global-skill', source: 'global' as const }
  const workspaceSkill = { slug: 'workspace-skill', source: 'workspace' as const }

  it('treats workspace-authored skills as own automatically', () => {
    expect(isSelfAuthoredSkill(workspaceSkill)).toBe(true)
    expect(isSkillInOwnCollection(workspaceSkill, new Set())).toBe(true)
  })

  it('allows a workspace-authored skill to be explicitly removed from own', () => {
    const excludedKeys = new Set([getSkillCollectionKey(workspaceSkill)])
    expect(isSkillInOwnCollection(workspaceSkill, new Set(), excludedKeys)).toBe(false)
  })

  it('only includes installed global or project skills after they are favorited', () => {
    expect(isSkillInOwnCollection(globalSkill, new Set())).toBe(false)
    expect(isSkillInOwnCollection(globalSkill, new Set([getSkillCollectionKey(globalSkill)]))).toBe(true)
  })

  it('uses source and slug as the stable favorite identity', () => {
    expect(getSkillCollectionKey(globalSkill)).toBe('global:global-skill')
  })

  it('adds an installed skill to Own without toggling it back out', () => {
    const existingFavorite = getSkillCollectionKey(globalSkill)
    const first = addSkillToOwnCollectionState(globalSkill, new Set(), new Set())
    const second = addSkillToOwnCollectionState(globalSkill, first.favoriteKeys, first.excludedOwnSkillKeys)

    expect(first.favoriteKeys).toEqual(new Set([existingFavorite]))
    expect(second.favoriteKeys).toEqual(new Set([existingFavorite]))
  })

  it('restores an excluded workspace skill to Own', () => {
    const workspaceKey = getSkillCollectionKey(workspaceSkill)
    const next = addSkillToOwnCollectionState(
      workspaceSkill,
      new Set(),
      new Set([workspaceKey]),
    )

    expect(next.excludedOwnSkillKeys).toEqual(new Set())
  })
})
