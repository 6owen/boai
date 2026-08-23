import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  annotateManagedSkills,
  SkillsCliService,
  type SkillsCliRunner,
} from '../management.ts'
import type { LoadedSkill } from '../types.ts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-skills-management-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SkillsCliService.install', () => {
  test('installs one global skill through the universal .agents directory', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    let receivedArgs: string[] = []
    let receivedCwd = ''
    const runner: SkillsCliRunner = async (args, options) => {
      receivedArgs = args
      receivedCwd = options.cwd
      const target = join(globalSkillsDir, 'agent-browser')
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'SKILL.md'), '# Agent Browser')
      return { stdout: 'installed', stderr: '' }
    }
    const service = new SkillsCliService({ globalSkillsDir, runner })

    const result = await service.install({
      source: 'vercel-labs/agent-browser',
      slug: 'agent-browser',
      scope: 'global',
      cwd: root,
    })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'add', 'vercel-labs/agent-browser',
      '--skill', 'agent-browser', '--agent', 'universal', '--yes', '--copy', '--full-depth', '--global',
    ])
    expect(receivedCwd).toBe(root)
    expect(result.stdout).toBe('installed')
  })

  test('installs a project skill without the global flag', async () => {
    const projectRoot = makeTempDir()
    let receivedArgs: string[] = []
    const runner: SkillsCliRunner = async (args) => {
      receivedArgs = args
      const target = join(projectRoot, '.agents', 'skills', 'ai-sdk')
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'SKILL.md'), '# AI SDK')
      return { stdout: '', stderr: '' }
    }
    const service = new SkillsCliService({ runner })

    await service.install({
      source: 'vercel/ai',
      slug: 'ai-sdk',
      scope: 'project',
      projectRoot,
    })

    expect(receivedArgs).not.toContain('--global')
  })

  test('does not overwrite an existing skill', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    mkdirSync(join(globalSkillsDir, 'existing'), { recursive: true })
    const runner: SkillsCliRunner = async () => {
      throw new Error('runner should not be called')
    }
    const service = new SkillsCliService({ globalSkillsDir, runner })

    expect(service.install({
      source: 'owner/repo',
      slug: 'existing',
      scope: 'global',
      cwd: root,
    })).rejects.toThrow('already exists')
  })

  test('rejects unsafe or incomplete input before running the command', async () => {
    const runner: SkillsCliRunner = async () => {
      throw new Error('runner should not be called')
    }
    const service = new SkillsCliService({ globalSkillsDir: makeTempDir(), runner })

    expect(service.install({ source: '--help', slug: 'valid', scope: 'global' })).rejects.toThrow('valid skill source')
    expect(service.install({ source: 'owner/repo', slug: '../escape', scope: 'global' })).rejects.toThrow('Skill name')
    expect(service.install({ source: 'owner/repo', slug: 'valid', scope: 'project' })).rejects.toThrow('Select a project')
  })
})

describe('SkillsCliService.scan', () => {
  test('lists every discovered skill without installing', async () => {
    let receivedArgs: string[] = []
    const service = new SkillsCliService({
      runner: async args => {
        receivedArgs = args
        return {
          stdout: [
            '◇  Available Skills',
            '│',
            '│    first-skill',
            '│',
            '│      First description.',
            '│',
            '│    second-skill',
            '│',
            '│      Second description.',
          ].join('\n'),
          stderr: '',
        }
      },
    })

    const result = await service.scan({ source: 'owner/repo', kind: 'git' })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'add', 'owner/repo', '--list', '--full-depth',
    ])
    expect(result).toEqual({
      installSource: 'owner/repo',
      candidates: [
        { slug: 'first-skill', description: 'First description.' },
        { slug: 'second-skill', description: 'Second description.' },
      ],
    })
  })
})

