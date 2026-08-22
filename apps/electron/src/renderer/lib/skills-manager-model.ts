import type { SkillInstallPlan, SkillOrigin, SkillPlacement } from '@craft-agent/shared/skills'

export type SkillInventoryFilter = 'all' | 'managed' | 'external' | 'invalid' | 'missing' | 'modified' | 'conflict'

export function formatSkillOriginSource(origin?: SkillOrigin): string {
  if (!origin) return ''
  if (origin.type === 'git') return `${origin.url}${origin.ref ? `#${origin.ref}` : ''}`
  if (origin.type === 'registry') return `npm:${origin.package}${origin.version ? `@${origin.version}` : ''}`
  if (origin.type === 'local') return origin.path
  return ''
}

export function parseSkillOriginInput(input: string): SkillOrigin {
  const value = input.trim()
  if (!value) return { type: 'unknown' }
  if (value.startsWith('npm:')) {
    const spec = value.slice(4)
    const versionAt = spec.lastIndexOf('@')
    return {
      type: 'registry',
      package: versionAt > 0 ? spec.slice(0, versionAt) : spec,
      version: versionAt > 0 ? spec.slice(versionAt + 1) : undefined,
    }
  }
  if (/^(https?:\/\/|ssh:\/\/|git@|[\w.-]+\/[\w.-]+)/.test(value)) {
    const hashAt = value.lastIndexOf('#')
    return {
      type: 'git',
      url: hashAt >= 0 ? value.slice(0, hashAt) : value,
      ref: hashAt >= 0 ? value.slice(hashAt + 1) : undefined,
    }
  }
  return { type: 'local', path: value }
}

export function formatCommandPreview(command: { executable: string; args: string[] }): string {
  return [command.executable, ...command.args]
    .map(value => /^[a-zA-Z0-9_./:@#=-]+$/.test(value) ? value : JSON.stringify(value))
    .join(' ')
}

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
      || (filter === 'missing' && item.status === 'missing')
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
