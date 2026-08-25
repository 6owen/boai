import * as React from 'react'
import type { LoadedSkill } from '../../shared/types'
import * as storage from '@/lib/local-storage'

const SKILL_COLLECTIONS_CHANGED_EVENT = 'craft:skill-favorites-changed'

export interface SkillGroup {
  id: string
  name: string
}

export type SkillGroupAssignments = Record<string, string>

type SkillFavoritesChangedDetail = {
  workspaceId: string
}

export function getSkillCollectionKey(skill: Pick<LoadedSkill, 'slug' | 'source'>): string {
  return `${skill.source}:${skill.slug}`
}

/** Workspace skills are authored inside BoAI and therefore always belong to “Own”. */
export function isSelfAuthoredSkill(skill: Pick<LoadedSkill, 'source'>): boolean {
  return skill.source === 'workspace'
}

export function getStoredFavoriteSkillKeys(workspaceId: string): Set<string> {
  return new Set(storage.get<string[]>(storage.KEYS.skillFavorites, [], workspaceId))
}

export function getStoredExcludedOwnSkillKeys(workspaceId: string): Set<string> {
  return new Set(storage.get<string[]>(storage.KEYS.skillOwnExclusions, [], workspaceId))
}

export function getStoredSkillGroups(workspaceId: string): SkillGroup[] {
  const stored = storage.get<unknown>(storage.KEYS.skillGroups, [], workspaceId)
  if (!Array.isArray(stored)) return []
  const seen = new Set<string>()
  return stored.flatMap((value) => {
    if (!value || typeof value !== 'object') return []
    const candidate = value as Partial<SkillGroup>
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : ''
    const name = typeof candidate.name === 'string' ? candidate.name.trim() : ''
    if (!id || !name || seen.has(id)) return []
    seen.add(id)
    return [{ id, name }]
  })
}

export function getStoredSkillGroupAssignments(workspaceId: string): SkillGroupAssignments {
  const stored = storage.get<unknown>(storage.KEYS.skillGroupAssignments, {}, workspaceId)
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(Object.entries(stored)
    .filter((entry): entry is [string, string] => (
      typeof entry[0] === 'string'
      && Boolean(entry[0])
      && typeof entry[1] === 'string'
      && Boolean(entry[1])
    )))
}

export function normalizeSkillGroupName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').slice(0, 40)
}

export function addSkillGroup(
  groups: readonly SkillGroup[],
  name: string,
  id: string,
): SkillGroup[] {
  const normalizedName = normalizeSkillGroupName(name)
  if (!normalizedName || groups.some(group => group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())) {
    return [...groups]
  }
  return [...groups, { id, name: normalizedName }]
}

export function renameSkillGroup(
  groups: readonly SkillGroup[],
  groupId: string,
  name: string,
): SkillGroup[] {
  const normalizedName = normalizeSkillGroupName(name)
  if (!normalizedName || groups.some(group => (
    group.id !== groupId
    && group.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase()
  ))) return [...groups]
  return groups.map(group => group.id === groupId ? { ...group, name: normalizedName } : group)
}

export function removeSkillGroup(
  groups: readonly SkillGroup[],
  assignments: Readonly<SkillGroupAssignments>,
  groupId: string,
): { groups: SkillGroup[]; assignments: SkillGroupAssignments } {
  return {
    groups: groups.filter(group => group.id !== groupId),
    assignments: Object.fromEntries(
      Object.entries(assignments).filter(([, assignedGroupId]) => assignedGroupId !== groupId),
    ),
  }
}

export function reorderSkillGroups(
  groups: readonly SkillGroup[],
  groupId: string,
  targetGroupId: string,
): SkillGroup[] {
  const fromIndex = groups.findIndex(group => group.id === groupId)
  const toIndex = groups.findIndex(group => group.id === targetGroupId)
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [...groups]

  const next = [...groups]
  const [movedGroup] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, movedGroup)
  return next
}