describe('SkillsCliService.update', () => {
  test('updates one global skill non-interactively', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    const target = join(globalSkillsDir, 'agent-browser')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# Agent Browser')
    let receivedArgs: string[] = []
    const runner: SkillsCliRunner = async (args) => {
      receivedArgs = args
      return { stdout: 'up to date', stderr: '' }
    }
    const service = new SkillsCliService({ globalSkillsDir, runner })

    await service.update({ slug: 'agent-browser', scope: 'global', cwd: root })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'update', 'agent-browser', '--global', '--yes',
    ])
  })

  test('updates a project skill from the project directory', async () => {
    const projectRoot = makeTempDir()
    const target = join(projectRoot, '.agents', 'skills', 'ai-sdk')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# AI SDK')
    let receivedCwd = ''
    let receivedArgs: string[] = []
    const runner: SkillsCliRunner = async (args, options) => {
      receivedArgs = args
      receivedCwd = options.cwd
      return { stdout: '', stderr: '' }
    }
    const service = new SkillsCliService({ runner })

    await service.update({ slug: 'ai-sdk', scope: 'project', projectRoot })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'update', 'ai-sdk', '--project', '--yes',
    ])
    expect(receivedCwd).toBe(projectRoot)
  })
})

describe('SkillsCliService.checkUpdates', () => {
  test('finds changed global skills without running the update command', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    const globalLockPath = join(root, '.agents', '.skill-lock.json')
    mkdirSync(globalSkillsDir, { recursive: true })
    writeFileSync(globalLockPath, JSON.stringify({
      version: 3,
      skills: {
        changed: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/changed/SKILL.md',
          skillFolderHash: 'old-hash',
        },
        current: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/current/SKILL.md',
          skillFolderHash: 'same-hash',
        },
      },
    }))
    let runnerCalled = false
    const service = new SkillsCliService({
      globalSkillsDir,
      globalLockPath,
      runner: async () => {
        runnerCalled = true
        return { stdout: '', stderr: '' }
      },
      treeFetcher: async () => ({
        rootHash: 'root-hash',
        folders: {
          'skills/changed': 'new-hash',
          'skills/current': 'same-hash',
        },
      }),
    })

    const result = await service.checkUpdates({ scope: 'global' })

    expect(result).toEqual({
      updates: [{ slug: 'changed', scope: 'global' }],
      checkedCount: 2,
      skippedCount: 0,
    })
    expect(runnerCalled).toBe(false)
  })

  test('checks only the requested skill and reports unavailable sources as skipped', async () => {
    const root = makeTempDir()
    const projectRoot = join(root, 'project')
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(projectRoot, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'AI SDK': {
          source: 'local/package',
          sourceType: 'local',
          skillPath: 'skills/ai-sdk/SKILL.md',
          skillFolderHash: 'old-hash',
        },
        other: {
          source: 'owner/repo',
          sourceType: 'github',
          skillPath: 'skills/other/SKILL.md',
          skillFolderHash: 'old-hash',
        },
      },
    }))
    const service = new SkillsCliService({
      treeFetcher: async () => {
        throw new Error('unrequested source should not be fetched')
      },
    })

    const result = await service.checkUpdates({
      scope: 'project',
      slugs: ['ai-sdk'],
      projectRoot,
    })

    expect(result).toEqual({ updates: [], checkedCount: 0, skippedCount: 1 })
  })
})

describe('SkillsCliService.updateAllGlobal', () => {
  test('updates every global skill non-interactively', async () => {
    const root = makeTempDir()
    let receivedArgs: string[] = []
    let receivedCwd = ''
    let receivedTimeoutMs = 0
    const runner: SkillsCliRunner = async (args, options) => {
      receivedArgs = args
      receivedCwd = options.cwd
      receivedTimeoutMs = options.timeoutMs ?? 0
      return { stdout: 'all global skills are up to date', stderr: '' }
    }
    const service = new SkillsCliService({ runner })

    const result = await service.updateAllGlobal(root)

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'update', '--global', '--yes',
    ])
    expect(receivedCwd).toBe(root)
    expect(receivedTimeoutMs).toBe(10 * 60_000)
    expect(result.stdout).toBe('all global skills are up to date')
  })
})

