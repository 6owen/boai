import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SkillCatalogStore } from '../catalog.ts';
import { scanSkillInventory } from '../inventory.ts';
import { SkillOperationService } from '../operations.ts';
import { invalidateSkillsCache, loadAllSkills } from '../storage.ts';

const tempRoots: string[] = [];

function createTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'craft-skill-operations-'));
  tempRoots.push(root);
  return root;
}

function createSkill(parent: string, slug: string, body = 'Use it.'): string {
  const directory = join(parent, slug);
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    join(directory, 'SKILL.md'),
    `---\nname: ${slug}\ndescription: ${slug} description\n---\n\n${body}\n`,
  );
  return directory;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('SkillOperationService', () => {
  it('installs a Skill acquired through the Skills CLI adapter', async () => {
    const root = createTempRoot();
    const acquiredDirectory = createSkill(join(root, 'acquired'), 'review');
    const workspaceRoot = join(root, 'workspace');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(
      dataRoot,
      new SkillCatalogStore(dataRoot),
      {
        acquire: async () => ({
          skillDirectory: acquiredDirectory,
          workingDirectory: join(root, 'acquired'),
          stdout: '',
          stderr: '',
        }),
      },
    );

    const result = await operations.installFromNpx({
      source: 'owner/repository',
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
    });

    expect(result.status).toBe('succeeded');
    expect(readFileSync(join(workspaceRoot, 'skills', 'review', 'SKILL.md'), 'utf8')).toContain('Use it.');
  });

  it('previews a CLI-acquired Skill without changing the target', async () => {
    const root = createTempRoot();
    const acquiredDirectory = createSkill(join(root, 'acquired'), 'review', 'Upstream instructions.');
    const workspaceRoot = join(root, 'workspace');
    createSkill(join(workspaceRoot, 'skills'), 'review', 'Local instructions.');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot), {
      acquire: async () => ({
        skillDirectory: acquiredDirectory,
        workingDirectory: join(root, 'acquired'),
        stdout: '', stderr: '',
      }),
    });

    const preview = await operations.previewFromNpx({
      source: 'owner/repository', slug: 'review',
      target: { source: 'workspace', workspaceRoot },
    });

    expect(preview.operationType).toBe('update');
    expect(preview.diff?.changed).toBe(true);
    expect(preview.command).toEqual({
      executable: 'npx',
      args: ['--yes', 'skills', 'add', 'owner/repository', '--skill', 'review', '--agent', 'universal', '--yes', '--copy'],
    });
    expect(readFileSync(join(workspaceRoot, 'skills', 'review', 'SKILL.md'), 'utf8')).toContain('Local instructions.');
  });

  it('installs a validated local Skill and records it as managed', () => {
    const root = createTempRoot();
    const source = createSkill(join(root, 'source'), 'review');
    const workspaceRoot = join(root, 'workspace');
    const dataRoot = join(root, 'manager');
    const catalog = new SkillCatalogStore(dataRoot);
    const operations = new SkillOperationService(dataRoot, catalog);

    const result = operations.installFromDirectory({
      sourceDirectory: source,
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'local', path: source },
    });

    const installedFile = join(workspaceRoot, 'skills', 'review', 'SKILL.md');
    expect(result.status).toBe('succeeded');
    expect(existsSync(installedFile)).toBe(true);
    expect(catalog.getRecord(result.recordId!)?.slug).toBe('review');
    expect(operations.listOperations()[0]?.id).toBe(result.id);
    const transitions = readFileSync(join(dataRoot, 'skills', 'operations.jsonl'), 'utf8')
      .trim().split('\n').map(line => JSON.parse(line).status);
    expect(transitions).toEqual(['running', 'succeeded']);
  });

  it('makes a newly installed Skill available to the existing Agent runtime loader without restart', () => {
    const root = createTempRoot();
    const source = createSkill(join(root, 'source'), 'review');
    const workspaceRoot = join(root, 'workspace');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));
    operations.installFromDirectory({
      sourceDirectory: source, slug: 'review',
      target: { source: 'workspace', workspaceRoot }, origin: { type: 'local', path: source },
    });
    invalidateSkillsCache();

    const runtimeSkill = loadAllSkills(workspaceRoot).find(skill => skill.slug === 'review');

    expect(runtimeSkill?.metadata.name).toBe('review');
    expect(runtimeSkill?.source).toBe('workspace');
  });

  it('restores the previous directory after an update', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const existing = createSkill(join(workspaceRoot, 'skills'), 'review', 'Original instructions.');
    const replacement = createSkill(join(root, 'replacement'), 'review', 'New instructions.');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));

    const update = operations.installFromDirectory({
      sourceDirectory: replacement,
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'local', path: replacement },
      overwrite: true,
    });
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toContain('New instructions.');

    const restore = operations.restore(update.id);

    expect(restore.status).toBe('succeeded');
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toContain('Original instructions.');
  });

  it('refuses to restore over content changed after the operation', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const existing = createSkill(join(workspaceRoot, 'skills'), 'review', 'Original instructions.');
    const replacement = createSkill(join(root, 'replacement'), 'review', 'New instructions.');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));
    const update = operations.installFromDirectory({
      sourceDirectory: replacement, slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'git', url: 'owner/repository' }, overwrite: true,
    });
    writeFileSync(join(existing, 'SKILL.md'), '---\nname: review\ndescription: changed later\n---\nLater change.\n');

    expect(() => operations.restore(update.id)).toThrow('changed since the operation')
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toContain('Later change.');
    expect(operations.listOperations().at(-1)).toMatchObject({
      type: 'restore', status: 'failed', restoredOperationId: update.id,
    });
  });

  it('restores the previous Catalog provenance with an updated directory', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const existing = createSkill(join(workspaceRoot, 'skills'), 'review', 'Original instructions.');
    const replacement = createSkill(join(root, 'replacement'), 'review', 'New instructions.');
    const dataRoot = join(root, 'manager');
    const catalog = new SkillCatalogStore(dataRoot);
    const operations = new SkillOperationService(dataRoot, catalog);
    operations.installFromDirectory({
      sourceDirectory: existing, slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'git', url: 'first/repository' }, overwrite: true,
    });
    const update = operations.installFromDirectory({
      sourceDirectory: replacement, slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'git', url: 'second/repository' }, overwrite: true,
    });
    operations.restore(update.id);

    expect(catalog.load().records[0]?.origin).toEqual({ type: 'git', url: 'first/repository' });
  });

  it('previews an update without changing the installed Skill', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const existing = createSkill(join(workspaceRoot, 'skills'), 'review', 'Original instructions.');
    const replacement = createSkill(join(root, 'replacement'), 'review', 'New instructions.');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));

    const preview = operations.previewFromDirectory({
      sourceDirectory: replacement,
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'local', path: replacement },
    });

    expect(preview.operationType).toBe('update');
    expect(preview.diff?.files.find(file => file.path === 'SKILL.md')?.status).toBe('modified');
    expect(readFileSync(join(existing, 'SKILL.md'), 'utf8')).toContain('Original instructions.');
  });

  it('distinguishes local and upstream changes from the managed baseline', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const original = createSkill(join(root, 'original'), 'review', 'Baseline instructions.');
    const upstream = createSkill(join(root, 'upstream'), 'review', 'Upstream instructions.');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));
    operations.installFromDirectory({
      sourceDirectory: original, slug: 'review',
      target: { source: 'workspace', workspaceRoot }, origin: { type: 'git', url: 'owner/repository' },
    });
    writeFileSync(join(workspaceRoot, 'skills', 'review', 'notes.txt'), 'local change');

    const preview = operations.previewFromDirectory({
      sourceDirectory: upstream, slug: 'review',
      target: { source: 'workspace', workspaceRoot }, origin: { type: 'git', url: 'owner/repository' },
    });

    expect(preview.localModified).toBe(true);
    expect(preview.upstreamChanged).toBe(true);
    expect(preview.threeWayConflict).toBe(true);
  });

  it('updates provenance without accepting local edits as a new baseline', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const source = createSkill(join(root, 'source'), 'review', 'Baseline instructions.');
    const dataRoot = join(root, 'manager');
    const catalog = new SkillCatalogStore(dataRoot);
    const operations = new SkillOperationService(dataRoot, catalog);
    const installed = operations.installFromDirectory({
      sourceDirectory: source, slug: 'review',
      target: { source: 'workspace', workspaceRoot }, origin: { type: 'git', url: 'old/repository' },
    });
    const baselineHash = catalog.getRecord(installed.recordId!)!.baselineHash;
    writeFileSync(join(workspaceRoot, 'skills', 'review', 'notes.txt'), 'local edit');
    const roots = { globalSkillsRoot: join(root, 'global'), workspaceRoot };
    const placement = scanSkillInventory(roots).placements[0]!;

    operations.adopt(placement, { source: 'workspace', workspaceRoot }, { type: 'git', url: 'new/repository' });
    const annotated = catalog.annotate(scanSkillInventory(roots)).placements[0]!;

    expect(annotated.modified).toBe(true);
    expect(annotated.record?.baselineHash).toBe(baselineHash);
    expect(annotated.record?.origin).toEqual({ type: 'git', url: 'new/repository' });
  });

  it('removes a Skill into a restorable backup', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const installed = createSkill(join(workspaceRoot, 'skills'), 'review');
    const dataRoot = join(root, 'manager');
    const operations = new SkillOperationService(dataRoot, new SkillCatalogStore(dataRoot));

    const removal = operations.remove({
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
    });
    expect(existsSync(installed)).toBe(false);

    operations.restore(removal.id);

    expect(readFileSync(join(installed, 'SKILL.md'), 'utf8')).toContain('Use it.');
  });

  it('restores Catalog ownership and origin after a removal', () => {
    const root = createTempRoot();
    const workspaceRoot = join(root, 'workspace');
    const source = createSkill(join(root, 'source'), 'review');
    const dataRoot = join(root, 'manager');
    const catalog = new SkillCatalogStore(dataRoot);
    const operations = new SkillOperationService(dataRoot, catalog);
    operations.installFromDirectory({
      sourceDirectory: source, slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'git', url: 'owner/repository' },
    });
    const removal = operations.remove({ slug: 'review', target: { source: 'workspace', workspaceRoot } });
    operations.restore(removal.id);

    expect(catalog.load().records[0]?.origin).toEqual({ type: 'git', url: 'owner/repository' });
  });

  it('rejects invalid input without changing the target', () => {
    const root = createTempRoot();
    const source = join(root, 'invalid', 'review');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'SKILL.md'), 'not a valid skill');
    const workspaceRoot = join(root, 'workspace');
    const operations = new SkillOperationService(
      join(root, 'manager'),
      new SkillCatalogStore(join(root, 'manager')),
    );

    expect(() => operations.installFromDirectory({
      sourceDirectory: source,
      slug: 'review',
      target: { source: 'workspace', workspaceRoot },
      origin: { type: 'local', path: source },
    })).toThrow('Skill validation failed');
    expect(existsSync(join(workspaceRoot, 'skills', 'review'))).toBe(false);
  });
});
