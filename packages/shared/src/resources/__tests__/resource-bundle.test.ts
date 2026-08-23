import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportResources, importResources, validateResourceBundle } from '../resource-bundle.ts'
import type { ResourceBundle } from '../types.ts'
import type { FolderSourceConfig } from '../../sources/types.ts'

function createWorkspace(root: string, name = 'Test Workspace'): string {
  const workspaceRoot = join(root, name.replaceAll(' ', '-').toLowerCase())
  mkdirSync(join(workspaceRoot, 'sources'), { recursive: true })
  mkdirSync(join(workspaceRoot, 'skills'), { recursive: true })
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({ name }))
  return workspaceRoot
}

function createSource(workspaceRoot: string, slug: string): void {
  const sourceRoot = join(workspaceRoot, 'sources', slug)
  mkdirSync(sourceRoot, { recursive: true })
  const config: FolderSourceConfig = {
    id: `${slug}_id`,
    name: slug,
    slug,
    enabled: true,
    provider: 'custom',
    type: 'api',
    api: {
      baseUrl: 'https://api.example.com',
      authType: 'bearer',
      defaultHeaders: { Authorization: 'Bearer secret' },
    },
    isAuthenticated: true,
    connectionStatus: 'connected',
    lastTestedAt: Date.now(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  writeFileSync(join(sourceRoot, 'config.json'), JSON.stringify(config))
  writeFileSync(join(sourceRoot, 'guide.md'), `# ${slug}`)
  writeFileSync(join(sourceRoot, 'notes.txt'), 'portable notes')
}

function createSkill(workspaceRoot: string, slug: string): void {
  const skillRoot = join(workspaceRoot, 'skills', slug)
  mkdirSync(join(skillRoot, 'scripts'), { recursive: true })
  writeFileSync(join(skillRoot, 'SKILL.md'), `---\nname: ${slug}\ndescription: Test\n---\n`)
  writeFileSync(join(skillRoot, 'scripts', 'run.sh'), 'echo ok')
}

function bundleFile(relativePath: string, content: string) {
  const buffer = Buffer.from(content)
  return {
    relativePath,
    contentBase64: buffer.toString('base64'),
    size: buffer.length,
  }
}

describe('resource bundle', () => {
  let tempRoot: string

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'boai-resource-bundle-'))
  })

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true })
  })

  it('exports sanitized sources and all portable source files', () => {
    const workspaceRoot = createWorkspace(tempRoot)
    createSource(workspaceRoot, 'github')

    const { bundle, warnings } = exportResources(workspaceRoot, { sources: 'all' })
    const source = bundle.resources.sources?.[0]

    expect(bundle.sourceWorkspace).toBe('Test Workspace')
    expect(source?.slug).toBe('github')
    expect(source?.config.isAuthenticated).toBe(false)
    expect(source?.config.connectionStatus).toBe('needs_auth')
    expect(source?.config.lastTestedAt).toBeUndefined()
    expect(source?.config.api?.defaultHeaders).toBeUndefined()
    expect(source?.files.map((file) => file.relativePath).sort()).toEqual(['guide.md', 'notes.txt'])
    expect(warnings.some((warning) => warning.includes('defaultHeaders'))).toBe(true)
  })

  it('exports skills with auxiliary files and skips invalid skill folders', () => {
    const workspaceRoot = createWorkspace(tempRoot)
    createSkill(workspaceRoot, 'writer')
    mkdirSync(join(workspaceRoot, 'skills', 'broken'))

    const { bundle, warnings } = exportResources(workspaceRoot, { skills: 'all' })

    expect(bundle.resources.skills?.map((skill) => skill.slug)).toEqual(['writer'])
    expect(bundle.resources.skills?.[0]?.files.map((file) => file.relativePath).sort()).toEqual([
      'SKILL.md',
      'scripts/run.sh',
    ])
    expect(warnings.some((warning) => warning.includes("'broken' missing SKILL.md"))).toBe(true)
  })

  it('validates source and skill entries while rejecting unsafe file paths', () => {
    const valid: ResourceBundle = {
      version: 1,
      exportedAt: Date.now(),
      resources: {
        skills: [{ slug: 'writer', files: [bundleFile('SKILL.md', '# Writer')] }],
      },
    }
    expect(validateResourceBundle(valid)).toEqual({ valid: true, errors: [] })

    const unsafe: ResourceBundle = {
      ...valid,
      resources: {
        skills: [{ slug: 'writer', files: [bundleFile('../escape', 'bad')] }],
      },
    }
    const result = validateResourceBundle(unsafe)
    expect(result.valid).toBe(false)
    expect(result.errors.join(' ')).toContain('missing SKILL.md')
    expect(result.errors.join(' ')).toContain('traversal')
  })

  it('imports sources and skills and restores their content', async () => {
    const sourceRoot = createWorkspace(tempRoot, 'Source')
    const targetRoot = createWorkspace(tempRoot, 'Target')
    createSource(sourceRoot, 'github')
    createSkill(sourceRoot, 'writer')

    const { bundle } = exportResources(sourceRoot, { sources: 'all', skills: 'all' })
    const result = await importResources(targetRoot, bundle, 'skip', {
      clearSourceCredentials: async () => {},
    })

    expect(result.sources.imported).toEqual(['github'])
    expect(result.skills.imported).toEqual(['writer'])
    expect(result.warnings).toEqual([])
    expect(readFileSync(join(targetRoot, 'sources', 'github', 'notes.txt'), 'utf8')).toBe('portable notes')
    expect(readFileSync(join(targetRoot, 'skills', 'writer', 'scripts', 'run.sh'), 'utf8')).toBe('echo ok')
  })

  it('skips existing resources without touching them', async () => {
    const sourceRoot = createWorkspace(tempRoot, 'Source')
    const targetRoot = createWorkspace(tempRoot, 'Target')
    createSource(sourceRoot, 'github')
    createSkill(sourceRoot, 'writer')
    createSource(targetRoot, 'github')
    createSkill(targetRoot, 'writer')
    writeFileSync(join(targetRoot, 'sources', 'github', 'notes.txt'), 'keep source')
    writeFileSync(join(targetRoot, 'skills', 'writer', 'scripts', 'run.sh'), 'keep skill')

    const { bundle } = exportResources(sourceRoot, { sources: 'all', skills: 'all' })
    const result = await importResources(targetRoot, bundle, 'skip', {
      clearSourceCredentials: async () => {},
    })

    expect(result.sources.skipped).toEqual(['github'])
    expect(result.skills.skipped).toEqual(['writer'])
    expect(readFileSync(join(targetRoot, 'sources', 'github', 'notes.txt'), 'utf8')).toBe('keep source')
    expect(readFileSync(join(targetRoot, 'skills', 'writer', 'scripts', 'run.sh'), 'utf8')).toBe('keep skill')
  })

  it('overwrites resources atomically and clears source credentials', async () => {
    const sourceRoot = createWorkspace(tempRoot, 'Source')
    const targetRoot = createWorkspace(tempRoot, 'Target')
    createSource(sourceRoot, 'github')
    createSkill(sourceRoot, 'writer')
    createSource(targetRoot, 'github')
    createSkill(targetRoot, 'writer')
    writeFileSync(join(targetRoot, 'sources', 'github', 'stale.txt'), 'remove')
    writeFileSync(join(targetRoot, 'skills', 'writer', 'stale.txt'), 'remove')
    const cleared: string[] = []

    const { bundle } = exportResources(sourceRoot, { sources: 'all', skills: 'all' })
    const result = await importResources(targetRoot, bundle, 'overwrite', {
      clearSourceCredentials: async (_workspaceId, slug) => { cleared.push(slug) },
    })

    expect(result.sources.imported).toEqual(['github'])
    expect(result.skills.imported).toEqual(['writer'])
    expect(cleared).toEqual(['github'])
    expect(existsSync(join(targetRoot, 'sources', 'github', 'stale.txt'))).toBe(false)
    expect(existsSync(join(targetRoot, 'skills', 'writer', 'stale.txt'))).toBe(false)
  })
})