export function assignSkillGroup(
  assignments: Readonly<SkillGroupAssignments>,
  skillKey: string,
  groupId?: string,
): SkillGroupAssignments {
  const next = { ...assignments }
  if (groupId) next[skillKey] = groupId
  else delete next[skillKey]
  return next
}

export function isSkillInOwnCollection(
  skill: Pick<LoadedSkill, 'slug' | 'source'>,
  favoriteKeys: ReadonlySet<string>,
  excludedOwnSkillKeys: ReadonlySet<string> = new Set(),
): boolean {
  const key = getSkillCollectionKey(skill)
  return isSelfAuthoredSkill(skill)
    ? !excludedOwnSkillKeys.has(key)
    : favoriteKeys.has(key)
}

export function addSkillToOwnCollectionState(
  skill: Pick<LoadedSkill, 'slug' | 'source'>,
  favoriteKeys: ReadonlySet<string>,
  excludedOwnSkillKeys: ReadonlySet<string>,
): { favoriteKeys: Set<string>; excludedOwnSkillKeys: Set<string> } {
  const nextFavoriteKeys = new Set(favoriteKeys)
  const nextExcludedOwnSkillKeys = new Set(excludedOwnSkillKeys)
  const key = getSkillCollectionKey(skill)

  if (isSelfAuthoredSkill(skill)) nextExcludedOwnSkillKeys.delete(key)
  else nextFavoriteKeys.add(key)

  return {
    favoriteKeys: nextFavoriteKeys,
    excludedOwnSkillKeys: nextExcludedOwnSkillKeys,
  }
}

