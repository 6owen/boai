import type { StoredMessage, StoredSession } from '../sessions/types.ts';
import type {
  AggregateSkillUsageOptions,
  SkillUsageAgentSource,
  SkillUsageStats,
} from './types.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TOP_SKILL_LIMIT = 10;
const SKILL_MENTION_PATTERN = /\[skill:([^\]\r\n]+)\]/g;
const VALID_SKILL_SLUG = /^[\w.-]+$/;

interface SkillActivation {
  sessionId: string;
  slug: string;
  timestamp: number;
}

interface MutableSkillUsage {
  slug: string;
  count: number;
  sessionIds: Set<string>;
  lastUsedAt: number;
}

interface MutableAgentSource extends SkillUsageAgentSource {
  sessionIds: Set<string>;
  skillSlugs: Set<string>;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function extractSlug(value: string, knownSkillSlugs: ReadonlySet<string>): string | undefined {
  const identifier = value.trim();
  if (!identifier) return undefined;

  const segments = identifier.split(':');
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = segments.slice(index).join(':');
    if (knownSkillSlugs.has(candidate)) return candidate;
  }

  const slug = segments.at(-1)?.trim();
  return slug && VALID_SKILL_SLUG.test(slug) ? slug : undefined;
}

function extractMentionSlugs(content: string, knownSkillSlugs: ReadonlySet<string>): string[] {
  const slugs: string[] = [];
  for (const match of content.matchAll(SKILL_MENTION_PATTERN)) {
    const slug = match[1] ? extractSlug(match[1], knownSkillSlugs) : undefined;
    if (slug) slugs.push(slug);
  }
  return slugs;
}

function extractUserMessageSlugs(
  message: StoredMessage,
  knownSkillSlugs: ReadonlySet<string>,
): Set<string> {
  const slugs = new Set<string>();

  for (const badge of message.badges ?? []) {
    if (badge.type !== 'skill') continue;
    const innerValue = badge.rawText.match(/^\[skill:([^\]\r\n]+)\]$/)?.[1];
    const slug = innerValue ? extractSlug(innerValue, knownSkillSlugs) : undefined;
    if (slug) slugs.add(slug);
  }

  for (const slug of extractMentionSlugs(message.content, knownSkillSlugs)) slugs.add(slug);
  return slugs;
}

function extractLegacyToolSlug(
  message: StoredMessage,
  knownSkillSlugs: ReadonlySet<string>,
): string | undefined {
  if (message.toolName !== 'Skill') return undefined;
  const skill = optionalString(message.toolInput?.skill);
  return skill ? extractSlug(skill, knownSkillSlugs) : undefined;
}

function getMessageTimestamp(message: StoredMessage, session: StoredSession): number {
  const candidates = [message.timestamp, session.createdAt];
  return candidates.find(value => typeof value === 'number' && Number.isFinite(value)) ?? 0;
}

function getCutoff(range: AggregateSkillUsageOptions['range'], now: number): number {
  switch (range) {
    case '7d': return now - 7 * DAY_MS;
    case '30d': return now - 30 * DAY_MS;
    case 'all': return Number.NEGATIVE_INFINITY;
  }
}

function getTopSkillLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_TOP_SKILL_LIMIT;
  if (!Number.isFinite(limit)) return DEFAULT_TOP_SKILL_LIMIT;
  return Math.max(0, Math.floor(limit));
}

function defaultAgentSourceKey(llmConnection?: string, model?: string): string {
  return `${llmConnection ?? 'unknown'}::${model ?? 'unknown'}`;
}

function resolveAgentSource(
  session: StoredSession,
  options: AggregateSkillUsageOptions,
): Omit<SkillUsageAgentSource, 'count' | 'sessionCount' | 'skillCount'> {
  const override = options.resolveAgentSource?.(session);
  const llmConnection = optionalString(override?.llmConnection) ?? optionalString(session.llmConnection);
  const model = optionalString(override?.model) ?? optionalString(session.model);
  const label = optionalString(override?.label);
  const provider = optionalString(override?.provider);

  return {
    key: optionalString(override?.key) ?? defaultAgentSourceKey(llmConnection, model),
    ...(label ? { label } : {}),
    ...(provider ? { provider } : {}),
    ...(llmConnection ? { llmConnection } : {}),
    ...(model ? { model } : {}),
  };
}

