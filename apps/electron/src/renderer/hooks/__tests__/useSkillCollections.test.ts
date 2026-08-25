import { describe, expect, it } from 'bun:test'
import {
  addSkillGroup,
  addSkillToOwnCollectionState,
  assignSkillGroup,
  getSkillCollectionKey,
  isSelfAuthoredSkill,
  isSkillInOwnCollection,
  removeSkillGroup,
  reorderSkillGroups,
  renameSkillGroup,
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

  it('creates and renames lightweight skill groups without duplicates', () => {
    const created = addSkillGroup([], '  写文章  ', 'writing')
    expect(created).toEqual([{ id: 'writing', name: '写文章' }])
    expect(addSkillGroup(created, '写文章', 'duplicate')).toEqual(created)
    expect(renameSkillGroup(created, 'writing', ' 内容创作 ')).toEqual([
      { id: 'writing', name: '内容创作' },
    ])
  })

  it('moves a skill between a group and ungrouped', () => {
    const key = getSkillCollectionKey(globalSkill)
    const grouped = assignSkillGroup({}, key, 'coding')
    expect(grouped).toEqual({ [key]: 'coding' })
    expect(assignSkillGroup(grouped, key)).toEqual({})
  })

  it('returns grouped skills to ungrouped when deleting a group', () => {
    const key = getSkillCollectionKey(globalSkill)
    const result = removeSkillGroup(
      [{ id: 'coding', name: '写代码' }, { id: 'writing', name: '写文章' }],
      { [key]: 'coding' },
      'coding',
    )
    expect(result).toEqual({
      groups: [{ id: 'writing', name: '写文章' }],
      assignments: {},
    })
  })

  it('reorders skill groups while preserving their contents', () => {
    const groups = [
      { id: 'mine', name: '我的' },
      { id: 'development', name: '开发' },
      { id: 'docs', name: '文档' },
    ]

    expect(reorderSkillGroups(groups, 'docs', 'mine')).toEqual([
      { id: 'docs', name: '文档' },
      { id: 'mine', name: '我的' },
      { id: 'development', name: '开发' },
    ])
    expect(reorderSkillGroups(groups, 'missing', 'mine')).toEqual(groups)
  })
})
