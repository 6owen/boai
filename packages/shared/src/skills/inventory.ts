import { createHash } from 'crypto';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'fs';
import { join, relative, resolve } from 'path';
import { validateSkillContent } from '../config/validators.ts';
import { getWorkspaceSkillsPath } from '../workspaces/storage.ts';
import { loadSkillFromDir, PROJECT_AGENT_SKILLS_DIR } from './storage.ts';
import type {
  LoadedSkill,
  SkillInventory,
  SkillInventoryRoots,
  SkillPlacement,
  SkillSource,
} from './types.ts';

const SOURCE_PRIORITY: Record<SkillSource, number> = {
  global: 0,
  workspace: 1,
  project: 2,
};

const IGNORED_IDENTITY_ENTRIES = new Set([
  '.DS_Store',
  'Thumbs.db',
  '.git',
  '.cache',
  '__pycache__',
  'node_modules',
]);

function hashDirectory(directory: string): string {
  const hash = createHash('sha256');

  function visit(current: string): void {
    const entries = readdirSync(current, { withFileTypes: true })
      .filter(entry => !IGNORED_IDENTITY_ENTRIES.has(entry.name) && !entry.name.endsWith('.pyc'))
      .sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      const relativePath = relative(directory, fullPath);
      const stats = lstatSync(fullPath);
      hash.update(relativePath);
      hash.update('\0');
      if (stats.isSymbolicLink()) {
        hash.update('symlink');
      } else if (stats.isDirectory()) {
        hash.update('directory');
        visit(fullPath);
      } else if (stats.isFile()) {
        hash.update('file');
        hash.update(readFileSync(fullPath));
      }
      hash.update('\0');
    }
  }

  visit(directory);
  return hash.digest('hex');
}

function diagnostic(path: string, message: string, suggestion?: string): SkillPlacement['diagnostics'][number] {
  return { path, message, severity: 'error', suggestion };
}

export function scanSkillRoot(skillsRoot: string, source: SkillSource): SkillPlacement[] {
  if (!existsSync(skillsRoot)) return [];

  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory() || entry.isSymbolicLink())
      .sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    return [{
      id: `${source}:${resolve(skillsRoot)}`,
      slug: '',
      source,
      path: resolve(skillsRoot),
      status: 'invalid',
      diagnostics: [diagnostic(skillsRoot, `Cannot read skills directory: ${error instanceof Error ? error.message : 'Unknown error'}`)],
      effective: false,
      shadowed: false,
      conflict: false,
    }];
  }

  return entries.map(entry => {
    const skillPath = resolve(skillsRoot, entry.name);
    const base: SkillPlacement = {
      id: `${source}:${skillPath}`,
      slug: entry.name,
      source,
      path: skillPath,
      status: 'invalid',
      diagnostics: [],
      effective: false,
      shadowed: false,
      conflict: false,
    };

    if (entry.isSymbolicLink()) {
      base.diagnostics.push(diagnostic(skillPath, 'Symbolic-link Skill directories are not managed for safety'));
      return base;
    }

    const skillFile = join(skillPath, 'SKILL.md');
    if (!existsSync(skillFile)) {
      base.diagnostics.push(diagnostic(skillFile, 'SKILL.md not found', 'Add a SKILL.md file with valid frontmatter'));
      return base;
    }

    try {
      const content = readFileSync(skillFile, 'utf8');
      const validation = validateSkillContent(content, entry.name);
      base.diagnostics = [...validation.errors, ...validation.warnings].map(issue => ({
        path: issue.path,
        message: issue.message,
        severity: issue.severity,
        suggestion: issue.suggestion,
      }));
      base.contentHash = hashDirectory(skillPath);
      if (!validation.valid) return base;

      const skill = loadSkillFromDir(skillsRoot, entry.name, source);
      if (!skill) {
        base.diagnostics.push(diagnostic(skillFile, 'Skill could not be parsed'));
        return base;
      }

      base.skill = skill;
      base.status = 'valid';
      return base;
    } catch (error) {
      base.diagnostics.push(diagnostic(skillFile, `Cannot inspect Skill: ${error instanceof Error ? error.message : 'Unknown error'}`));
      return base;
    }
  });
}

export function scanSkillInventory(roots: SkillInventoryRoots): SkillInventory {
  const tiers: Array<{ source: SkillSource; root: string }> = [
    { source: 'global', root: roots.globalSkillsRoot },
    { source: 'workspace', root: getWorkspaceSkillsPath(roots.workspaceRoot) },
  ];
  if (roots.projectRoot) {
    tiers.push({ source: 'project', root: join(roots.projectRoot, PROJECT_AGENT_SKILLS_DIR) });
  }

  const placements = tiers.flatMap(tier => scanSkillRoot(tier.root, tier.source));
  const effectiveBySlug = new Map<string, SkillPlacement>();
  const hashesBySlug = new Map<string, Set<string>>();

  for (const placement of placements) {
    if (placement.status !== 'valid' || !placement.skill) continue;
    if (placement.contentHash) {
      const hashes = hashesBySlug.get(placement.slug) ?? new Set<string>();
      hashes.add(placement.contentHash);
      hashesBySlug.set(placement.slug, hashes);
    }
    const current = effectiveBySlug.get(placement.slug);
    if (!current || SOURCE_PRIORITY[placement.source] > SOURCE_PRIORITY[current.source]) {
      effectiveBySlug.set(placement.slug, placement);
    }
  }

  for (const placement of placements) {
    const effective = effectiveBySlug.get(placement.slug);
    placement.effective = effective?.id === placement.id;
    placement.shadowed = placement.status === 'valid' && !!effective && effective.id !== placement.id;
    placement.shadowedBy = placement.shadowed ? effective?.id : undefined;
    placement.conflict = (hashesBySlug.get(placement.slug)?.size ?? 0) > 1;
  }

  const effectiveSkills: LoadedSkill[] = Array.from(effectiveBySlug.values())
    .sort((left, right) => left.slug.localeCompare(right.slug))
    .flatMap(placement => placement.skill ? [placement.skill] : []);

  return { placements, effectiveSkills, scannedAt: Date.now() };
}
