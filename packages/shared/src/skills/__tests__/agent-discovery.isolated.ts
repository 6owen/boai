import { afterAll, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const originalCodexHome = process.env.CODEX_HOME
const originalClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR
const testRoot = mkdtempSync(join(tmpdir(), 'boai-agent-discovery-'))
const workspaceRoot = join(testRoot, 'workspace')
const codexHome = join(testRoot, 'home', '.codex')
const claudeConfigDir = join(testRoot, 'home', '.claude')

process.env.CODEX_HOME = codexHome
process.env.CLAUDE_CONFIG_DIR = claudeConfigDir
mkdirSync(join(workspaceRoot, 'skills'), { recursive: true })

function createSkill(skillsRoot: string, slug: string, name: string): void {
  const skillDir = join(skillsRoot, slug)
  mkdirSync(skillDir, { recursive: true })
  writeFileSync(join(skillDir, 'SKILL.md'), `---\nname: "${name}"\ndescription: "Test external Agent discovery"\n---\n\nInstructions.\n`)
}

const { invalidateSkillsCache, loadAllSkills, loadSkillBySlug } = await import('../storage.ts')
const { annotateManagedSkills } = await import('../management.ts')

afterAll(() => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = originalCodexHome
  if (originalClaudeConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = originalClaudeConfigDir
  rmSync(testRoot, { recursive: true, force: true })
})

describe('Agent skill discovery', () => {
  it('discovers skills stored only in Codex and Claude global directories without skills CLI', () => {
    createSkill(join(workspaceRoot, 'skills'), 'workspace-control', 'Workspace Control')
    createSkill(join(workspaceRoot, 'skills'), 'shared-slug', 'Workspace Winner')
    createSkill(join(codexHome, 'skills'), 'codex-only', 'Codex Only')
    createSkill(join(codexHome, 'skills'), 'shared-slug', 'Agent Loser')
    createSkill(join(claudeConfigDir, 'skills'), 'claude-only', 'Claude Only')
    invalidateSkillsCache()

    const skills = loadAllSkills(workspaceRoot)
    const annotatedSkills = annotateManagedSkills(skills)

    expect(skills.find(skill => skill.slug === 'workspace-control')).toBeDefined()
    expect(skills.find(skill => skill.slug === 'shared-slug')).toMatchObject({
      source: 'workspace',
      metadata: { name: 'Workspace Winner' },
    })
    expect(skills.find(skill => skill.slug === 'codex-only')?.source).toBe('agent')
    expect(skills.find(skill => skill.slug === 'codex-only')?.path)
      .toBe(join(codexHome, 'skills', 'codex-only'))
    expect(skills.find(skill => skill.slug === 'claude-only')?.source).toBe('agent')
    expect(skills.find(skill => skill.slug === 'claude-only')?.path)
      .toBe(join(claudeConfigDir, 'skills', 'claude-only'))
    expect(annotatedSkills.find(skill => skill.slug === 'codex-only')?.agentPlacements)
      .toContainEqual({ agentId: 'codex', agentName: 'Codex' })
    expect(annotatedSkills.find(skill => skill.slug === 'claude-only')?.agentPlacements)
      .toContainEqual({ agentId: 'claude-code', agentName: 'Claude Code' })
    expect(loadSkillBySlug(workspaceRoot, 'codex-only')?.path)
      .toBe(join(codexHome, 'skills', 'codex-only'))
  })

  it('discovers a Skill linked into an Agent directory', () => {
    const canonicalSkill = join(testRoot, 'shared-canonical', 'linked-skill')
    createSkill(join(testRoot, 'shared-canonical'), 'linked-skill', 'Linked Skill')
    const linkedSkill = join(codexHome, 'skills', 'linked-skill')
    mkdirSync(join(codexHome, 'skills'), { recursive: true })
    symlinkSync(canonicalSkill, linkedSkill, process.platform === 'win32' ? 'junction' : 'dir')
    invalidateSkillsCache()

    const skill = loadAllSkills(workspaceRoot).find(item => item.slug === 'linked-skill')

    expect(skill?.source).toBe('agent')
    expect(skill?.path).toBe(linkedSkill)
  })
})
