/**
 * Skills Storage
 *
 * CRUD operations for workspace skills.
 * Skills are stored in {workspace}/skills/{slug}/ directories.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';
import matter from 'gray-matter';
import type { LoadedSkill, SkillMetadata, SkillSource } from './types.ts';
import { getSkillAgentDiscoveryRoots } from './agent-placements.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Agent Skills Paths (Issue #171)
// ============================================================

/** Global agent skills directory: ~/.agents/skills/ */
export const GLOBAL_AGENT_SKILLS_DIR = join(homedir(), '.agents', 'skills');

/** Project-level agent skills relative directory name */
export const PROJECT_AGENT_SKILLS_DIR = '.agents/skills';

/**
 * Normalize requiredSources frontmatter to a clean string array.
 * Accepts a single string or array of strings, trims whitespace, and deduplicates.
 */
function normalizeRequiredSources(value: unknown): string[] | undefined {
  const asArray = typeof value === 'string'
    ? [value]
    : Array.isArray(value)
      ? value
      : undefined;

  if (!asArray) return undefined;

  const normalized = Array.from(new Set(
    asArray
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => entry.trim())
      .filter(Boolean)
  ));

  return normalized.length > 0 ? normalized : undefined;
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse SKILL.md content and extract frontmatter + body
 */
