/**
 * Skills Module
 *
 * Workspace skills are specialized instructions that extend Claude's capabilities.
 */

export * from './types.ts';
export * from './marketplace.ts';
export * from './agent-placements.ts';
export * from './management.ts';
export * from './usage.ts';
export * from './system-usage.ts';
export {
  GLOBAL_AGENT_SKILLS_DIR,
  PROJECT_AGENT_SKILLS_DIR,
  loadSkill,
  loadAllSkills,
  invalidateSkillsCache,
  loadSkillBySlug,
  loadPluginSkills,
  getSkillIconPath,
  deleteSkill,
  deleteSkillBySource,
  skillExists,
  listSkillSlugs,
  skillNeedsIconDownload,
  downloadSkillIcon,
} from './storage.ts';
