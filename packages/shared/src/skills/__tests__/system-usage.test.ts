import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  aggregateSkillUsage,
  mergeSystemSkillUsage,
  parseCodexSkillUsageJsonl,
  scanCodexSkillUsage,
} from '../index.ts'
import type { StoredSession } from '../../sessions/types.ts'

const NOW = Date.UTC(2026, 7, 24, 12)
const tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseCodexSkillUsageJsonl', () => {
  test('counts one inferred activation per Codex turn and ignores catalog/output mentions', () => {
    const jsonl = [
      {
        timestamp: '2026-08-24T09:00:00.000Z',
        type: 'session_meta',
        payload: { id: 'codex-session', originator: 'Codex Desktop' },
      },
      {
        timestamp: '2026-08-24T09:01:00.000Z',
        type: 'response_item',
        payload: {
          type: 'message',
          role: 'developer',
          content: 'Available skill: /Users/test/.codex/skills/review/SKILL.md',
        },
      },
      {
        timestamp: '2026-08-24T09:02:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 'turn-1',
          item: {
            type: 'CommandExecution',
            command: "sed -n '1,240p' /Users/test/.codex/skills/review/SKILL.md",
          },
        },
      },
      {
        timestamp: '2026-08-24T09:02:01.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 'turn-1',
          item: {
            type: 'DynamicToolCall',
            arguments: {
              code: "await tools.exec_command({cmd: `cat /Users/test/.codex/skills/review/SKILL.md`})",
            },
          },
        },
      },
      {
        timestamp: '2026-08-24T10:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 'turn-2',
          item: {
            type: 'CommandExecution',
            command: 'cat /Users/test/.codex/skills/review/SKILL.md',
          },
        },
      },
      {
        timestamp: '2026-08-24T10:01:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 'turn-2',
          item: {
            type: 'CommandExecution',
            command: "rg 'SKILL.md' /Users/test/.codex/sessions",
            stdout: '/Users/test/.codex/skills/review/SKILL.md',
          },
        },
      },
    ].map(record => JSON.stringify(record)).join('\n')

    expect(parseCodexSkillUsageJsonl(jsonl, {
      knownSkillSlugs: ['review'],
    })).toEqual([
      {
        agentId: 'codex',
        agentName: 'Codex',
        confidence: 'inferred',
        sessionId: 'codex-session',
        turnId: 'turn-1',
        slug: 'review',
        timestamp: Date.UTC(2026, 7, 24, 9, 2),
      },
      {
        agentId: 'codex',
        agentName: 'Codex',
        confidence: 'inferred',
        sessionId: 'codex-session',
        turnId: 'turn-2',
        slug: 'review',
        timestamp: Date.UTC(2026, 7, 24, 10),
      },
    ])
  })
})

describe('mergeSystemSkillUsage', () => {
  test('combines BoAI and observable Agent usage without treating unavailable Agents as zero usage', () => {
    const session: StoredSession = {
      id: 'boai-session',
      workspaceRootPath: '/tmp/boai',
      createdAt: NOW,
      lastUsedAt: NOW,
      messages: [{
        id: 'message-1',
        type: 'user',
        content: '[skill:review]',
        timestamp: NOW,
      }],
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
        costUsd: 0,
      },
    }
    const boai = aggregateSkillUsage([session], {
      range: 'all',
      now: NOW,
      knownSkillSlugs: ['review', 'commit'],
    })

    const result = mergeSystemSkillUsage(boai, [{
      agentId: 'codex',
      agentName: 'Codex',
      confidence: 'inferred',
      sessionId: 'codex-session',
      turnId: 'turn-1',
      slug: 'commit',
      timestamp: NOW - 1_000,
    }], {
      installedAgents: [
        { agentId: 'codex', agentName: 'Codex' },
        { agentId: 'cursor', agentName: 'Cursor' },
      ],
      observableAgentIds: ['codex'],
      range: 'all',
      now: NOW,
    })

    expect(result.scope).toBe('system')
    expect(result.totals).toEqual({
      activations: 2,
      skills: 2,
      sessions: 2,
      agentSources: 3,
    })
    expect(result.coverage).toEqual({ detectedAgents: 3, observableAgents: 2 })
    expect(result.agentSources).toEqual([
      expect.objectContaining({
        key: 'agent:boai',
        agentId: 'boai',
        label: 'BoAI',
        availability: 'observed',
        confidence: 'exact',
        count: 1,
      }),
      expect.objectContaining({
        key: 'agent:codex',
        agentId: 'codex',
        availability: 'observed',
        confidence: 'inferred',
        count: 1,
      }),
      expect.objectContaining({
        key: 'agent:cursor',
        agentId: 'cursor',
        availability: 'unavailable',
        count: 0,
      }),
    ])
  })

  test('counts distinct external sessions for each skill', () => {
    const emptyBoai = aggregateSkillUsage([], { range: 'all', now: NOW })
    const event = (sessionId: string, turnId: string) => ({
      agentId: 'codex',
      agentName: 'Codex',
      confidence: 'inferred' as const,
      sessionId,
      turnId,
      slug: 'review',
      timestamp: NOW,
    })

    const result = mergeSystemSkillUsage(emptyBoai, [
      event('session-1', 'turn-1'),
      event('session-1', 'turn-2'),
      event('session-2', 'turn-1'),
    ], {
      installedAgents: [{ agentId: 'codex', agentName: 'Codex' }],
      observableAgentIds: ['codex'],
      range: 'all',
      now: NOW,
    })

    expect(result.topSkills[0]).toEqual({
      slug: 'review',
      count: 3,
      sessionCount: 2,
      lastUsedAt: NOW,
    })
  })
})

