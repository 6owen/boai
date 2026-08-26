/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

import type { StoredSession } from '../sessions/types.ts';

/**
 * Skill metadata from SKILL.md YAML frontmatter
 */
export interface SkillMetadata {
  /** Display name for the skill */
  name: string;
  /** Brief description shown in skill list */
  description: string;
  /** Optional file patterns that trigger this skill */
  globs?: string[];
  /** Optional tools to always allow when skill is active */
  alwaysAllow?: string[];
  /**
   * Optional icon - emoji or URL only.
   * - Emoji: rendered directly in UI (e.g., "🔧")
   * - URL: auto-downloaded to icon.{ext} file
   * Note: Relative paths and inline SVG are NOT supported.
   */
  icon?: string;
  /** Optional source slugs to auto-enable when this skill is invoked */
  requiredSources?: string[];
}

/** Source of a loaded skill */
export type SkillSource = 'global' | 'workspace' | 'project' | 'plugin' | 'agent';

/** Source shape accepted by the install-source scanner. */
export type SkillInstallSourceKind = 'folder' | 'zip' | 'url' | 'git';

export interface ScanSkillSourceRequest {
  source: string;
  kind: SkillInstallSourceKind;
}

export interface SkillInstallCandidate {
  slug: string;
  description?: string;
  /** Classification restored from a BoAI skill-library manifest. */
  libraryKind?: 'local' | 'vendor' | 'source' | 'snapshot';
  /** Stable repository id from boai.lock.json. */
  sourceId?: string;
  /** Candidate-specific source used to preserve Vendor update provenance. */
  installSource?: string;
}

export interface SkillLibraryScanInfo {
  name: string;
  vendorCount: number;
  sourceCount: number;
}

export interface SkillSourceScanResult {
  /** Source that should be passed back to installSkill (ZIPs resolve to a temp folder). */
  installSource: string;
  candidates: SkillInstallCandidate[];
  /** Present when the scanned source is a BoAI skill-library repository. */
  library?: SkillLibraryScanInfo;
}

/** Scope supported by the skills CLI. */
export type SkillManagementScope = 'global' | 'project';

/** Request for installing one skill through the skills CLI. */
export interface InstallSkillRequest {
  /** GitHub shorthand, Git URL, or local package path accepted by `skills add`. */
  source: string;
  /** Skill slug to select from the package. */
  slug: string;
  /** Install globally or into the selected project's .agents directory. */
  scope: SkillManagementScope;
  /** Required when scope is project. */
  workingDirectory?: string;
}

/** Sanitized output returned by a skills CLI operation. */
export interface SkillManagementResult {
  stdout: string;
  stderr: string;
}

/** One installed skill whose locked source hash differs from the remote source. */
export interface SkillUpdateCandidate {
  slug: string;
  scope: SkillManagementScope;
}

/** Read-only result returned before the user confirms a skill update. */
export interface SkillUpdateCheckResult {
  updates: SkillUpdateCandidate[];
  checkedCount: number;
  skippedCount: number;
}

/** Request for updating or removing one CLI-managed skill. */
export interface ManageSkillRequest {
  slug: string;
  scope: SkillManagementScope;
  workingDirectory?: string;
}

/** Request for permanently deleting one unmanaged skill from its exact source. */
export interface DeleteSkillRequest {
  slug: string;
  source: Exclude<SkillSource, 'plugin' | 'agent'>;
  workingDirectory?: string;
}

/** Provenance read from the lock file maintained by the skills CLI. */
export interface SkillManagementInfo {
  manager: 'skills-cli';
  scope: SkillManagementScope;
  /** Root directory used to manage a project-scoped skill. */
  projectRoot?: string;
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  /** Content-tree hash recorded by the skills CLI for the installed skill. */
  revision?: string;
  installedAt?: string;
  updatedAt?: string;
  canUpdate: boolean;
}

/** One installed Agent that can read a skill from its direct or inherited location. */
export interface SkillAgentPlacement {
  agentId: string;
  agentName: string;
  isInherited?: boolean;
  inheritedFromAgentId?: string;
}

