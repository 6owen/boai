import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SkillsCliService, type SkillsCliRunner } from '../management.ts'

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
      '--skill', 'agent-browser', '--agent', 'universal', '--yes', '--copy', '--global',
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
