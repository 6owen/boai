import { describe, expect, it } from 'bun:test'
import type { SessionMeta } from '@/atoms/sessions'
import { selectVisibleWorkspaceSessions } from '../visible-sessions'

function makeSession(id: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    id,
    workspaceId: 'workspace-local',
    lastMessageAt: Date.parse('2026-08-23T10:00:00.000Z'),
    ...overrides,
  }
}

describe('selectVisibleWorkspaceSessions', () => {
  it('keeps ordinary and legacy archived sessions while excluding hidden sessions', () => {
    const ordinary = makeSession('ordinary', { hasUnread: true })
    const archived = makeSession('archived', { isArchived: true, isProcessing: true })
    const hidden = makeSession('hidden', { hidden: true })

    const result = selectVisibleWorkspaceSessions(
      [ordinary, archived, hidden],
      'workspace-local',
    )

    expect(result).toEqual([ordinary, archived])
    expect(result[0]?.hasUnread).toBe(true)
    expect(result[1]?.isProcessing).toBe(true)
  })

  it('accepts sessions from the remote workspace mapped to the active workspace', () => {
    const local = makeSession('local')
    const remote = makeSession('remote', { workspaceId: 'workspace-remote' })
    const unrelated = makeSession('unrelated', { workspaceId: 'workspace-other' })

    const result = selectVisibleWorkspaceSessions(
      [local, remote, unrelated],
      'workspace-local',
      'workspace-remote',
    )

    expect(result.map((session) => session.id)).toEqual(['local', 'remote'])
  })

  it('returns every non-hidden session when there is no active workspace', () => {
    const first = makeSession('first', { workspaceId: 'workspace-a' })
    const second = makeSession('second', { workspaceId: 'workspace-b', isArchived: true })

    expect(selectVisibleWorkspaceSessions([first, second], null)).toEqual([first, second])
  })
})
