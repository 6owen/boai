import * as React from 'react'
import type { LoadedSkill } from '../../shared/types'
import * as storage from '@/lib/local-storage'

const SKILL_FAVORITES_CHANGED_EVENT = 'craft:skill-favorites-changed'

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

  const reload = React.useCallback(() => {
    setFavoriteKeys(workspaceId ? getStoredFavoriteSkillKeys(workspaceId) : new Set())
    setExcludedOwnSkillKeys(workspaceId ? getStoredExcludedOwnSkillKeys(workspaceId) : new Set())
  }, [workspaceId])

  React.useEffect(() => {
    reload()
  }, [reload])

  React.useEffect(() => {
    const handleChanged = (event: Event) => {
      const detail = (event as CustomEvent<SkillFavoritesChangedDetail>).detail
      if (detail?.workspaceId === workspaceId) reload()
    }
    window.addEventListener(SKILL_FAVORITES_CHANGED_EVENT, handleChanged)
    return () => window.removeEventListener(SKILL_FAVORITES_CHANGED_EVENT, handleChanged)
  }, [reload, workspaceId])

  const toggleFavorite = React.useCallback((skill: Pick<LoadedSkill, 'slug' | 'source'>) => {
    if (!workspaceId) return

    const key = getSkillCollectionKey(skill)
    if (isSelfAuthoredSkill(skill)) {
      const next = getStoredExcludedOwnSkillKeys(workspaceId)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      storage.set(storage.KEYS.skillOwnExclusions, [...next], workspaceId)
    } else {
      const next = getStoredFavoriteSkillKeys(workspaceId)
      if (next.has(key)) next.delete(key)
      else next.add(key)

      storage.set(storage.KEYS.skillFavorites, [...next], workspaceId)
    }
    window.dispatchEvent(new CustomEvent<SkillFavoritesChangedDetail>(SKILL_FAVORITES_CHANGED_EVENT, {
      detail: { workspaceId },
    }))
  }, [workspaceId])

  const addToOwn = React.useCallback((skill: Pick<LoadedSkill, 'slug' | 'source'>) => {
    if (!workspaceId) return

    const next = addSkillToOwnCollectionState(
      skill,
      getStoredFavoriteSkillKeys(workspaceId),
      getStoredExcludedOwnSkillKeys(workspaceId),
    )
    storage.set(storage.KEYS.skillFavorites, [...next.favoriteKeys], workspaceId)
    storage.set(storage.KEYS.skillOwnExclusions, [...next.excludedOwnSkillKeys], workspaceId)
    window.dispatchEvent(new CustomEvent<SkillFavoritesChangedDetail>(SKILL_FAVORITES_CHANGED_EVENT, {
      detail: { workspaceId },
    }))
  }, [workspaceId])

  return { favoriteKeys, excludedOwnSkillKeys, toggleFavorite, addToOwn }
}
