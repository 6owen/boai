import { describe, expect, test } from 'bun:test'
import type { StoredSession } from '../../sessions/types.ts'
import { aggregateSkillUsage } from '../index.ts'

const NOW = Date.UTC(2026, 7, 23, 12)
const DAY = 24 * 60 * 60 * 1000

function makeSession(
  id: string,
  messages: StoredSession['messages'],
  overrides: Partial<StoredSession> = {},
): StoredSession {
  return {
    id,
    workspaceRootPath: '/tmp/boai',
    createdAt: NOW - DAY,
    lastUsedAt: NOW - DAY,
    llmConnection: 'anthropic',
    model: 'claude-sonnet-4-5',
    messages,
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
    ...overrides,
  }
}

describe('aggregateSkillUsage', () => {
  test('counts a skill once per conversation turn across badges, raw mentions, and tool activation', () => {
    const session = makeSession('session-1', [
      {
        id: 'user-1',
        type: 'user',
        content: '[skill:workspace:commit] then [skill:commit]',
        timestamp: NOW - DAY,
        badges: [{
          type: 'skill',
          label: 'Commit',
          rawText: '[skill:workspace:commit]',
          start: 0,
          end: 24,
        }],
      },
      {
        id: 'tool-1',
        type: 'tool',
        content: '',
        timestamp: NOW - DAY + 1_000,
        turnId: 'assistant-turn-1',
        toolName: 'Skill',
        toolInput: { skill: 'workspace:commit' },
      },
      {
        id: 'user-2',
        type: 'user',
        content: '[skill:commit] create another commit',
        timestamp: NOW - 12 * 60 * 60 * 1000,
      },
    ])

    const result = aggregateSkillUsage([session], { range: 'all', now: NOW })

    expect(result.totals).toEqual({
      activations: 2,
      skills: 1,
      sessions: 1,
      agentSources: 1,
    })
    expect(result.topSkills).toEqual([{
      slug: 'commit',
      count: 2,
      sessionCount: 1,
      lastUsedAt: NOW - 12 * 60 * 60 * 1000,
    }])
  })

  test('applies 7-day and 30-day windows to activation timestamps', () => {
    const session = makeSession('session-windows', [
      {
        id: 'recent',
        type: 'user',
        content: '[skill:recent]',
        timestamp: NOW - 6 * DAY,
      },
      {
        id: 'this-month',
        type: 'user',
        content: '[skill:this-month]',
        timestamp: NOW - 20 * DAY,
      },
      {
        id: 'older',
        type: 'user',
        content: '[skill:older]',
        timestamp: NOW - 45 * DAY,
      },
    ])

    expect(aggregateSkillUsage([session], { range: '7d', now: NOW }).topSkills.map(item => item.slug))
      .toEqual(['recent'])
    expect(aggregateSkillUsage([session], { range: '30d', now: NOW }).topSkills.map(item => item.slug))
      .toEqual(['recent', 'this-month'])
    expect(aggregateSkillUsage([session], { range: 'all', now: NOW }).totals.activations)
      .toBe(3)
  })

  test('groups BoAI activations by LLM connection and model', () => {
    const sessions = [
      makeSession('anthropic-1', [{
        id: 'a1', type: 'user', content: '[skill:commit]', timestamp: NOW - DAY,
      }]),
      makeSession('anthropic-2', [
        { id: 'a2', type: 'user', content: '[skill:commit]', timestamp: NOW - DAY },
        { id: 'a3', type: 'user', content: '[skill:review]', timestamp: NOW - DAY },
      ]),
      makeSession('openai-1', [{
        id: 'o1', type: 'user', content: '[skill:review]', timestamp: NOW - DAY,
      }], {
        llmConnection: 'openai',
        model: 'gpt-5.6',
      }),
    ]

    const result = aggregateSkillUsage(sessions, { range: 'all', now: NOW })

    expect(result.scope).toBe('boai')
    expect(result.metric).toBe('requested-or-activated')
    expect(result.agentSources).toEqual([
      {
        key: 'anthropic::claude-sonnet-4-5',
        llmConnection: 'anthropic',
        model: 'claude-sonnet-4-5',
        count: 3,
        sessionCount: 2,
        skillCount: 2,
      },
      {
        key: 'openai::gpt-5.6',
        llmConnection: 'openai',
        model: 'gpt-5.6',
        count: 1,
        sessionCount: 1,
        skillCount: 1,
      },
    ])
  })

  test('allows callers to enrich Agent source names without changing usage counts', () => {
    const session = makeSession('named-source', [{
      id: 'named', type: 'user', content: '[skill:commit]', timestamp: NOW - DAY,
    }])

    const result = aggregateSkillUsage([session], {
      range: 'all',
      now: NOW,
      resolveAgentSource: current => ({
        key: `connection:${current.llmConnection}`,
        label: 'Work Anthropic',
        provider: 'anthropic',
      }),
    })

    expect(result.agentSources).toEqual([{
      key: 'connection:anthropic',
      label: 'Work Anthropic',
      provider: 'anthropic',
      llmConnection: 'anthropic',
      model: 'claude-sonnet-4-5',
      count: 1,
      sessionCount: 1,
      skillCount: 1,
    }])
  })

  test('recognizes legacy Skill tool records with qualified skill names', () => {
    const session = makeSession('legacy', [{
      id: 'legacy-tool',
      type: 'tool',
      content: '',
      timestamp: NOW - DAY,
      turnId: 'legacy-turn',
      toolName: 'Skill',
      toolInput: { skill: 'kata-code:express-modular' },
    }])

    const result = aggregateSkillUsage([session], { range: 'all', now: NOW })

    expect(result.topSkills).toEqual([{
      slug: 'express-modular',
      count: 1,
      sessionCount: 1,
      lastUsedAt: NOW - DAY,
    }])
  })

  test('keeps distinct plugin-qualified Skills when their leaf slugs collide', () => {
    const session = makeSession('plugin-identities', [
      {
        id: 'plugin-1',
        type: 'user',
        content: 'Create a starter React project',
        timestamp: NOW - DAY,
        badges: [{
          type: 'skill',
          label: 'Starter React',
          rawText: '[skill:kata-code:starter-react]',
          start: 0,
          end: 31,
        }],
      },
      {
        id: 'plugin-tool-1',
        type: 'tool',
        content: '',
        timestamp: NOW - DAY + 1_000,
        toolName: 'Skill',
        toolInput: { skill: 'other:starter-react' },
      },
      {
        id: 'plugin-2',
        type: 'user',
        content: '[skill:workspace:.agents:kata-code:starter-react]',
        timestamp: NOW - 12 * 60 * 60 * 1000,
      },
    ])

    const result = aggregateSkillUsage([session], {
      range: 'all',
      now: NOW,
      knownSkillSlugs: ['kata-code:starter-react', 'other:starter-react'],
    })

    expect(result.topSkills).toEqual([
      {
        slug: 'kata-code:starter-react',
        count: 2,
        sessionCount: 1,
        lastUsedAt: NOW - 12 * 60 * 60 * 1000,
      },
      {
        slug: 'other:starter-react',
        count: 1,
        sessionCount: 1,
        lastUsedAt: NOW - DAY + 1_000,
      },
    ])
  })

  test('uses session creation time for historical messages without timestamps', () => {
    const oldSession = makeSession('old-history', [{
      id: 'old-message',
      type: 'user',
      content: '[skill:old-history]',
    }], {
      createdAt: NOW - 45 * DAY,
      lastMessageAt: NOW - DAY,
      lastUsedAt: NOW,
    })
    const monthSession = makeSession('month-history', [{
      id: 'month-message',
      type: 'user',
      content: '[skill:month-history]',
    }], {
      createdAt: NOW - 20 * DAY,
      lastMessageAt: NOW - DAY,
      lastUsedAt: NOW,
    })

    expect(aggregateSkillUsage([oldSession, monthSession], { range: '7d', now: NOW }).totals.activations)
      .toBe(0)
    expect(aggregateSkillUsage([oldSession, monthSession], { range: '30d', now: NOW }).topSkills)
      .toEqual([{
        slug: 'month-history',
        count: 1,
        sessionCount: 1,
        lastUsedAt: NOW - 20 * DAY,
      }])
  })
})
