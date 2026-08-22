import type { SkillInstallPlan, SkillPlacement } from '@craft-agent/shared/skills'

export type SkillInventoryFilter = 'all' | 'managed' | 'external' | 'invalid' | 'modified' | 'conflict'

function originText(placement: SkillPlacement): string {
  const origin = placement.record?.origin
  if (!origin) return ''
  if (origin.type === 'git') return [origin.url, origin.ref, origin.commit, origin.version].filter(Boolean).join(' ')
  if (origin.type === 'registry') return [origin.package, origin.version, origin.url].filter(Boolean).join(' ')
  if (origin.type === 'local') return origin.path
  return origin.type
}

export function filterSkillPlacements(
  placements: SkillPlacement[],
  filter: SkillInventoryFilter,
  query: string,
): SkillPlacement[] {
  const normalized = query.trim().toLowerCase()
  return placements.filter(item => {
    const matchesFilter = filter === 'all'
      || (filter === 'managed' && item.ownership === 'managed')
      || (filter === 'external' && item.ownership === 'external')
      || (filter === 'invalid' && item.status === 'invalid')
      || (filter === 'modified' && !!item.modified)
      || (filter === 'conflict' && item.conflict)
    if (!matchesFilter) return false
    if (!normalized) return true
    return [
      item.slug, item.skill?.metadata.name, item.skill?.metadata.description,
      item.source, item.status, item.ownership, originText(item),
      item.record?.tags?.join(' '), item.path,
    ].some(value => value?.toLowerCase().includes(normalized))
  })
}

export function requiresOverwriteConfirmation(plan: SkillInstallPlan | null): boolean {
  return !!plan?.localModified
}
