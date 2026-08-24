import { afterEach, describe, expect, test } from 'bun:test'
import { spawnSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { strFromU8, unzipSync } from 'fflate'
import { exportOwnSkillLibrary } from '../export.ts'
import type { LoadedSkill } from '../../skills/types.ts'

const tempDirs: string[] = []

function makeTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(directory)
  return directory
}

function localSkill(root: string, slug: string): LoadedSkill {
  const directory = join(root, slug)
  mkdirSync(join(directory, 'references'), { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${slug}\ndescription: Local test skill\n---\n\n# ${slug}\n`)
  writeFileSync(join(directory, 'references', 'guide.md'), '# Guide\n')
  return {
    slug,
    metadata: { name: slug, description: 'Local test skill' },
    content: `# ${slug}`,
    path: directory,
    source: 'workspace',
  }
}

function managedGitHubSkill(root: string, slug: string, skillPath: string): LoadedSkill {
  const directory = join(root, slug)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${slug}\ndescription: Managed test skill\n---\n`)
  return {
    slug,
    metadata: { name: slug, description: 'Managed test skill' },
    content: '',
    path: directory,
    source: 'global',
    management: {
      manager: 'skills-cli',
      scope: 'global',
      source: 'openai/skills',
      sourceType: 'github',
      sourceUrl: 'https://github.com/openai/skills.git',
      skillPath,
      revision: `${slug}-revision`,
      installedAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z',
      canUpdate: true,
    },
  }
}

function extractArchive(archivePath: string, targetDirectory: string): void {
  for (const [archiveEntry, content] of Object.entries(unzipSync(readFileSync(archivePath)))) {
    const targetPath = join(targetDirectory, archiveEntry)
    if (archiveEntry.endsWith('/')) {
      mkdirSync(targetPath, { recursive: true })
      continue
    }
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, content)
  }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('exportOwnSkillLibrary', () => {
  test('exports a zip containing a reusable repository scaffold and complete skill files', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')

    const result = exportOwnSkillLibrary({
      targetDirectory,
      libraryName: 'My BoAI Skills',
      skills: [localSkill(sourceRoot, 'local-writer')],
      exportedAt: 1_800_000_000_000,
    })

    expect(result.archivePath).toBe(join(targetDirectory, 'my-boai-skills.zip'))
    const files = unzipSync(readFileSync(result.archivePath))
    expect(Object.keys(files)).toContain('skills/local-writer/SKILL.md')
    expect(strFromU8(files['skills/local-writer/references/guide.md']!)).toBe('# Guide\n')
    expect(Object.keys(files)).toEqual(expect.arrayContaining([
      '.gitignore',
      '.gitmodules',
      'README.md',
      'boai.json',
      'boai.lock.json',
      'meta.ts',
      'package.json',
      'scripts/cli.ts',
    ]))
    expect(strFromU8(files['meta.ts']!)).toContain("export const manual = [\n  'local-writer',\n]")
    const packageJson = JSON.parse(strFromU8(files['package.json']!))
    expect(packageJson.scripts).toEqual({
      start: 'node scripts/cli.ts',
      init: 'node scripts/cli.ts init',
      sync: 'node scripts/cli.ts sync',
      check: 'node scripts/cli.ts check',
      cleanup: 'node scripts/cli.ts cleanup',
    })
    const cli = strFromU8(files['scripts/cli.ts']!)
    expect(cli).toContain('async function initRepository')
    expect(cli).toContain('async function syncSubmodules')
    expect(cli).toContain('async function checkUpdates')
    expect(cli).toContain('async function cleanup')
    const readme = strFromU8(files['README.md']!)
    expect(readme).toContain('这个技能仓库由 BoAI 导出')
    expect(readme).toContain('上游仓库不会在初始化时下载')
    expect(readme).toContain('pnpm run init')
    expect(readme).not.toContain('This Skill repository was exported by BoAI')
  })

  test('exports a workspace-authored skill as a complete local skill directory', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')

    const result = exportOwnSkillLibrary({
      targetDirectory,
      libraryName: 'My BoAI Skills',
      skills: [localSkill(sourceRoot, 'local-writer')],
      exportedAt: 1_800_000_000_000,
    })

    expect(result).toMatchObject({
      targetDirectory,
      localSkills: ['local-writer'],
      vendorSkills: [],
      sources: [],
      snapshots: [],
      warnings: [],
    })
    const files = unzipSync(readFileSync(result.archivePath))
    expect(strFromU8(files['skills/local-writer/SKILL.md']!)).toContain('name: local-writer')
    expect(strFromU8(files['skills/local-writer/references/guide.md']!)).toBe('# Guide\n')
    expect(Object.keys(files)).toContain('vendor/')
    expect(Object.keys(files)).toContain('sources/')
    expect(JSON.parse(strFromU8(files['boai.json']!))).toEqual({
      schemaVersion: 1,
      kind: 'boai-skill-library',
      name: 'My BoAI Skills',
      exportedAt: 1_800_000_000_000,
      skillsPath: 'skills',
      vendorPath: 'vendor',
      sourcesPath: 'sources',
    })
  })

  test('exports GitHub-managed favorites as vendors sharing one repository source', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')

    const result = exportOwnSkillLibrary({
      targetDirectory,
      skills: [
        managedGitHubSkill(sourceRoot, 'pdf', 'skills/pdf/SKILL.md'),
        managedGitHubSkill(sourceRoot, 'documents', 'skills/documents/SKILL.md'),
      ],
      exportedAt: 1_800_000_000_000,
    })

    expect(result).toMatchObject({
      localSkills: [],
      vendorSkills: ['documents', 'pdf'],
      sources: ['openai-skills'],
      snapshots: [],
      warnings: [],
    })
    const files = unzipSync(readFileSync(result.archivePath))
    expect(strFromU8(files['skills/pdf/SKILL.md']!)).toContain('name: pdf')
    expect(strFromU8(files['skills/documents/SKILL.md']!)).toContain('name: documents')
    expect(strFromU8(files['meta.ts']!)).toContain("'openai-skills': {")
    expect(strFromU8(files['meta.ts']!)).toContain("'skills/pdf': 'pdf'")
    expect(strFromU8(files['meta.ts']!)).toContain("'skills/documents': 'documents'")
    expect(strFromU8(files['.gitmodules']!)).toBe([
      '[submodule "vendor/openai-skills"]',
      '\tpath = vendor/openai-skills',
      '\turl = https://github.com/openai/skills.git',
      '',
    ].join('\n'))
    expect(Object.keys(files)).toContain('vendor/openai-skills/')
    expect(files['sources/openai-skills.json']).toBeUndefined()
    expect(files['vendor/pdf/vendor.json']).toBeUndefined()
  })

  test('initializes the exported repository without downloading upstream repositories', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')
    const extractedDirectory = makeTempDir('boai-library-extracted-')
    const fakeBinDirectory = makeTempDir('boai-library-bin-')
    const gitLogPath = join(fakeBinDirectory, 'git.log')
    const fakeGitPath = join(fakeBinDirectory, 'git')
    writeFileSync(fakeGitPath, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$BOAI_GIT_LOG"\n')
    chmodSync(fakeGitPath, 0o755)

    const result = exportOwnSkillLibrary({
      targetDirectory,
      skills: [managedGitHubSkill(sourceRoot, 'pdf', 'skills/pdf/SKILL.md')],
    })
    extractArchive(result.archivePath, extractedDirectory)

    const processResult = spawnSync(process.execPath, ['scripts/cli.ts', 'init'], {
      cwd: extractedDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        BOAI_GIT_LOG: gitLogPath,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
      },
    })

    expect(processResult.status).toBe(0)
    expect(processResult.stdout).toContain('未下载任何上游仓库')
    expect(readFileSync(gitLogPath, 'utf8').trim().split('\n')).toEqual(['init'])
    expect(existsSync(join(extractedDirectory, 'vendor', 'openai-skills', '.git'))).toBe(false)
  })

  test('syncs only declared skill paths through a temporary shallow sparse clone', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')
    const extractedDirectory = makeTempDir('boai-library-extracted-')
    const fakeBinDirectory = makeTempDir('boai-library-bin-')
    const gitLogPath = join(fakeBinDirectory, 'git.log')
    const fakeGitPath = join(fakeBinDirectory, 'git')
    writeFileSync(fakeGitPath, [
      '#!/bin/sh',
      'printf "%s\\n" "$*" >> "$BOAI_GIT_LOG"',
      'if [ "$1" = "clone" ]; then',
      '  for argument in "$@"; do repository_directory="$argument"; done',
      '  mkdir -p "$repository_directory/skills/pdf"',
      '  printf "%s\\n" "upstream sparse skill" > "$repository_directory/skills/pdf/SKILL.md"',
      'fi',
      'if [ "$1" = "rev-parse" ]; then printf "%s\\n" "fake-revision"; fi',
      '',
    ].join('\n'))
    chmodSync(fakeGitPath, 0o755)

    const result = exportOwnSkillLibrary({
      targetDirectory,
      skills: [managedGitHubSkill(sourceRoot, 'pdf', 'skills/pdf/SKILL.md')],
    })
    extractArchive(result.archivePath, extractedDirectory)

    const processResult = spawnSync(process.execPath, ['scripts/cli.ts', 'sync'], {
      cwd: extractedDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        BOAI_GIT_LOG: gitLogPath,
        PATH: `${fakeBinDirectory}:${process.env.PATH ?? ''}`,
      },
    })

    expect(processResult.status).toBe(0)
    const gitLog = readFileSync(gitLogPath, 'utf8')
    expect(gitLog).toContain('clone --depth 1 --filter=blob:none --sparse https://github.com/openai/skills.git')
    expect(gitLog).toContain('sparse-checkout set --cone skills/pdf')
    expect(readFileSync(join(extractedDirectory, 'skills', 'pdf', 'SKILL.md'), 'utf8')).toBe('upstream sparse skill\n')
    expect(processResult.stdout).toContain('临时上游仓库已清理')
    expect(existsSync(join(extractedDirectory, 'vendor', 'openai-skills', '.git'))).toBe(false)
  })

  test('preserves an unmanaged third-party favorite as an offline vendor snapshot', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')
    const skill = localSkill(sourceRoot, 'offline-helper')
    skill.source = 'global'

    const result = exportOwnSkillLibrary({
      targetDirectory,
      skills: [skill],
      exportedAt: 1_800_000_000_000,
    })

    expect(result).toMatchObject({
      localSkills: [],
      vendorSkills: ['offline-helper'],
      sources: [],
      snapshots: ['offline-helper'],
    })
    expect(result.warnings).toEqual([
      'offline-helper was exported as a snapshot because its original source cannot be reproduced.',
    ])
    const files = unzipSync(readFileSync(result.archivePath))
    expect(strFromU8(files['skills/offline-helper/references/guide.md']!)).toBe('# Guide\n')
    expect(strFromU8(files['meta.ts']!)).toContain("export const snapshots = [\n  'offline-helper',\n]")
    expect(files['vendor/offline-helper/vendor.json']).toBeUndefined()
  })

  test('writes one zip into the selected directory without modifying unrelated files', () => {
    const sourceRoot = makeTempDir('boai-library-source-')
    const targetDirectory = makeTempDir('boai-library-export-')
    writeFileSync(join(targetDirectory, 'important.txt'), 'keep me')

    const result = exportOwnSkillLibrary({
      targetDirectory,
      skills: [localSkill(sourceRoot, 'local-writer')],
    })

    expect(readFileSync(join(targetDirectory, 'important.txt'), 'utf8')).toBe('keep me')
    expect(existsSync(result.archivePath)).toBe(true)
    expect(existsSync(join(targetDirectory, 'boai.json'))).toBe(false)
  })
})
