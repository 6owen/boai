import { afterEach, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { NpxSkillsAdapter, inferSkillOrigin, type SkillCommandRunner } from '../command-adapter.ts';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('NpxSkillsAdapter', () => {
  it('captures source ref, version, and commit provenance without parsing CLI output', () => {
    expect(inferSkillOrigin('owner/repository@v1.2.3')).toEqual({
      type: 'git', url: 'owner/repository', ref: 'v1.2.3', version: 'v1.2.3', commit: undefined,
    });
    const commit = '0123456789abcdef0123456789abcdef01234567';
    expect(inferSkillOrigin(`https://github.com/owner/repository#${commit}`)).toEqual({
      type: 'git', url: 'https://github.com/owner/repository', ref: commit, commit, version: undefined,
    });
    expect(inferSkillOrigin('npm:@scope/skill@2.0.0')).toEqual({
      type: 'registry', package: '@scope/skill', version: '2.0.0',
    });
  });

  it('acquires a copied Skill in an isolated project without invoking a shell', async () => {
    const stagingRoot = mkdtempSync(join(tmpdir(), 'craft-skills-cli-'));
    tempRoots.push(stagingRoot);
    let invocation: Parameters<SkillCommandRunner>[0] | undefined;
    const runner: SkillCommandRunner = async request => {
      invocation = request;
      const skillDirectory = join(request.cwd, '.agents', 'skills', 'review');
      mkdirSync(skillDirectory, { recursive: true });
      writeFileSync(
        join(skillDirectory, 'SKILL.md'),
        '---\nname: review\ndescription: Reviews code\n---\n\nReview it.\n',
      );
      return { exitCode: 0, stdout: 'installed', stderr: '' };
    };

    const adapter = new NpxSkillsAdapter(runner);
    const acquired = await adapter.acquire({
      source: 'vercel-labs/agent-skills',
      slug: 'review',
      stagingRoot,
    });

    expect(acquired.skillDirectory).toBe(join(invocation!.cwd, '.agents', 'skills', 'review'));
    expect(invocation?.executable).toBe('npx');
    expect(invocation?.args).toEqual([
      '--yes',
      'skills',
      'add',
      'vercel-labs/agent-skills',
      '--skill',
      'review',
      '--agent',
      'universal',
      '--yes',
      '--copy',
    ]);
    expect(invocation?.shell).toBe(false);
  });
});
