import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { annotateSkillAgentPlacements } from '../agent-placements.ts'
import type { LoadedSkill } from '../types.ts'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'craft-skill-agent-placements-'))
  tempDirs.push(dir)
  return dir
}

function writeSkill(directory: string, content = '# Example skill'): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), content)
}

function loadedSkill(path: string, source: LoadedSkill['source'] = 'global'): LoadedSkill {
  return {
    slug: 'example',
    metadata: { name: 'Example', description: 'Example skill' },
    content: '# Example skill',
    path,
    source,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('annotateSkillAgentPlacements', () => {
  test('includes direct and native inherited Agents that are installed', () => {
    const home = makeTempDir()
    const config = join(home, '.config')
    const skillPath = join(home, '.agents', 'skills', 'example')
    writeSkill(skillPath)
    mkdirSync(join(home, '.codex'), { recursive: true })
    mkdirSync(join(home, '.cline'), { recursive: true })
    mkdirSync(join(config, 'opencode'), { recursive: true })

    const result = annotateSkillAgentPlacements(
      [loadedSkill(skillPath)],
      undefined,
      { homeDir: home, configDir: config },
    )[0]!

    expect(result.agentPlacements).toContainEqual({
      agentId: 'cline',
      agentName: 'Cline',
    })
    expect(result.agentPlacements).toContainEqual({
      agentId: 'codex',
      agentName: 'Codex',
      isInherited: true,
      inheritedFromAgentId: 'codex',
    })
    expect(result.agentPlacements).toContainEqual({
      agentId: 'opencode',
      agentName: 'OpenCode',
      isInherited: true,
      inheritedFromAgentId: 'codex',
    })
  })

  test('does not mark an Agent when only a different same-slug skill exists', () => {
    const home = makeTempDir()
    const config = join(home, '.config')
    const skillPath = join(home, '.agents', 'skills', 'example')
    writeSkill(skillPath, '# Canonical content')
    writeSkill(join(home, '.cursor', 'skills', 'example'), '# Different content')

    const result = annotateSkillAgentPlacements(
      [loadedSkill(skillPath)],
      undefined,
      { homeDir: home, configDir: config },
    )[0]!

    expect(result.agentPlacements?.some(placement => placement.agentId === 'cursor')).toBe(false)
  })

  test('keeps Craft workspace skills private even when a global slug matches', () => {
    const home = makeTempDir()
    const config = join(home, '.config')
    const workspaceSkillPath = join(home, 'workspace', 'skills', 'example')
    writeSkill(workspaceSkillPath)
    writeSkill(join(home, '.agents', 'skills', 'example'))
    mkdirSync(join(home, '.cline'), { recursive: true })

    const result = annotateSkillAgentPlacements(
      [loadedSkill(workspaceSkillPath, 'workspace')],
      undefined,
      { homeDir: home, configDir: config },
    )[0]!

    expect(result.agentPlacements).toEqual([])
  })
})
