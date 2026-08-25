import { getLlmConnections } from '@craft-agent/shared/config/storage'
import { listSessions, loadSession } from '@craft-agent/shared/sessions/storage'
import { detectInstalledSkillAgents } from '@craft-agent/shared/skills/agent-placements'
import { loadAllSkills } from '@craft-agent/shared/skills/storage'
import { aggregateSkillUsage } from '@craft-agent/shared/skills/usage'
import { mergeSystemSkillUsage, scanCodexSkillUsage } from '@craft-agent/shared/skills/system-usage'
import type { SkillUsageRange, SkillUsageStats } from '@craft-agent/shared/skills/types'

/**
 * Compute the system-wide Skill usage dashboard.
 *
 * This function intentionally remains synchronous because it performs many
 * small filesystem reads. Electron runs it inside a dedicated worker so none
 * of that I/O or aggregation blocks the main process event loop.
 */
export function computeSkillUsageStats(
  workspaceRootPath: string,
  range: SkillUsageRange,
): SkillUsageStats {
  const sessions = listSessions(workspaceRootPath).flatMap((metadata) => {
    const session = loadSession(workspaceRootPath, metadata.id)
    return session ? [session] : []
  })
  const connections = new Map(getLlmConnections().map(connection => [connection.slug, connection]))
  const knownSkillSlugs = loadAllSkills(workspaceRootPath).map(skill => skill.slug)

  const now = Date.now()
  const boaiStats = aggregateSkillUsage(sessions, {
    range,
    now,
    limit: Math.max(10, knownSkillSlugs.length),
    knownSkillSlugs,
    resolveAgentSource: (session) => {
      if (!session.llmConnection) return undefined
      const connection = connections.get(session.llmConnection)
      if (!connection) return undefined
      return {
        label: connection.name,
        provider: connection.piAuthProvider ?? connection.providerType,
      }
    },
  })
  const installedAgents = detectInstalledSkillAgents()
  const hasCodex = installedAgents.some(agent => agent.agentId === 'codex')
  const cutoff = range === '7d'
    ? now - 7 * 24 * 60 * 60 * 1000
    : range === '30d'
      ? now - 30 * 24 * 60 * 60 * 1000
      : undefined
  const externalEvents = hasCodex
    ? scanCodexSkillUsage({ knownSkillSlugs, cutoff })
    : []

  return mergeSystemSkillUsage(boaiStats, externalEvents, {
    installedAgents,
    observableAgentIds: hasCodex ? ['codex'] : [],
    range,
    now,
  })
}
