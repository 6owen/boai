import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectDataRoots } from '../data-root.ts';

const tempRoots: string[] = [];

function makeRoots(): { base: string; active: string; legacy: string } {
  const base = mkdtempSync(join(tmpdir(), 'boai-data-root-'));
  tempRoots.push(base);
  return {
    base,
    active: join(base, '.boai'),
    legacy: join(base, '.craft-agent'),
  };
}

function addConfig(root: string): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'config.json'), '{"workspaces":[]}');
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('inspectDataRoots', () => {
  test('reports a fresh installation', () => {
    const roots = makeRoots();
    expect(inspectDataRoots({ activeRoot: roots.active, legacyRoot: roots.legacy }).status)
      .toBe('fresh');
  });

  test('detects legacy-only data without modifying it', () => {
    const roots = makeRoots();
    addConfig(roots.legacy);
    expect(inspectDataRoots({ activeRoot: roots.active, legacyRoot: roots.legacy }).status)
      .toBe('legacy-only');
  });

  test('detects a divergent target conflict', () => {
    const roots = makeRoots();
    addConfig(roots.active);
    addConfig(roots.legacy);
    expect(inspectDataRoots({ activeRoot: roots.active, legacyRoot: roots.legacy }).status)
      .toBe('conflict');
  });

  test('recognizes a completed migration manifest', () => {
    const roots = makeRoots();
    addConfig(roots.active);
    addConfig(roots.legacy);
    writeFileSync(join(roots.active, 'migration-manifest.json'), JSON.stringify({
      status: 'complete',
      sourceRoot: roots.legacy,
    }));
    expect(inspectDataRoots({ activeRoot: roots.active, legacyRoot: roots.legacy }).status)
      .toBe('migrated');
  });

  test('does not compare custom development roots with legacy production data', () => {
    const roots = makeRoots();
    const custom = join(roots.base, '.boai-dev-1');
    addConfig(custom);
    addConfig(roots.legacy);
    expect(inspectDataRoots({
      activeRoot: custom,
      legacyRoot: roots.legacy,
      source: 'BOAI_HOME',
    }).status).toBe('custom');
  });
});
