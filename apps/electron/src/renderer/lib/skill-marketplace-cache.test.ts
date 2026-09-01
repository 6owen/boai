import { afterEach, describe, expect, it } from 'bun:test'
import type { SkillMarketplaceListRequest, SkillMarketplaceListResult } from '../../shared/types'
import {
  getCachedSkillMarketplaceSequence,
  invalidateSkillMarketplaceProvider,
  loadSkillMarketplacePage,
} from './skill-marketplace-cache'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

function setListHandler(
  handler: (request: SkillMarketplaceListRequest) => Promise<SkillMarketplaceListResult>,
): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { electronAPI: { listSkillMarketplace: handler } },
  })
}

afterEach(() => {
  invalidateSkillMarketplaceProvider('skills-sh')
  invalidateSkillMarketplaceProvider('clawhub')
  invalidateSkillMarketplaceProvider('skillhub')
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('Skill marketplace renderer cache', () => {
  it('deduplicates requests, restores cached pages, and invalidates by provider', async () => {
    let calls = 0
    setListHandler(async request => {
      calls += 1
      const page = request.page ?? 0
      return {
        items: [{
          id: `owner/repo/skill-${page}`,
          provider: 'skills-sh',
          slug: `skill-${page}`,
          name: `Skill ${page}`,
          homepage: `https://skills.sh/owner/repo/skill-${page}`,
        }],
        hasMore: page === 0,
        nextPage: page === 0 ? 1 : undefined,
      }
    })

    const baseRequest: SkillMarketplaceListRequest = {
      provider: 'skills-sh',
      sort: 'all-time',
      limit: 40,
    }
    await Promise.all([
      loadSkillMarketplacePage({ ...baseRequest, page: 0 }),
      loadSkillMarketplacePage({ ...baseRequest, page: 0 }),
    ])
    expect(calls).toBe(1)

    await loadSkillMarketplacePage({ ...baseRequest, page: 1 })
    expect(getCachedSkillMarketplaceSequence(baseRequest)?.items.map(item => item.slug))
      .toEqual(['skill-0', 'skill-1'])

    await loadSkillMarketplacePage({ ...baseRequest, page: 0 })
    expect(calls).toBe(2)

    invalidateSkillMarketplaceProvider('skills-sh')
    await loadSkillMarketplacePage({ ...baseRequest, page: 0 })
    expect(calls).toBe(3)
  })
})