/**
 * Plugin name for project-level and global skills.
 *
 * The SDK derives plugin names from `path.basename()` of the registered plugin
 * directory. Both `{project}/.agents/` and `~/.agents/` share the basename
 * `.agents`, so skills from either tier resolve to `.agents:skillSlug`.
 */
export const AGENTS_PLUGIN_NAME = '.agents';

/**
 * A loaded skill with parsed content
 */
export interface LoadedSkill {
  /** Directory name (slug) */
  slug: string;
  /** Parsed metadata from YAML frontmatter */
  metadata: SkillMetadata;
  /** Full SKILL.md content (without frontmatter) */
  content: string;
  /** Absolute path to icon file if exists */
  iconPath?: string;
  /** Absolute path to skill directory */
  path: string;
  /** Where this skill was loaded from */
  source: SkillSource;
  /** Owning plugin for plugin-provided skills. */
  pluginName?: string;
  /** Present only when this exact skill is tracked by the skills CLI. */
  management?: SkillManagementInfo;
  /** Installed Agents that can currently read this skill. */
  agentPlacements?: SkillAgentPlacement[];
}

/** Time window supported by BoAI's lightweight Skill usage summary. */
export type SkillUsageRange = '7d' | '30d' | 'all';

/** One Skill ranked by distinct conversation turns that requested or activated it. */
export interface SkillUsageItem {
  slug: string;
  count: number;
  sessionCount: number;
  lastUsedAt: number;
}

/** Usage attributed to either a BoAI model source or a local Agent application. */
export interface SkillUsageAgentSource {
  key: string;
  /** External Agent application identity (BoAI, Codex, Cursor, and so on). */
  agentId?: string;
  /** Optional human-readable connection name supplied by the caller. */
  label?: string;
  /** Optional provider identifier supplied by the caller. */
  provider?: string;
  llmConnection?: string;
  model?: string;
  count: number;
  sessionCount: number;
  skillCount: number;
  /** Whether BoAI can currently read usage records for this Agent. */
  availability?: 'observed' | 'unavailable';
  /** Exact means instrumented by BoAI; inferred means reconstructed from local logs. */
  confidence?: 'exact' | 'inferred';
}

export interface InstalledSkillAgent {
  agentId: string;
  agentName: string;
}

export interface ExternalSkillUsageEvent {
  agentId: string;
  agentName: string;
  confidence: 'exact' | 'inferred';
  sessionId: string;
  turnId: string;
  slug: string;
  timestamp: number;
}

/** Optional display metadata used to enrich an Agent source while aggregating. */
export type SkillUsageAgentSourceOverride = Partial<Pick<
  SkillUsageAgentSource,
  'key' | 'label' | 'provider' | 'llmConnection' | 'model'
>>;

export interface AggregateSkillUsageOptions {
  range: SkillUsageRange;
  /** Clock override for deterministic callers and tests. Defaults to Date.now(). */
  now?: number;
  /** Maximum number of ranked Skills returned. Agent source distribution is not truncated. */
  limit?: number;
  /**
   * Installed Skill identifiers used to preserve qualified Plugin identities.
   * Outer runtime namespaces are removed only until a known identifier matches.
   */
  knownSkillSlugs?: readonly string[];
  /** Enrich or replace the default connection/model identity for a session. */
  resolveAgentSource?: (session: StoredSession) => SkillUsageAgentSourceOverride | undefined;
}

/**
 * Lightweight analytics derived from BoAI sessions and optional local Agent adapters.
 *
 * `requested-or-activated` means a Skill was explicitly attached to a user
 * message or observed through the legacy Skill tool. It does not prove that an
 * external Agent completed the Skill instructions. `scope: system` may include
 * inferred events reconstructed from bounded local-log scans.
 */
export interface SkillUsageStats {
  scope: 'boai' | 'system';
  metric: 'requested-or-activated';
  range: SkillUsageRange;
  totals: {
    activations: number;
    skills: number;
    sessions: number;
    agentSources: number;
  };
  topSkills: SkillUsageItem[];
  agentSources: SkillUsageAgentSource[];
  coverage?: {
    detectedAgents: number;
    observableAgents: number;
  };
}
