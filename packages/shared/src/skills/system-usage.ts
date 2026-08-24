import type {
  ExternalSkillUsageEvent,
  InstalledSkillAgent,
  SkillUsageAgentSource,
  SkillUsageRange,
  SkillUsageStats,
} from './types.ts'
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const DAY_MS = 24 * 60 * 60 * 1000
const SKILL_PATH_PATTERN = /(?:^|[\s"'`(])(?:[A-Za-z]:[\\/]|\/)[^\n"'`]*?[\\/]skills[\\/]([^\\/\s"'`]+)[\\/]SKILL\.md\b/gi
const READ_ACTION_PATTERN = /(?:^|\W)(?:cat|sed|head|tail|less|bat|type|get-content|readfile|read_mcp_resource|skills?\.read)(?:\W|$)/i

interface ParseCodexOptions {
  knownSkillSlugs?: readonly string[]
}

interface MergeSystemOptions {
  installedAgents: readonly InstalledSkillAgent[]
  observableAgentIds: readonly string[]
  range: SkillUsageRange
  now?: number
  limit?: number
}

interface ScanCodexOptions extends ParseCodexOptions {
  codexHome?: string
  /** Files older than this may be skipped for bounded dashboard ranges. */
  cutoff?: number
  /** Lightweight dashboard guardrails; callers can override them for imports. */
  maxFiles?: number
  maxTotalBytes?: number
  maxBytesPerFile?: number
}

interface CachedCodexLog {
  mtimeMs: number
  size: number
  events: ExternalSkillUsageEvent[]
}

const codexLogCache = new Map<string, CachedCodexLog>()

function getCutoff(range: SkillUsageRange, now: number): number {
  if (range === '7d') return now - 7 * DAY_MS
  if (range === '30d') return now - 30 * DAY_MS
  return Number.NEGATIVE_INFINITY
}

function stringifyArguments(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function resolveKnownSlug(leaf: string, knownSkillSlugs: readonly string[]): string {
  const matches = knownSkillSlugs.filter(slug => slug === leaf || slug.endsWith(`:${leaf}`))
  return matches.length === 1 ? matches[0]! : leaf
}

function extractSkillSlugs(command: string, knownSkillSlugs: readonly string[]): string[] {
  if (!READ_ACTION_PATTERN.test(command)) return []
  const slugs = new Set<string>()
  for (const match of command.matchAll(SKILL_PATH_PATTERN)) {
    if (match[1]) slugs.add(resolveKnownSlug(match[1], knownSkillSlugs))
  }
  return [...slugs]
}

/** Parse Codex JSONL without treating the injected Skill catalog as usage. */
export function parseCodexSkillUsageJsonl(
  jsonl: string,
  options: ParseCodexOptions = {},
): ExternalSkillUsageEvent[] {
  const knownSkillSlugs = options.knownSkillSlugs ?? []
  let sessionId = 'unknown-codex-session'
  const events = new Map<string, ExternalSkillUsageEvent>()

  for (const line of jsonl.split(/\r?\n/)) {
    if (!line.trim()) continue
    const isSessionMeta = line.includes('"type":"session_meta"')
    const isCompletedItem = line.includes('"type":"event_msg"')
      && line.includes('"item_completed"')
      && line.includes('SKILL.md')
    if (!isSessionMeta && !isCompletedItem) continue
    let record: any
    try {
      record = JSON.parse(line)
    } catch {
      continue
    }

    if (record?.type === 'session_meta') {
      sessionId = record.payload?.session_id || record.payload?.id || sessionId
      continue
    }
    if (record?.type !== 'event_msg' || record.payload?.type !== 'item_completed') continue

    const item = record.payload?.item
    const turnId = record.payload?.turn_id
    if (!item || typeof turnId !== 'string' || !turnId) continue

    const command = item.type === 'CommandExecution'
      ? stringifyArguments(item.command)
      : item.type === 'DynamicToolCall'
        ? stringifyArguments(item.arguments)
        : ''
    if (!command) continue

    const timestamp = Date.parse(record.timestamp)
    for (const slug of extractSkillSlugs(command, knownSkillSlugs)) {
      const key = `${sessionId}\0${turnId}\0${slug}`
      if (events.has(key)) continue
      events.set(key, {
        agentId: 'codex',
        agentName: 'Codex',
        confidence: 'inferred',
        sessionId,
        turnId,
        slug,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      })
    }
  }

  return [...events.values()]
}

function listJsonlFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...listJsonlFiles(path))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path)
  }
  return files
}

function readLogTail(file: string, size: number, maxBytes: number): string {
  if (size <= maxBytes) return readFileSync(file, 'utf8')
  const length = Math.min(size, maxBytes)
  const buffer = Buffer.allocUnsafe(length)
  const descriptor = openSync(file, 'r')
  try {
    readSync(descriptor, buffer, 0, length, size - length)
  } finally {
    closeSync(descriptor)
  }
  const text = buffer.toString('utf8')
  const firstCompleteLine = text.indexOf('\n')
  return firstCompleteLine >= 0 ? text.slice(firstCompleteLine + 1) : ''
}

/** Read local Codex Desktop/CLI histories with a small per-file memory cache. */
export function scanCodexSkillUsage(
  options: ScanCodexOptions = {},
): ExternalSkillUsageEvent[] {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME?.trim() ?? join(homedir(), '.codex')
  const files = [
    ...listJsonlFiles(join(codexHome, 'archived_sessions')),
    ...listJsonlFiles(join(codexHome, 'sessions')),
  ]
    .flatMap((file) => {
      try {
        const stat = statSync(file)
        return options.cutoff !== undefined && stat.mtimeMs < options.cutoff
          ? []
          : [{ file, stat }]
      } catch {
        return []
      }
    })
    .sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs)
    .slice(0, options.maxFiles ?? 200)
  const events: ExternalSkillUsageEvent[] = []
  const maxTotalBytes = options.maxTotalBytes ?? 512 * 1024 * 1024
  const maxBytesPerFile = options.maxBytesPerFile ?? 16 * 1024 * 1024
  const selectedFiles: typeof files = []
  let selectedBytes = 0

  for (const candidate of files) {
    const readSize = Math.min(candidate.stat.size, maxBytesPerFile)
    if (selectedBytes + readSize > maxTotalBytes) break
    selectedBytes += readSize
    selectedFiles.push(candidate)
  }

  for (const { file, stat } of selectedFiles) {
    try {
      const cached = codexLogCache.get(file)
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
        events.push(...cached.events)
        continue
      }
      const fallbackSessionId = file.split(/[\\/]/).at(-1)?.replace(/\.jsonl$/, '') ?? file
      const parsed = parseCodexSkillUsageJsonl(readLogTail(file, stat.size, maxBytesPerFile), options)
        .map(event => event.sessionId === 'unknown-codex-session'
          ? { ...event, sessionId: fallbackSessionId }
          : event)
      codexLogCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, events: parsed })
      events.push(...parsed)
    } catch {
      // A concurrently rotated or unreadable Agent log should not break the dashboard.
    }
  }

  return events
}

/** Merge native BoAI analytics with normalized events from local Agent adapters. */
export function mergeSystemSkillUsage(
  boai: SkillUsageStats,
  externalEvents: readonly ExternalSkillUsageEvent[],
  options: MergeSystemOptions,
): SkillUsageStats {
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now()
  const cutoff = getCutoff(options.range, now)
  const events = externalEvents.filter(event => event.timestamp >= cutoff)
  const limit = Math.max(0, Math.floor(options.limit ?? 10))
  const skills = new Map(boai.topSkills.map(item => [item.slug, { ...item }]))
  const externalSessionIds = new Set<string>()
  const externalSessionsBySkill = new Map<string, Set<string>>()

  for (const event of events) {
    const externalSessionId = `${event.agentId}:${event.sessionId}`
    externalSessionIds.add(externalSessionId)
    const skillSessions = externalSessionsBySkill.get(event.slug) ?? new Set<string>()
    skillSessions.add(externalSessionId)
    externalSessionsBySkill.set(event.slug, skillSessions)
    const current = skills.get(event.slug)
    if (current) {
      current.count += 1
      current.lastUsedAt = Math.max(current.lastUsedAt, event.timestamp)
    } else {
      skills.set(event.slug, {
        slug: event.slug,
        count: 1,
        sessionCount: 0,
        lastUsedAt: event.timestamp,
      })
    }
  }

  for (const [slug, sessionIds] of externalSessionsBySkill) {
    const skill = skills.get(slug)
    if (skill) skill.sessionCount += sessionIds.size
  }

  const installed = new Map(options.installedAgents.map(agent => [agent.agentId, agent]))
  installed.set('boai', { agentId: 'boai', agentName: 'BoAI' })
  const observable = new Set(['boai', ...options.observableAgentIds])
  const sources: SkillUsageAgentSource[] = []

  for (const agent of installed.values()) {
    const agentEvents = events.filter(event => event.agentId === agent.agentId)
    const sessionIds = new Set(agentEvents.map(event => event.sessionId))
    const skillSlugs = new Set(agentEvents.map(event => event.slug))
    const isBoai = agent.agentId === 'boai'
    sources.push({
      key: `agent:${agent.agentId}`,
      agentId: agent.agentId,
      label: agent.agentName,
      count: isBoai ? boai.totals.activations : agentEvents.length,
      sessionCount: isBoai ? boai.totals.sessions : sessionIds.size,
      skillCount: isBoai ? boai.totals.skills : skillSlugs.size,
      availability: observable.has(agent.agentId) ? 'observed' : 'unavailable',
      ...(observable.has(agent.agentId)
        ? { confidence: isBoai ? 'exact' as const : agentEvents[0]?.confidence ?? 'inferred' as const }
        : {}),
    })
  }

  sources.sort((a, b) => {
    if (a.availability !== b.availability) return a.availability === 'observed' ? -1 : 1
    return b.count - a.count || (a.label ?? a.key).localeCompare(b.label ?? b.key)
  })

  return {
    scope: 'system',
    metric: 'requested-or-activated',
    range: options.range,
    totals: {
      activations: boai.totals.activations + events.length,
      skills: skills.size,
      sessions: boai.totals.sessions + externalSessionIds.size,
      agentSources: installed.size,
    },
    topSkills: [...skills.values()]
      .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt || a.slug.localeCompare(b.slug))
      .slice(0, limit),
    agentSources: sources,
    coverage: {
      detectedAgents: installed.size,
      observableAgents: [...installed.keys()].filter(agentId => observable.has(agentId)).length,
    },
  }
}