function parseSkillFile(content: string): { metadata: SkillMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    // Only accepts emoji or URL - rejects inline SVG and relative paths
    const icon = validateIconValue(parsed.data.icon, 'Skills');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        globs: parsed.data.globs as string[] | undefined,
        alwaysAllow: parsed.data.alwaysAllow as string[] | undefined,
        icon,
        requiredSources: normalizeRequiredSources(parsed.data.requiredSources),
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single skill from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param slug - Skill directory name
 * @param source - Where this skill is loaded from
 */
function loadSkillFromDir(skillsDir: string, slug: string, source: SkillSource): LoadedSkill | null {
  const skillDir = join(skillsDir, slug);
  return loadSkillAtPath(skillDir, slug, source);
}

function loadSkillAtPath(
  skillDir: string,
  slug: string,
  source: SkillSource,
  pluginName?: string,
): LoadedSkill | null {
  const skillFile = join(skillDir, 'SKILL.md');

  // Check directory exists
  if (!existsSync(skillDir) || !statSync(skillDir).isDirectory()) {
    return null;
  }

  // Check SKILL.md exists
  if (!existsSync(skillFile)) {
    return null;
  }

  // Read and parse SKILL.md
  let content: string;
  try {
    content = readFileSync(skillFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseSkillFile(content);
  if (!parsed) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    iconPath: findIconFile(skillDir),
    path: skillDir,
    source,
    pluginName,
  };
}

/**
 * Load all skills from a directory
 * @param skillsDir - Absolute path to skills directory
 * @param source - Where these skills are loaded from
 */
function loadSkillsFromDir(skillsDir: string, source: SkillSource): LoadedSkill[] {
  if (!existsSync(skillsDir)) {
    return [];
  }

  const skills: LoadedSkill[] = [];

  try {
    const entries = readdirSync(skillsDir, { withFileTypes: true });
    for (const entry of entries) {
      // Agent installers commonly place directory symlinks (or Windows
      // junctions) in a skills root. statSync() in loadSkillAtPath follows the
      // link and verifies that its target is a directory containing SKILL.md.
      if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

      const skill = loadSkillFromDir(skillsDir, entry.name, source);
      if (skill) {
        skills.push(skill);
      }
    }
  } catch {
    // Ignore errors reading skills directory
  }

  return skills;
}

interface PluginMarketplaceFile {
  plugins?: Array<{
    name?: string;
    source?: { source?: string; path?: string };
  }>;
}

interface PluginManifest {
  name?: string;
  skills?: string | string[];
}

export interface PluginSkillLoadOptions {
  homeDir?: string;
  codexHome?: string;
}

/** Discover skills provided by enabled packages installed through `npx plugins`. */
export function loadPluginSkills(options: PluginSkillLoadOptions = {}): LoadedSkill[] {
  const homeDir = options.homeDir ?? homedir();
  const marketplacePath = join(homeDir, '.agents', 'plugins', 'marketplace.json');
  const codexHome = options.codexHome ?? process.env.CODEX_HOME?.trim() ?? join(homeDir, '.codex');
  const configPath = join(codexHome, 'config.toml');
  if (!existsSync(marketplacePath) || !existsSync(configPath)) return [];

  try {
    const marketplace = JSON.parse(readFileSync(marketplacePath, 'utf8')) as PluginMarketplaceFile;
    const config = readFileSync(configPath, 'utf8');
    const enabledPlugins = new Set(
      [...config.matchAll(/^\[plugins\."([^"\n]+)"\]\s*\nenabled\s*=\s*true\s*$/gm)]
        .map(match => match[1]),
    );
    const result: LoadedSkill[] = [];

    for (const entry of marketplace.plugins ?? []) {
      const pluginName = entry.name?.trim();
      const rawPluginPath = entry.source?.path?.trim();
      if (!pluginName || !rawPluginPath || !enabledPlugins.has(`${pluginName}@plugins-cli`)) continue;

      const pluginRoot = resolve(homeDir, rawPluginPath);
      const manifestPath = join(pluginRoot, '.codex-plugin', 'plugin.json');
      if (!existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PluginManifest;
      const skillRoots = Array.isArray(manifest.skills) ? manifest.skills : [manifest.skills ?? './skills/'];

      for (const rawSkillsRoot of skillRoots) {
        const skillsRoot = resolve(pluginRoot, rawSkillsRoot);
        if (!existsSync(skillsRoot)) continue;
        for (const skillEntry of readdirSync(skillsRoot, { withFileTypes: true })) {
          if (!skillEntry.isDirectory()) continue;
          const skill = loadSkillAtPath(
            join(skillsRoot, skillEntry.name),
            `${pluginName}:${skillEntry.name}`,
            'plugin',
            manifest.name || pluginName,
          );
          if (skill) result.push(skill);
        }
      }
    }
    return result;
  } catch {
    return [];
  }
}

/**
 * Load a single skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function loadSkill(workspaceRoot: string, slug: string): LoadedSkill | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillFromDir(skillsDir, slug, 'workspace');
}

/**
 * Load all skills from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceSkills(workspaceRoot: string): LoadedSkill[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  return loadSkillsFromDir(skillsDir, 'workspace');
}

// ── Skills cache ────────────────────────────────────────────────────────
// loadAllSkills reads from the registered Agent roots plus BoAI sources.
// The result rarely changes during a session, so we cache it per
// (workspaceRoot, projectRoot) pair with a 5-minute safety TTL.

const skillsCache = new Map<string, { skills: LoadedSkill[]; ts: number }>();
const SKILLS_CACHE_TTL = 5 * 60_000; // 5 minutes

/** Invalidate the skills cache (call on working dir change or skill file events). */
export function invalidateSkillsCache(): void {
  skillsCache.clear();
}

/**
 * Load all skills from all sources (Agent directories, global, workspace, project, plugins)
 * Skills with the same slug are overridden by higher-priority sources.
 * Priority: Agent directory (lowest) < global < workspace < project (highest)
 *
 * Results are cached per (workspaceRoot, projectRoot) pair. Call
 * invalidateSkillsCache() on working directory changes or skill file events.
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param projectRoot - Optional project root (working directory) for project-level skills
 */
export function loadAllSkills(workspaceRoot: string, projectRoot?: string): LoadedSkill[] {
  const cacheKey = `${workspaceRoot}::${projectRoot ?? ''}`;
  const now = Date.now();
  const cached = skillsCache.get(cacheKey);
  if (cached && now - cached.ts < SKILLS_CACHE_TTL) {
    return cached.skills;
  }

  const skillsBySlug = new Map<string, LoadedSkill>();

  // 1. External Agent skills (lowest priority): ~/.codex/skills, ~/.claude/skills, etc.
  // Discovery is filesystem-based and deliberately does not require any CLI.
  for (const root of getSkillAgentDiscoveryRoots()) {
    for (const skill of loadSkillsFromDir(root.path, 'agent')) {
      // Keep the first Agent-owned variant deterministic. Higher-priority BoAI
      // sources below still override it. A future catalog model can expose
      // same-slug external variants instead of collapsing them here.
      if (!skillsBySlug.has(skill.slug)) skillsBySlug.set(skill.slug, skill);
    }
  }

  // 2. Shared global skills: ~/.agents/skills/
  for (const skill of loadSkillsFromDir(GLOBAL_AGENT_SKILLS_DIR, 'global')) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 3. Workspace skills (medium priority)
  for (const skill of loadWorkspaceSkills(workspaceRoot)) {
    skillsBySlug.set(skill.slug, skill);
  }

  // 4. Project skills (highest priority): {projectRoot}/.agents/skills/
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    for (const skill of loadSkillsFromDir(projectSkillsDir, 'project')) {
      skillsBySlug.set(skill.slug, skill);
    }
  }

  // 5. Enabled plugins installed through `npx plugins` (qualified slugs avoid collisions).
  for (const skill of loadPluginSkills()) {
    skillsBySlug.set(skill.slug, skill);
  }

  const result = Array.from(skillsBySlug.values());
  skillsCache.set(cacheKey, { skills: result, ts: now });
  return result;
}

/**
 * Load a single skill by slug from all sources (project > workspace > global > Agent directory).
 * Unlike loadAllSkills(), this only reads the specific slug directory — O(1) not O(N).
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill slug to load
 * @param projectRoot - Optional project root for project-level skills
 */
export function loadSkillBySlug(workspaceRoot: string, slug: string, projectRoot?: string): LoadedSkill | null {
  if (slug.includes(':')) {
    const pluginSkill = loadPluginSkills().find(skill => skill.slug === slug);
    if (pluginSkill) return pluginSkill;
  }
  // Highest priority: project-level
  if (projectRoot) {
    const projectSkillsDir = join(projectRoot, PROJECT_AGENT_SKILLS_DIR);
    const skill = loadSkillFromDir(projectSkillsDir, slug, 'project');
    if (skill) return skill;
  }

  // Medium priority: workspace
  const workspaceSkill = loadSkillFromDir(getWorkspaceSkillsPath(workspaceRoot), slug, 'workspace');
  if (workspaceSkill) return workspaceSkill;

  // Shared global, followed by lower-priority external Agent directories.
  const globalSkill = loadSkillFromDir(GLOBAL_AGENT_SKILLS_DIR, slug, 'global');
  if (globalSkill) return globalSkill;

  for (const root of getSkillAgentDiscoveryRoots()) {
    const agentSkill = loadSkillFromDir(root.path, slug, 'agent');
    if (agentSkill) return agentSkill;
  }
  return null;
}

/**
 * Get icon path for a skill
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function getSkillIconPath(workspaceRoot: string, slug: string): string | null {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return null;
  }

  return findIconFile(skillDir) || null;
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete a skill from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function deleteSkill(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);

  if (!existsSync(skillDir)) {
    return false;
  }

  try {
    rmSync(skillDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete an unmanaged skill from its exact loaded source.
 * The caller must separately handle skills tracked by a package manager.
 */
export function deleteSkillBySource(
  workspaceRoot: string,
  slug: string,
  source: Exclude<SkillSource, 'plugin' | 'agent'>,
  projectRoot?: string,
): boolean {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(slug)) {
    throw new Error('Invalid skill name');
  }

  const skillsDir = source === 'global'
    ? GLOBAL_AGENT_SKILLS_DIR
    : source === 'project'
      ? projectRoot && join(projectRoot, PROJECT_AGENT_SKILLS_DIR)
      : getWorkspaceSkillsPath(workspaceRoot);

  if (!skillsDir) throw new Error('Select a project before deleting a project skill');

  const skillDir = join(skillsDir, slug);
  if (!existsSync(skillDir)) return false;

  try {
    rmSync(skillDir, { recursive: true });
    invalidateSkillsCache();
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if a skill exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Skill directory name
 */
export function skillExists(workspaceRoot: string, slug: string): boolean {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);
  const skillDir = join(skillsDir, slug);
  const skillFile = join(skillDir, 'SKILL.md');

  return existsSync(skillDir) && existsSync(skillFile);
}

/**
 * List skill slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listSkillSlugs(workspaceRoot: string): string[] {
  const skillsDir = getWorkspaceSkillsPath(workspaceRoot);

  if (!existsSync(skillsDir)) {
    return [];
  }

  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        const skillFile = join(skillsDir, entry.name, 'SKILL.md');
        return existsSync(skillFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

// ============================================================
// Icon Download (uses shared utilities)
// ============================================================

/**
 * Download an icon from a URL and save it to the skill directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadSkillIcon(
  skillDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(skillDir, iconUrl, 'Skills');
}

/**
 * Check if a skill needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function skillNeedsIconDownload(skill: LoadedSkill): boolean {
  return needsIconDownload(skill.metadata.icon, skill.iconPath);
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
