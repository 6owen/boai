import { describe, expect, it } from 'bun:test'
import type { SkillInstallPlan, SkillPlacement } from '@craft-agent/shared/skills'
import { filterSkillPlacements, formatCommandPreview, formatSkillOriginSource, parseSkillOriginInput, requiresOverwriteConfirmation } from '../skills-manager-model'

function placement(overrides: Partial<SkillPlacement> = {}): SkillPlacement {
  return {
    id: 'workspace:/skills/review', slug: 'review', source: 'workspace', path: '/skills/review',
    status: 'valid', diagnostics: [], effective: true, shadowed: false, conflict: false,
    ownership: 'managed',
    skill: { slug: 'review', source: 'workspace', path: '/skills/review', metadata: { name: 'Code Review', description: 'Review changes' }, content: 'Body' },
    record: {
      id: 'record', slug: 'review', placementId: 'workspace:/skills/review', baselineHash: 'hash',
      origin: { type: 'git', url: 'owner/repository' }, managedAt: 1, updatedAt: 1, tags: ['work'],
    },
    ...overrides,
  }
}

describe('Skills Manager view model', () => {
  it('filters complete placements by ownership and state', () => {
    const items = [
      placement(),
      placement({ id: 'global:/invalid', slug: 'broken', status: 'invalid', ownership: 'external', conflict: true, skill: undefined }),
    ]
    expect(filterSkillPlacements(items, 'external', '')).toHaveLength(1)
    expect(filterSkillPlacements(items, 'invalid', '')[0]?.slug).toBe('broken')
    expect(filterSkillPlacements(items, 'conflict', '')[0]?.slug).toBe('broken')
    expect(filterSkillPlacements([
      placement({ id: 'workspace:/missing', status: 'missing', skill: undefined }),
    ], 'missing', '')).toHaveLength(1)
  })

  it('searches name, provenance, tags, scope, and path', () => {
    const item = placement()
    for (const query of ['Code Review', 'owner/repository', 'work', 'workspace', '/skills/review']) {
      expect(filterSkillPlacements([item], 'all', query)).toHaveLength(1)
    }
  })

  it('requires explicit overwrite only for local divergence', () => {
    const plan = { valid: true, localModified: true } as SkillInstallPlan
    expect(requiresOverwriteConfirmation(plan)).toBe(true)
    expect(requiresOverwriteConfirmation({ ...plan, localModified: false })).toBe(false)
  })

  it('round-trips stored Git refs and registry versions into update sources', () => {
    expect(formatSkillOriginSource({ type: 'git', url: 'owner/repository', ref: 'release-1' }))
      .toBe('owner/repository#release-1')
    expect(formatSkillOriginSource({ type: 'registry', package: '@scope/skill', version: '2.0.0' }))
      .toBe('npm:@scope/skill@2.0.0')
    expect(parseSkillOriginInput('owner/repository#release-1')).toEqual({
      type: 'git', url: 'owner/repository', ref: 'release-1',
    })
    expect(parseSkillOriginInput('npm:@scope/skill@2.0.0')).toEqual({
      type: 'registry', package: '@scope/skill', version: '2.0.0',
    })
  })

  it('renders the adapter-owned command without losing argument boundaries', () => {
    expect(formatCommandPreview({ executable: 'npx', args: ['skills', 'add', 'path with spaces'] }))
      .toBe('npx skills add "path with spaces"')
  })
})
