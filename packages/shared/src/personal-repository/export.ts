import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs'
import { createHash } from 'crypto'
import { dirname, join, relative, resolve, sep } from 'path'
import { zipSync } from 'fflate'
import { collectDirectoryFiles, restoreFiles } from '../utils/bundle-files.ts'
import { REPOSITORY_CLI, renderRepositoryReadme } from './templates.ts'
import type {
  ExportOwnSkillLibraryInput,
  ExportOwnSkillLibraryResult,
  OwnSkillLibraryManifest,
} from './types.ts'

const SCHEMA_VERSION = 1
const SAFE_SEGMENT = /^[a-z0-9][a-z0-9._-]*$/i

interface GitSource {
  id: string
  type: 'git'
  url: string
}

interface VendorRepositoryMeta {
  source: GitSource
  skills: Map<string, string>
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function archiveFileName(libraryName?: string): string {
  const base = (libraryName?.trim() || 'BoAI Skills')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'boai-skills'
  return `${base}.zip`
}

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

function renderMetaTs(
  localSkills: readonly string[],
  snapshots: readonly string[],
  vendorRepositories: ReadonlyMap<string, VendorRepositoryMeta>,
): string {
  const lines = [
    'export interface VendorSkillMeta {',
    '  source: string',
    '  skillsPath?: string',
    '  skills: Record<string, string>',
    '}',
    '',
    'export const submodules: Record<string, string> = {}',
    '',
    'export const vendors: Record<string, VendorSkillMeta> = {',
  ]
  for (const [sourceId, repository] of [...vendorRepositories].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${tsString(sourceId)}: {`)
    lines.push(`    source: ${tsString(repository.source.url)},`)
    lines.push("    skillsPath: '.',")
    lines.push('    skills: {')
    for (const [sourcePath, slug] of [...repository.skills].sort(([a], [b]) => a.localeCompare(b))) {
      lines.push(`      ${tsString(sourcePath)}: ${tsString(slug)},`)
    }
    lines.push('    },')
    lines.push('  },')
  }
  lines.push('}')
  lines.push('')
  lines.push('export const manual = [')
  lines.push(...localSkills.map(slug => `  ${tsString(slug)},`))
  lines.push(']')
  lines.push('')
  lines.push('export const snapshots = [')
  lines.push(...snapshots.map(slug => `  ${tsString(slug)},`))
  lines.push(']')
  lines.push('')
  return lines.join('\n')
}

function renderGitmodules(vendorRepositories: ReadonlyMap<string, VendorRepositoryMeta>): string {
  const lines: string[] = []
  for (const [sourceId, repository] of [...vendorRepositories].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`[submodule "vendor/${sourceId}"]`)
    lines.push(`\tpath = vendor/${sourceId}`)
    lines.push(`\turl = ${repository.source.url}`)
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

function zipDirectory(directory: string): Uint8Array {
  const entries: Record<string, Uint8Array> = {}
  const walk = (currentDirectory: string): void => {
    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name === '.git') continue
      const fullPath = join(currentDirectory, entry.name)
      const archivePath = relative(directory, fullPath).split(sep).join('/')
      if (entry.isDirectory()) {
        entries[`${archivePath}/`] = new Uint8Array()
        walk(fullPath)
      } else if (entry.isFile()) {
        entries[archivePath] = readFileSync(fullPath)
      }
    }
  }
  walk(directory)
  return zipSync(entries, { level: 6 })
}

function checksumFiles(files: ReturnType<typeof collectDirectoryFiles>): string {
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(file.contentBase64)
    hash.update('\0')
  }
  return hash.digest('hex')
}

function safeSegment(value: string, label: string): string {
  if (!SAFE_SEGMENT.test(value)) throw new Error(`${label} is not portable: ${value}`)
  return value
}

function parseGitHubRepository(source?: string, sourceUrl?: string): { owner: string; repo: string } | null {
  const shorthand = source?.trim().replace(/\.git$/i, '')
  const shorthandMatch = shorthand?.match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i)
  if (shorthandMatch) return { owner: shorthandMatch[1]!, repo: shorthandMatch[2]! }

  if (!sourceUrl) return null
  try {
    const url = new URL(sourceUrl)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    const match = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
      .match(/^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i)
    return match ? { owner: match[1]!, repo: match[2]! } : null
  } catch {
    return null
  }
}

function portableSourcePath(skillPath: string | undefined, slug: string): string {
  const path = (skillPath || `skills/${slug}/SKILL.md`)
    .replace(/\\/g, '/')
    .replace(/\/SKILL\.md$/i, '')
    .replace(/^\.\//, '')
  if (!path || path.startsWith('/') || path.split('/').some(segment => segment === '..' || segment === '')) {
    throw new Error(`Skill source path is not portable: ${skillPath ?? ''}`)
  }
  return path
}

function validateTargetDirectory(targetDirectory: string): string {
  const target = resolve(targetDirectory)
  if (existsSync(target) && !statSync(target).isDirectory()) {
    throw new Error('The export destination must be a directory')
  }
  mkdirSync(target, { recursive: true })
  return target
}

export function exportOwnSkillLibrary(input: ExportOwnSkillLibraryInput): ExportOwnSkillLibraryResult {
  const targetDirectory = validateTargetDirectory(input.targetDirectory)
  const archivePath = join(targetDirectory, archiveFileName(input.libraryName))
  const exportedAt = input.exportedAt ?? Date.now()
  const stagingDirectory = mkdtempSync(join(dirname(targetDirectory), '.boai-skill-library-'))
  const localSkills: string[] = []
  const vendorSkills: string[] = []
  const snapshots: string[] = []
  const warnings: string[] = []
  const sources = new Map<string, GitSource>()
  const vendorRepositories = new Map<string, VendorRepositoryMeta>()
  const lockSkills: Record<string, {
    kind: 'local' | 'vendor'
    checksum?: string
    sourceId?: string
    revision?: string
    installedAt?: string
    updatedAt?: string
    snapshot?: boolean
  }> = {}

  try {
    const skillsDirectory = join(stagingDirectory, 'skills')
    mkdirSync(skillsDirectory, { recursive: true })
    mkdirSync(join(stagingDirectory, 'vendor'), { recursive: true })
    mkdirSync(join(stagingDirectory, 'sources'), { recursive: true })

    for (const skill of input.skills) {
      const slug = safeSegment(skill.slug, 'Skill slug')
      if (skill.source === 'workspace') {
        if (!existsSync(join(skill.path, 'SKILL.md'))) {
          throw new Error(`Skill "${skill.slug}" is missing SKILL.md`)
        }
        const files = collectDirectoryFiles(skill.path)
        restoreFiles(join(skillsDirectory, slug), files)
        localSkills.push(slug)
        lockSkills[`workspace:${slug}`] = {
          kind: 'local',
          checksum: checksumFiles(files),
        }
        continue
      }

      const management = skill.management
      const repository = management?.sourceType === 'github'
        ? parseGitHubRepository(management.source, management.sourceUrl)
        : null
      if (!management || !repository) {
        if (!existsSync(join(skill.path, 'SKILL.md'))) {
          throw new Error(`Skill "${skill.slug}" is missing SKILL.md`)
        }
        const files = collectDirectoryFiles(skill.path)
        restoreFiles(join(skillsDirectory, slug), files)
        vendorSkills.push(slug)
        snapshots.push(slug)
        warnings.push(`${slug} was exported as a snapshot because its original source cannot be reproduced.`)
        lockSkills[`${skill.source}:${slug}`] = {
          kind: 'vendor',
          checksum: checksumFiles(files),
          snapshot: true,
        }
        continue
      }

      const sourceId = safeSegment(`${repository.owner}-${repository.repo}`, 'Source id')
      const source = sources.get(sourceId) ?? {
        id: sourceId,
        type: 'git' as const,
        url: `https://github.com/${repository.owner}/${repository.repo}.git`,
      }
      sources.set(sourceId, source)

      const sourcePath = portableSourcePath(management.skillPath, slug)
      const files = collectDirectoryFiles(skill.path)
      restoreFiles(join(skillsDirectory, slug), files)
      const vendorRepository = vendorRepositories.get(sourceId) ?? {
        source,
        skills: new Map<string, string>(),
      }
      vendorRepository.skills.set(sourcePath, slug)
      vendorRepositories.set(sourceId, vendorRepository)
      mkdirSync(join(stagingDirectory, 'vendor', sourceId), { recursive: true })
      vendorSkills.push(slug)
      lockSkills[`${skill.source}:${slug}`] = {
        kind: 'vendor',
        sourceId,
        revision: management.revision,
        installedAt: management.installedAt,
        updatedAt: management.updatedAt,
      }
    }

    localSkills.sort((a, b) => a.localeCompare(b))
    vendorSkills.sort((a, b) => a.localeCompare(b))
    snapshots.sort((a, b) => a.localeCompare(b))
    const manifest: OwnSkillLibraryManifest = {
      schemaVersion: SCHEMA_VERSION,
      kind: 'boai-skill-library',
      name: input.libraryName?.trim() || 'My BoAI Skills',
      exportedAt,
      skillsPath: 'skills',
      vendorPath: 'vendor',
      sourcesPath: 'sources',
    }
    writeJson(join(stagingDirectory, 'boai.json'), manifest)
    writeJson(join(stagingDirectory, 'boai.lock.json'), {
      schemaVersion: SCHEMA_VERSION,
      exportedAt,
      skills: lockSkills,
    })
    const libraryName = input.libraryName?.trim() || 'My BoAI Skills'
    writeFileSync(join(stagingDirectory, 'README.md'), renderRepositoryReadme(libraryName))

    writeFileSync(join(stagingDirectory, '.gitignore'), 'node_modules/\n.DS_Store\n')
    writeFileSync(join(stagingDirectory, '.gitmodules'), renderGitmodules(vendorRepositories))
    writeFileSync(join(stagingDirectory, 'meta.ts'), renderMetaTs(localSkills, snapshots, vendorRepositories))
    writeJson(join(stagingDirectory, 'package.json'), {
      type: 'module',
      private: true,
      packageManager: 'pnpm@10.32.1',
      scripts: {
        start: 'node scripts/cli.ts',
        init: 'node scripts/cli.ts init',
        sync: 'node scripts/cli.ts sync',
        check: 'node scripts/cli.ts check',
        cleanup: 'node scripts/cli.ts cleanup',
      },
    })
    mkdirSync(join(stagingDirectory, 'scripts'), { recursive: true })
    writeFileSync(join(stagingDirectory, 'scripts', 'cli.ts'), REPOSITORY_CLI)
    mkdirSync(join(stagingDirectory, 'instructions'), { recursive: true })

    writeFileSync(archivePath, zipDirectory(stagingDirectory))

  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true })
  }

  return {
    targetDirectory,
    archivePath,
    localSkills,
    vendorSkills,
    sources: [...sources.keys()].sort((a, b) => a.localeCompare(b)),
    snapshots,
    warnings,
  }
}
