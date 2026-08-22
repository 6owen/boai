import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { diffSkillDirectories } from '../diff.ts';

const tempRoots: string[] = [];

function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'craft-skill-diff-'));
  tempRoots.push(value);
  return value;
}

afterEach(() => {
  for (const value of tempRoots.splice(0)) rmSync(value, { recursive: true, force: true });
});

describe('diffSkillDirectories', () => {
  it('reports added, removed, modified and unchanged files', () => {
    const before = root();
    const after = root();
    mkdirSync(join(before, 'nested'));
    mkdirSync(join(after, 'nested'));
    writeFileSync(join(before, 'SKILL.md'), 'before');
    writeFileSync(join(after, 'SKILL.md'), 'after');
    writeFileSync(join(before, 'removed.txt'), 'removed');
    writeFileSync(join(after, 'added.txt'), 'added');
    writeFileSync(join(before, 'nested', 'same.txt'), 'same');
    writeFileSync(join(after, 'nested', 'same.txt'), 'same');

    const result = diffSkillDirectories(before, after);

    expect(result.changed).toBe(true);
    expect(result.files.map(file => [file.path, file.status])).toEqual([
      ['SKILL.md', 'modified'],
      ['added.txt', 'added'],
      ['nested/same.txt', 'unchanged'],
      ['removed.txt', 'removed'],
    ]);
  });
});