export function useSkillFavorites(workspaceId?: string) {
  const [favoriteKeys, setFavoriteKeys] = React.useState<Set<string>>(() =>
    workspaceId ? getStoredFavoriteSkillKeys(workspaceId) : new Set(),
  )
  const [excludedOwnSkillKeys, setExcludedOwnSkillKeys] = React.useState<Set<string>>(() =>
    workspaceId ? getStoredExcludedOwnSkillKeys(workspaceId) : new Set(),
  )
  const [groups, setGroups] = React.useState<SkillGroup[]>(() =>
    workspaceId ? getStoredSkillGroups(workspaceId) : [],
  )
  const [groupAssignments, setGroupAssignments] = React.useState<SkillGroupAssignments>(() =>
    workspaceId ? getStoredSkillGroupAssignments(workspaceId) : {},
  )

  const reload = React.useCallback(() => {
    setFavoriteKeys(workspaceId ? getStoredFavoriteSkillKeys(workspaceId) : new Set())
    setExcludedOwnSkillKeys(workspaceId ? getStoredExcludedOwnSkillKeys(workspaceId) : new Set())
    setGroups(workspaceId ? getStoredSkillGroups(workspaceId) : [])
    setGroupAssignments(workspaceId ? getStoredSkillGroupAssignments(workspaceId) : {})
  }, [workspaceId])

  React.useEffect(() => {
    reload()
  }, [reload])

  React.useEffect(() => {
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<SkillFavoritesChangedDetail>).detail
      if (detail?.workspaceId === workspaceId) reload()
    }
    window.addEventListener(SKILL_COLLECTIONS_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(SKILL_COLLECTIONS_CHANGED_EVENT, handleChanged)
  }, [reload, workspaceId])

  const notifyChanged = React.useCallback(() => {
    if (!workspaceId) return
    window.dispatchEvent(new CustomEvent<SkillFavoritesChangedDetail>(SKILL_COLLECTIONS_CHANGED_EVENT, {
      detail: { workspaceId },
    }))
  }, [workspaceId])

  const toggleFavorite = React.useCallback((skill: Pick<LoadedSkill, 'slug' | 'source'>) => {
    if (!workspaceId) return

    const key = getSkillCollectionKey(skill)
    const favoriteKeys = getStoredFavoriteSkillKeys(workspaceId)
    const excludedOwnSkillKeys = getStoredExcludedOwnSkillKeys(workspaceId)
    const wasInOwn = isSkillInOwnCollection(skill, favoriteKeys, excludedOwnSkillKeys)
    if (isSelfAuthoredSkill(skill)) {
      const next = excludedOwnSkillKeys
      if (next.has(key)) next.delete(key)
      else next.add(key)
      storage.set(storage.KEYS.skillOwnExclusions, [...next], workspaceId)
    } else {
      const next = favoriteKeys
      if (next.has(key)) next.delete(key)
      else next.add(key)

      storage.set(storage.KEYS.skillFavorites, [...next], workspaceId)
    }
    if (wasInOwn) {
      storage.set(
        storage.KEYS.skillGroupAssignments,
        assignSkillGroup(getStoredSkillGroupAssignments(workspaceId), key),
        workspaceId,
      )
    }
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const addToOwn = React.useCallback((skill: Pick<LoadedSkill, 'slug' | 'source'>) => {
    if (!workspaceId) return

    const next = addSkillToOwnCollectionState(
      skill,
      getStoredFavoriteSkillKeys(workspaceId),
      getStoredExcludedOwnSkillKeys(workspaceId),
    )
    storage.set(storage.KEYS.skillFavorites, [...next.favoriteKeys], workspaceId)
    storage.set(storage.KEYS.skillOwnExclusions, [...next.excludedOwnSkillKeys], workspaceId)
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const createGroup = React.useCallback((name: string) => {
    if (!workspaceId) return
    const current = getStoredSkillGroups(workspaceId)
    const next = addSkillGroup(current, name, crypto.randomUUID())
    if (next.length === current.length) return
    storage.set(storage.KEYS.skillGroups, next, workspaceId)
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const renameGroup = React.useCallback((groupId: string, name: string) => {
    if (!workspaceId) return
    const current = getStoredSkillGroups(workspaceId)
    const next = renameSkillGroup(current, groupId, name)
    if (next.every((group, index) => group.name === current[index]?.name)) return
    storage.set(storage.KEYS.skillGroups, next, workspaceId)
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const deleteGroup = React.useCallback((groupId: string) => {
    if (!workspaceId) return
    const next = removeSkillGroup(
      getStoredSkillGroups(workspaceId),
      getStoredSkillGroupAssignments(workspaceId),
      groupId,
    )
    storage.set(storage.KEYS.skillGroups, next.groups, workspaceId)
    storage.set(storage.KEYS.skillGroupAssignments, next.assignments, workspaceId)
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const reorderGroups = React.useCallback((groupId: string, targetGroupId: string) => {
    if (!workspaceId) return
    const current = getStoredSkillGroups(workspaceId)
    const next = reorderSkillGroups(current, groupId, targetGroupId)
    if (next.every((group, index) => group.id === current[index]?.id)) return
    storage.set(storage.KEYS.skillGroups, next, workspaceId)
    notifyChanged()
  }, [notifyChanged, workspaceId])

  const setSkillGroup = React.useCallback((
    skill: Pick<LoadedSkill, 'slug' | 'source'>,
    groupId?: string,
  ) => {
    if (!workspaceId) return
    const validGroupId = groupId && getStoredSkillGroups(workspaceId).some(group => group.id === groupId)
      ? groupId
      : undefined
    storage.set(
      storage.KEYS.skillGroupAssignments,
      assignSkillGroup(
        getStoredSkillGroupAssignments(workspaceId),
        getSkillCollectionKey(skill),
        validGroupId,
      ),
      workspaceId,
    )
    notifyChanged()
  }, [notifyChanged, workspaceId])

  return {
    favoriteKeys,
    excludedOwnSkillKeys,
    groups,
    groupAssignments,
    toggleFavorite,
    addToOwn,
    createGroup,
    renameGroup,
    deleteGroup,
    reorderGroups,
    setSkillGroup,
  }
}
