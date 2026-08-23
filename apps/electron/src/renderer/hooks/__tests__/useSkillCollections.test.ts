import { describe, expect, it } from 'bun:test'
import {
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

  it('only includes installed global or project skills after they are favorited', () => {
    expect(isSkillInOwnCollection(globalSkill, new Set())).toBe(false)
    expect(isSkillInOwnCollection(globalSkill, new Set([getSkillCollectionKey(globalSkill)]))).toBe(true)
  })

  it('uses source and slug as the stable favorite identity', () => {
    expect(getSkillCollectionKey(globalSkill)).toBe('global:global-skill')
  })
})