describe('scanCodexSkillUsage', () => {
  test('reads active and archived Codex JSONL sessions through one adapter', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'boai-codex-usage-'))
    tempDirs.push(codexHome)
    const activeDir = join(codexHome, 'sessions', '2026', '08', '24')
    const archiveDir = join(codexHome, 'archived_sessions')
    mkdirSync(activeDir, { recursive: true })
    mkdirSync(archiveDir, { recursive: true })

    const makeLog = (sessionId: string, turnId: string, slug: string) => [
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
      JSON.stringify({
        timestamp: '2026-08-24T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: turnId,
          item: {
            type: 'CommandExecution',
            command: `cat /Users/test/.codex/skills/${slug}/SKILL.md`,
          },
        },
      }),
    ].join('\n')

    writeFileSync(join(activeDir, 'active.jsonl'), makeLog('active', 'turn-a', 'review'))
    writeFileSync(join(archiveDir, 'archive.jsonl'), makeLog('archive', 'turn-b', 'commit'))

    expect(scanCodexSkillUsage({
      codexHome,
      knownSkillSlugs: ['review', 'commit'],
    }).map(event => `${event.sessionId}:${event.slug}`)).toEqual([
      'archive:commit',
      'active:review',
    ])
  })

  test('keeps the lightweight byte budget stable when cached logs are scanned again', () => {
    const codexHome = mkdtempSync(join(tmpdir(), 'boai-codex-budget-'))
    tempDirs.push(codexHome)
    const sessionsDir = join(codexHome, 'sessions')
    mkdirSync(sessionsDir, { recursive: true })
    const makeLog = (sessionId: string, slug: string) => [
      JSON.stringify({ type: 'session_meta', payload: { id: sessionId } }),
      JSON.stringify({
        timestamp: '2026-08-24T09:00:00.000Z',
        type: 'event_msg',
        payload: {
          type: 'item_completed',
          turn_id: 'turn-1',
          item: { type: 'CommandExecution', command: `cat /tmp/skills/${slug}/SKILL.md` },
        },
      }),
      ' '.repeat(1_024),
    ].join('\n')
    const older = join(sessionsDir, 'older.jsonl')
    const newer = join(sessionsDir, 'newer.jsonl')
    writeFileSync(older, makeLog('older', 'older-skill'))
    writeFileSync(newer, makeLog('newer', 'newer-skill'))
    utimesSync(older, new Date(NOW - 10_000), new Date(NOW - 10_000))
    utimesSync(newer, new Date(NOW), new Date(NOW))
    const maxTotalBytes = statSync(newer).size
    const options = { codexHome, maxFiles: 2, maxBytesPerFile: 4_096, maxTotalBytes }

    expect(scanCodexSkillUsage(options).map(event => event.slug)).toEqual(['newer-skill'])
    expect(scanCodexSkillUsage(options).map(event => event.slug)).toEqual(['newer-skill'])
  })
})
