import { describe, expect, it } from 'bun:test'
import { getSkillMarketplaceDetail, listSkillMarketplace } from './skill-marketplace'

type FetchInput = Parameters<typeof fetch>[0]

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

describe('Skill marketplace provider adapters', () => {
  it('loads the native paginated skills.sh leaderboard view', async () => {
    const fetchImpl = (async (input: FetchInput) => {
      expect(String(input)).toBe('https://skills.sh/api/skills/trending/2')
      return jsonResponse({
        skills: [
          { skillId: 'alpha', source: 'owner/repo', installs: 20, isOfficial: true },
          { skillId: 'beta', source: 'owner/repo', installs: 10 },
        ],
        page: 2,
        total: 450,
        hasMore: true,
      })
    }) as typeof fetch

    const result = await listSkillMarketplace(
      { provider: 'skills-sh', sort: 'trending', page: 2 },
      fetchImpl,
    )

    expect(result.items.map(item => item.id)).toEqual(['owner/repo/alpha', 'owner/repo/beta'])
    expect(result.items[0]?.verified).toBe(true)
    expect(result.items[0]?.install).toEqual({ kind: 'git', source: 'owner/repo', slug: 'alpha' })
    expect(result).toMatchObject({ total: 450, hasMore: true, nextPage: 3 })
  })

  it('forwards ClawHub cursors for infinite loading', async () => {
    const fetchImpl = (async (input: FetchInput) => {
      const url = new URL(String(input))
      expect(url.searchParams.get('cursor')).toBe('next-page')
      return jsonResponse({
        items: [{ slug: 'second-page', displayName: 'Second page' }],
        nextCursor: 'third-page',
      })
    }) as typeof fetch

    const result = await listSkillMarketplace(
      { provider: 'clawhub', cursor: 'next-page', limit: 40 },
      fetchImpl,
    )

    expect(result.items[0]?.slug).toBe('second-page')
    expect(result).toMatchObject({ hasMore: true, nextCursor: 'third-page' })
  })

  it('resolves a ClawHub owner before building its detail and download target', async () => {
    const fetchImpl = (async (input: FetchInput) => {
      const url = new URL(String(input))
      if (url.pathname === '/api/v1/search') {
        return jsonResponse({
          results: [{
            slug: 'self-improving-agent',
            ownerHandle: 'pskoett',
            displayName: 'Self-improving agent',
            downloads: 18_000,
          }],
        })
      }
      expect(url.searchParams.get('ownerHandle')).toBe('pskoett')
      return jsonResponse({
        skill: {
          slug: 'self-improving-agent',
          displayName: 'Self-improving agent',
          description: '# Skill content',
          stats: { downloads: 18_000 },
        },
        owner: { handle: 'pskoett' },
        latestVersion: { version: '4.0.2' },
      })
    }) as typeof fetch

    const item = await getSkillMarketplaceDetail(
      { provider: 'clawhub', id: 'self-improving-agent' },
      fetchImpl,
    )

    expect(item.owner).toBe('pskoett')
    expect(item.content).toBe('# Skill content')
    expect(item.install?.source).toContain('ownerHandle=pskoett')
  })

  it('loads Tencent SkillHub metadata, SKILL.md, and security reports', async () => {
    const fetchImpl = (async (input: FetchInput) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/file')) {
        expect(url.searchParams.get('path')).toBe('SKILL.md')
        return new Response('# Tencent SkillHub content', { status: 200 })
      }
      return jsonResponse({
        skill: {
          displayName: 'Useful skill',
          summary_zh: '一个有用的 Skill',
          sourceUrl: 'https://skillhub.cn/skills/useful-skill',
          stats: { downloads: 42 },
        },
        owner: { handle: 'owner', displayName: 'Owner' },
        namespace: { canonicalName: '@owner/useful-skill' },
        latestVersion: { version: '1.2.3' },
        securityReports: {
          virustotal: { status: 'benign', statusText: 'No threats found' },
        },
      })
    }) as typeof fetch

    const item = await getSkillMarketplaceDetail(
      { provider: 'skillhub', id: '@owner/useful-skill' },
      fetchImpl,
    )

    expect(item.id).toBe('@owner/useful-skill')
    expect(item.content).toBe('# Tencent SkillHub content')
    expect(item.securityReports).toEqual([
      { provider: 'virustotal', status: 'benign', statusText: 'No threats found', reportUrl: undefined },
    ])
    expect(item.install?.source).toContain('slug=useful-skill')
  })
})
