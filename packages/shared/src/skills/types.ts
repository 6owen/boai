/**
 * Skills Types
 *
 * Type definitions for workspace skills.
 * Skills are specialized instructions that extend Claude's capabilities.
 */

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
export type SkillSource = 'global' | 'workspace' | 'project';

/** Scope supported by the skills CLI. */
export type SkillManagementScope = 'global' | 'project';

/** Request for installing one skill through the skills CLI. */
export interface InstallSkillRequest {
  /** GitHub shorthand, Git URL, or local package path accepted by `skills add`. */
  source: string;
  /** Skill slug to select from the package. */
  slug: string;
  /** Install globally or into the active project's .agents directory. */
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

/** Provenance read from the lock file maintained by the skills CLI. */
export interface SkillManagementInfo {
  manager: 'skills-cli';
  scope: SkillManagementScope;
  source?: string;
  sourceType?: string;
  sourceUrl?: string;
  skillPath?: string;
  installedAt?: string;
  updatedAt?: string;
  canUpdate: boolean;
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
  /** Present only when this exact skill is tracked by the skills CLI. */
  management?: SkillManagementInfo;
}
