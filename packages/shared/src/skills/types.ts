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
}

/** A concrete directory in which a Skill is present. */
export interface SkillPlacement {
  /** Stable within a machine and scope; unlike slug, this identifies one physical placement. */
  id: string;
  slug: string;
  source: SkillSource;
  path: string;
  /** The parsed Skill when validation succeeds. */
  skill?: LoadedSkill;
  /** Deterministic hash of the files in this placement. */
  contentHash?: string;
  status: 'valid' | 'invalid';
  diagnostics: Array<{
    path: string;
    message: string;
    severity: 'error' | 'warning';
    suggestion?: string;
  }>;
  /** True when this is the placement the Agent runtime resolves for the slug. */
  effective: boolean;
  /** True when a higher-priority placement with the same slug is effective. */
  shadowed: boolean;
  shadowedBy?: string;
  /** True when multiple valid placements with this slug contain different content. */
  conflict: boolean;
  ownership?: 'managed' | 'external';
  recordId?: string;
  record?: SkillRecord;
  modified?: boolean;
}

export interface SkillInventory {
  placements: SkillPlacement[];
  effectiveSkills: LoadedSkill[];
  scannedAt: number;
}

export interface SkillInventoryRoots {
  globalSkillsRoot: string;
  workspaceRoot: string;
  projectRoot?: string;
}

export type SkillOrigin =
  | { type: 'git'; url: string; ref?: string; commit?: string; version?: string }
  | { type: 'registry'; package: string; version?: string; url?: string }
  | { type: 'local'; path: string }
  | { type: 'manual' }
  | { type: 'unknown' };

export interface SkillRecord {
  id: string;
  slug: string;
  placementId: string;
  baselineHash: string;
  baselineSnapshot?: string;
  origin: SkillOrigin;
  managedAt: number;
  updatedAt: number;
  favorite?: boolean;
  tags?: string[];
}

export interface SkillCatalogData {
  version: 1;
  records: SkillRecord[];
}

export type SkillTarget =
  | { source: 'global'; globalSkillsRoot: string }
  | { source: 'workspace'; workspaceRoot: string }
  | { source: 'project'; projectRoot: string };

/** Renderer-safe target descriptor. Filesystem roots are resolved by the server. */
export type SkillRpcTarget =
  | { source: 'global' }
  | { source: 'workspace' }
  | { source: 'project' };

export interface SkillAdoptRequest {
  placementId: string;
  workingDirectory?: string;
  origin?: SkillOrigin;
}

export interface SkillPreviewDirectoryRequest {
  sourceDirectory: string;
  slug: string;
  target: SkillRpcTarget;
  workingDirectory?: string;
}

export interface SkillInstallDirectoryRequest extends SkillPreviewDirectoryRequest {
  origin?: SkillOrigin;
  overwrite?: boolean;
}

export interface SkillInstallNpxRequest {
  source: string;
  slug: string;
  target: SkillRpcTarget;
  workingDirectory?: string;
  overwrite?: boolean;
}

export interface SkillRemoveManagedRequest {
  placementId: string;
  workingDirectory?: string;
}

export interface SkillMetadataUpdateRequest {
  placementId: string;
  workingDirectory?: string;
  favorite?: boolean;
  tags?: string[];
}

export interface SkillOperationRecord {
  id: string;
  type: 'adopt' | 'metadata' | 'stop-managing' | 'install' | 'update' | 'remove' | 'restore';
  status: 'succeeded' | 'failed';
  slug: string;
  target: SkillTarget;
  targetPath: string;
  startedAt: number;
  completedAt: number;
  hadTarget: boolean;
  beforeSnapshot?: string;
  recordId?: string;
  beforeRecord?: SkillRecord;
  afterHash?: string;
  error?: string;
  restoredOperationId?: string;
}

export interface SkillFileDiff {
  path: string;
  status: 'added' | 'removed' | 'modified' | 'unchanged';
  beforeHash?: string;
  afterHash?: string;
  beforeContent?: string;
  afterContent?: string;
}

export interface SkillDirectoryDiff {
  changed: boolean;
  files: SkillFileDiff[];
}

export interface SkillInstallPlan {
  slug: string;
  target: SkillTarget;
  targetPath: string;
  operationType: 'install' | 'update';
  valid: boolean;
  diagnostics: Array<{ message: string; path: string; suggestion?: string }>;
  diff?: SkillDirectoryDiff;
  baselineToLocalDiff?: SkillDirectoryDiff;
  baselineToUpstreamDiff?: SkillDirectoryDiff;
  localModified?: boolean;
  upstreamChanged?: boolean;
  threeWayConflict?: boolean;
}