function collectActivations(
  sessions: StoredSession[],
  knownSkillSlugs: ReadonlySet<string>,
): SkillActivation[] {
  const activations = new Map<string, SkillActivation>();

  for (const session of sessions) {
    let currentUserTurn: string | undefined;

    for (const message of session.messages) {
      if (message.type === 'user') {
        currentUserTurn = message.turnId
          ? `turn:${message.turnId}`
          : `message:${message.id}`;
        const timestamp = getMessageTimestamp(message, session);
        for (const slug of extractUserMessageSlugs(message, knownSkillSlugs)) {
          const key = `${session.id}\0${currentUserTurn}\0${slug}`;
          const existing = activations.get(key);
          if (!existing || timestamp > existing.timestamp) {
            activations.set(key, { sessionId: session.id, slug, timestamp });
          }
        }
        continue;
      }

      const slug = extractLegacyToolSlug(message, knownSkillSlugs);
      if (!slug) continue;
      const toolTurn = currentUserTurn
        ?? (message.turnId ? `turn:${message.turnId}` : `message:${message.id}`);
      const timestamp = getMessageTimestamp(message, session);
      const key = `${session.id}\0${toolTurn}\0${slug}`;
      const existing = activations.get(key);
      if (!existing || timestamp > existing.timestamp) {
        activations.set(key, { sessionId: session.id, slug, timestamp });
      }
    }
  }

  return [...activations.values()];
}

/**
 * Aggregate explicit Skill requests/activations from BoAI session history.
 *
 * A Skill counts at most once per conversation turn. Modern user-message
 * badges are preferred, raw `[skill:...]` mentions are retained as a fallback,
 * and legacy `Skill` tool records remain supported.
 */
export function aggregateSkillUsage(
  sessions: StoredSession[],
  options: AggregateSkillUsageOptions,
): SkillUsageStats {
  const now = typeof options.now === 'number' && Number.isFinite(options.now)
    ? options.now
    : Date.now();
  const cutoff = getCutoff(options.range, now);
  const knownSkillSlugs = new Set(
    (options.knownSkillSlugs ?? [])
      .map(slug => slug.trim())
      .filter(Boolean),
  );
  const filtered = collectActivations(sessions, knownSkillSlugs)
    .filter(activation => activation.timestamp >= cutoff);
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const sourceIdentityBySessionId = new Map<string, ReturnType<typeof resolveAgentSource>>();
  const skillUsage = new Map<string, MutableSkillUsage>();
  const agentSources = new Map<string, MutableAgentSource>();
  const activeSessionIds = new Set<string>();

  for (const activation of filtered) {
    activeSessionIds.add(activation.sessionId);

    const existingSkill = skillUsage.get(activation.slug);
    if (existingSkill) {
      existingSkill.count += 1;
      existingSkill.sessionIds.add(activation.sessionId);
      existingSkill.lastUsedAt = Math.max(existingSkill.lastUsedAt, activation.timestamp);
    } else {
      skillUsage.set(activation.slug, {
        slug: activation.slug,
        count: 1,
        sessionIds: new Set([activation.sessionId]),
        lastUsedAt: activation.timestamp,
      });
    }

    const session = sessionsById.get(activation.sessionId);
    if (!session) continue;
    let identity = sourceIdentityBySessionId.get(session.id);
    if (!identity) {
      identity = resolveAgentSource(session, options);
      sourceIdentityBySessionId.set(session.id, identity);
    }
    const existingSource = agentSources.get(identity.key);
    if (existingSource) {
      existingSource.count += 1;
      existingSource.sessionIds.add(activation.sessionId);
      existingSource.skillSlugs.add(activation.slug);
      existingSource.label ??= identity.label;
      existingSource.provider ??= identity.provider;
      existingSource.llmConnection ??= identity.llmConnection;
      existingSource.model ??= identity.model;
    } else {
      agentSources.set(identity.key, {
        ...identity,
        count: 1,
        sessionCount: 1,
        skillCount: 1,
        sessionIds: new Set([activation.sessionId]),
        skillSlugs: new Set([activation.slug]),
      });
    }
  }

  const topSkills = [...skillUsage.values()]
    .sort((a, b) => b.count - a.count || b.lastUsedAt - a.lastUsedAt || a.slug.localeCompare(b.slug))
    .slice(0, getTopSkillLimit(options.limit))
    .map(item => ({
      slug: item.slug,
      count: item.count,
      sessionCount: item.sessionIds.size,
      lastUsedAt: item.lastUsedAt,
    }));

  const sourceDistribution = [...agentSources.values()]
    .sort((a, b) => b.count - a.count || b.sessionIds.size - a.sessionIds.size || a.key.localeCompare(b.key))
    .map(({ sessionIds, skillSlugs, ...source }) => ({
      ...source,
      sessionCount: sessionIds.size,
      skillCount: skillSlugs.size,
    }));

  return {
    scope: 'boai',
    metric: 'requested-or-activated',
    range: options.range,
    totals: {
      activations: filtered.length,
      skills: skillUsage.size,
      sessions: activeSessionIds.size,
      agentSources: agentSources.size,
    },
    topSkills,
    agentSources: sourceDistribution,
  };
}
