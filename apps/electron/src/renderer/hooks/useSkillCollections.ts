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

/** Workspace skills are authored inside Craft and therefore always belong to “Own”. */
export function isSelfAuthoredSkill(skill: Pick<LoadedSkill, 'source'>): boolean {
  return skill.source === 'workspace'
}

export function getStoredFavoriteSkillKeys(workspaceId: string): Set<string> {
  return new Set(storage.get<string[]>(storage.KEYS.skillFavorites, [], workspaceId))
}

export function isSkillInOwnCollection(
  skill: Pick<LoadedSkill, 'slug' | 'source'>,
  favoriteKeys: ReadonlySet<string>,
): boolean {
  return isSelfAuthoredSkill(skill) || favoriteKeys.has(getSkillCollectionKey(skill))
}

export function useSkillFavorites(workspaceId?: string) {
  const [favoriteKeys, setFavoriteKeys] = React.useState<Set<string>>(() =>
    workspaceId ? getStoredFavoriteSkillKeys(workspaceId) : new Set(),
  )

  const reload = React.useCallback(() => {
    setFavoriteKeys(workspaceId ? getStoredFavoriteSkillKeys(workspaceId) : new Set())
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
    if (!workspaceId || isSelfAuthoredSkill(skill)) return

    const next = getStoredFavoriteSkillKeys(workspaceId)
    const key = getSkillCollectionKey(skill)
    if (next.has(key)) next.delete(key)
    else next.add(key)

    storage.set(storage.KEYS.skillFavorites, [...next], workspaceId)
    window.dispatchEvent(new CustomEvent<SkillFavoritesChangedDetail>(SKILL_FAVORITES_CHANGED_EVENT, {
      detail: { workspaceId },
    }))
  }, [workspaceId])

  return { favoriteKeys, toggleFavorite }
}
