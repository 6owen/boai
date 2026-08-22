import { describe, expect, it } from 'bun:test'
import type { SkillInstallPlan, SkillPlacement } from '@craft-agent/shared/skills'
import { filterSkillPlacements, requiresOverwriteConfirmation } from '../skills-manager-model'

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
})