describe('SkillsCliService.uninstall', () => {
  test('uninstalls a global skill and cleans all agent links', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    const target = join(globalSkillsDir, 'agent-browser')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# Agent Browser')
    let receivedArgs: string[] = []
    const runner: SkillsCliRunner = async (args) => {
      receivedArgs = args
      rmSync(target, { recursive: true, force: true })
      return { stdout: 'removed', stderr: '' }
    }
    const service = new SkillsCliService({ globalSkillsDir, runner })

    await service.uninstall({ slug: 'agent-browser', scope: 'global', cwd: root })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'remove', 'agent-browser', '--global', '--yes',
    ])
    expect(receivedArgs).not.toContain('--agent')
  })

  test('uninstalls a project skill from the project directory', async () => {
    const projectRoot = makeTempDir()
    const target = join(projectRoot, '.agents', 'skills', 'ai-sdk')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# AI SDK')
    let receivedArgs: string[] = []
    let receivedCwd = ''
    const runner: SkillsCliRunner = async (args, options) => {
      receivedArgs = args
      receivedCwd = options.cwd
      rmSync(target, { recursive: true, force: true })
      return { stdout: '', stderr: '' }
    }
    const service = new SkillsCliService({ runner })

    await service.uninstall({ slug: 'ai-sdk', scope: 'project', projectRoot })

    expect(receivedArgs).toEqual([
      '--yes', 'skills', 'remove', 'ai-sdk', '--yes',
    ])
    expect(receivedCwd).toBe(projectRoot)
  })

  test('fails if the CLI reports success without removing the skill', async () => {
    const root = makeTempDir()
    const globalSkillsDir = join(root, '.agents', 'skills')
    const target = join(globalSkillsDir, 'stuck')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), '# Stuck')
    const service = new SkillsCliService({
      globalSkillsDir,
      runner: async () => ({ stdout: '', stderr: '' }),
    })

    expect(service.uninstall({ slug: 'stuck', scope: 'global', cwd: root }))
      .rejects.toThrow('still installed')
  })
})

describe('annotateManagedSkills', () => {
  function skill(slug: string, source: LoadedSkill['source']): LoadedSkill {
    return {
      slug,
      source,
      path: `/skills/${slug}`,
      metadata: { name: slug, description: '' },
      content: '',
    }
  }

  test('marks only skills tracked by the matching global or project lock', () => {
    const root = makeTempDir()
    const globalLockPath = join(root, 'global-lock.json')
    const projectRoot = join(root, 'project')
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(globalLockPath, JSON.stringify({
      version: 3,
      skills: {
        'agent-browser': {
          source: 'vercel-labs/agent-browser',
          sourceType: 'github',
          sourceUrl: 'https://github.com/vercel-labs/agent-browser.git',
          skillPath: 'skills/agent-browser/SKILL.md',
          skillFolderHash: 'abc',
          installedAt: '2026-07-06T01:11:00.000Z',
          updatedAt: '2026-08-23T00:04:00.000Z',
        },
      },
    }))
    writeFileSync(join(projectRoot, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        'AI SDK': {
          source: 'vercel/ai',
          sourceType: 'github',
          skillPath: 'skills/ai-sdk/SKILL.md',
        },
      },
    }))

    const result = annotateManagedSkills([
      skill('agent-browser', 'global'),
      skill('ai-sdk', 'project'),
      skill('manual', 'global'),
      skill('agent-browser', 'workspace'),
    ], projectRoot, { globalLockPath })

    expect(result[0]!.management).toMatchObject({
      scope: 'global',
      source: 'vercel-labs/agent-browser',
      sourceUrl: 'https://github.com/vercel-labs/agent-browser.git',
      revision: 'abc',
      installedAt: '2026-07-06T01:11:00.000Z',
      updatedAt: '2026-08-23T00:04:00.000Z',
      canUpdate: true,
    })
    expect(result[1]!.management).toMatchObject({ scope: 'project', canUpdate: true })
    expect(result[2]!.management).toBeUndefined()
    expect(result[3]!.management).toBeUndefined()
  })

  test('tracks local CLI entries but does not offer unsupported updates', () => {
    const root = makeTempDir()
    const projectRoot = join(root, 'project')
    mkdirSync(projectRoot, { recursive: true })
    writeFileSync(join(projectRoot, 'skills-lock.json'), JSON.stringify({
      version: 1,
      skills: {
        local: { source: '../local', sourceType: 'local', skillPath: 'SKILL.md' },
      },
    }))

    const [result] = annotateManagedSkills(
      [skill('local', 'project')],
      projectRoot,
      { globalLockPath: join(root, 'missing.json') },
    )

    expect(result!.management).toMatchObject({ manager: 'skills-cli', canUpdate: false })
  })
})
