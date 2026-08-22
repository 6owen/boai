import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillCatalogStore } from '../catalog.ts';
import { scanSkillInventory } from '../inventory.ts';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-skill-catalog-'));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SkillCatalogStore', () => {
  it('adopts an existing placement and detects later local modifications', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    const skillDirectory = join(globalSkillsRoot, 'review');
    const skillFile = join(skillDirectory, 'SKILL.md');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(skillFile, '---\nname: Review\ndescription: Reviews code\n---\n\nReview it.\n');

    const store = new SkillCatalogStore(join(root, 'manager-data'));
    const firstInventory = scanSkillInventory({ globalSkillsRoot, workspaceRoot });
    const placement = firstInventory.placements[0]!;

    const record = store.adopt(placement, { type: 'local', path: skillDirectory });
    const adopted = store.annotate(firstInventory).placements[0]!;

    expect(record.slug).toBe('review');
    expect(adopted.ownership).toBe('managed');
    expect(adopted.modified).toBe(false);

    writeFileSync(skillFile, '---\nname: Review\ndescription: Reviews code\n---\n\nReview it carefully.\n');
    const changed = store.annotate(scanSkillInventory({ globalSkillsRoot, workspaceRoot })).placements[0]!;

    expect(changed.ownership).toBe('managed');
    expect(changed.modified).toBe(true);

    const reloaded = new SkillCatalogStore(join(root, 'manager-data'));
    expect(reloaded.getRecord(record.id)?.origin.type).toBe('local');
  });

  it('persists personal tags and favorite state without changing the baseline', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    const skillDirectory = join(globalSkillsRoot, 'review');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: Review\ndescription: Reviews code\n---\nBody\n');
    const store = new SkillCatalogStore(join(root, 'manager-data'));
    const placement = scanSkillInventory({ globalSkillsRoot, workspaceRoot }).placements[0]!;
    const record = store.adopt(placement, { type: 'manual' });

    const updated = store.updateMetadata(record.id, { favorite: true, tags: ['work', 'review'] });

    expect(updated.favorite).toBe(true);
    expect(updated.tags).toEqual(['work', 'review']);
    expect(updated.baselineHash).toBe(record.baselineHash);
  });

  it('keeps a managed record visible when its directory disappears', () => {
    const root = createTempRoot();
    const globalSkillsRoot = join(root, 'global');
    const workspaceRoot = join(root, 'workspace');
    const skillDirectory = join(globalSkillsRoot, 'review');
    mkdirSync(skillDirectory, { recursive: true });
    writeFileSync(join(skillDirectory, 'SKILL.md'), '---\nname: Review\ndescription: Reviews code\n---\nBody\n');
    const store = new SkillCatalogStore(join(root, 'manager-data'));
    store.adopt(scanSkillInventory({ globalSkillsRoot, workspaceRoot }).placements[0]!, { type: 'manual' });

    rmSync(skillDirectory, { recursive: true });
    const missing = store.annotate(scanSkillInventory({ globalSkillsRoot, workspaceRoot })).placements[0]!;

    expect(missing.status).toBe('missing');
    expect(missing.ownership).toBe('managed');
    expect(missing.path).toBe(skillDirectory);
  });

  it('migrates a pre-versioned catalog into schema version 1', () => {
    const root = createTempRoot();
    const dataRoot = join(root, 'manager-data');
    const catalogPath = join(dataRoot, 'skills', 'catalog.json');
    mkdirSync(join(dataRoot, 'skills'), { recursive: true });
    writeFileSync(catalogPath, JSON.stringify({ records: [] }));

    const catalog = new SkillCatalogStore(dataRoot).load();

    expect(catalog.version).toBe(1);
    expect(JSON.parse(readFileSync(catalogPath, 'utf8')).version).toBe(1);
  });
});
