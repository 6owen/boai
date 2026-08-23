import type { SessionMeta } from '@/atoms/sessions'

/**
 * Select sessions that belong in BoAI's user-facing conversation list.
 *
 * Legacy archived sessions remain visible so removing the Archive view never
 * makes user data disappear. Internal sessions stay hidden, and remote
 * workspaces may opt into their server-side workspace ID.
 */
export function selectVisibleWorkspaceSessions(
  sessions: readonly SessionMeta[],
  activeWorkspaceId: string | null | undefined,
  remoteWorkspaceId?: string | null,
): SessionMeta[] {
  return sessions.filter((session) => {
    if (session.hidden) return false
    if (!activeWorkspaceId) return true

    return session.workspaceId === activeWorkspaceId
      || (!!remoteWorkspaceId && session.workspaceId === remoteWorkspaceId)
  })
}
