import { afterEach, describe, expect, it } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { scanSkillInventory } from '../inventory.ts';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-skill-inventory-'));
  tempRoots.push(root);
  return root;
}

function createSkill(skillsRoot: string, slug: string, name: string): void {
  const directory = join(skillsRoot, slug);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name} description\n---\n\nUse ${name}.\n`,
  );
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('scanSkillInventory', () => {
  it('preserves every physical placement while identifying the effective skill', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    const projectRoot = join(root, 'project');

    createSkill(globalSkillsRoot, 'review', 'Global Review');
    createSkill(join(workspaceRoot, 'skills'), 'review', 'Workspace Review');
    createSkill(join(projectRoot, '.agents', 'skills'), 'review', 'Project Review');

    const inventory = scanSkillInventory({
      globalSkillsRoot,
      workspaceRoot,
      projectRoot,
    });

    expect(inventory.placements).toHaveLength(3);
    expect(inventory.placements.map(item => item.source)).toEqual([
      'global',
      'workspace',
      'project',
    ]);
    expect(inventory.placements.filter(item => item.effective)).toHaveLength(1);
    expect(inventory.placements.find(item => item.effective)?.source).toBe('project');
    expect(inventory.placements.filter(item => item.shadowed).map(item => item.source)).toEqual([
      'global',
      'workspace',
    ]);
    expect(inventory.effectiveSkills[0]?.metadata.name).toBe('Project Review');
  });

  it('reports invalid folders and distinguishes divergent duplicate content', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');

    createSkill(globalSkillsRoot, 'review', 'Global Review');
    createSkill(join(workspaceRoot, 'skills'), 'review', 'Workspace Review');
    mkdirSync(join(workspaceRoot, 'skills', 'broken'), { recursive: true });

    const inventory = scanSkillInventory({ globalSkillsRoot, workspaceRoot });
    const broken = inventory.placements.find(item => item.slug === 'broken');
    const reviewPlacements = inventory.placements.filter(item => item.slug === 'review');

    expect(broken?.status).toBe('invalid');
    expect(broken?.diagnostics[0]?.message).toContain('SKILL.md not found');
    expect(reviewPlacements.every(item => item.conflict)).toBe(true);
  });

  it('keeps unsafe symlinks and invalid frontmatter visible as invalid placements', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    const linkedTarget = join(root, 'linked-target');
    createSkill(linkedTarget, 'real', 'Real');
    mkdirSync(globalSkillsRoot, { recursive: true });
    symlinkSync(join(linkedTarget, 'real'), join(globalSkillsRoot, 'linked'));
    const malformed = join(globalSkillsRoot, 'malformed');
    mkdirSync(malformed, { recursive: true });
    writeFileSync(join(malformed, 'SKILL.md'), '---\nname: Missing description\n---\nBody\n');

    const inventory = scanSkillInventory({ globalSkillsRoot, workspaceRoot });

    expect(inventory.placements.find(item => item.slug === 'linked')?.diagnostics[0]?.message).toContain('Symbolic-link');
    expect(inventory.placements.find(item => item.slug === 'malformed')?.status).toBe('invalid');
  });

  it('ignores known cache artifacts when calculating identity', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    createSkill(globalSkillsRoot, 'review', 'Review');
    const skillDirectory = join(globalSkillsRoot, 'review');
    const before = scanSkillInventory({ globalSkillsRoot, workspaceRoot }).placements[0]!.contentHash;
    mkdirSync(join(skillDirectory, '.cache'));
    writeFileSync(join(skillDirectory, '.cache', 'generated.bin'), 'first');
    writeFileSync(join(skillDirectory, '.DS_Store'), 'finder');

    const after = scanSkillInventory({ globalSkillsRoot, workspaceRoot }).placements[0]!.contentHash;
    expect(after).toBe(before);
  });

  it('surfaces an unreadable Skill root as a validation placement', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'restricted');
    const workspaceRoot = join(root, 'workspace');
    mkdirSync(globalSkillsRoot);
    chmodSync(globalSkillsRoot, 0o000);
    try {
      const inventory = scanSkillInventory({ globalSkillsRoot, workspaceRoot });
      expect(inventory.placements[0]?.status).toBe('invalid');
      expect(inventory.placements[0]?.diagnostics[0]?.message).toContain('Cannot read skills directory');
    } finally {
      chmodSync(globalSkillsRoot, 0o700);
    }
  });
});
