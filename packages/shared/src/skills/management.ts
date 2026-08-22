import { spawn } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { GLOBAL_AGENT_SKILLS_DIR, PROJECT_AGENT_SKILLS_DIR } from './storage.ts'
import type {
  LoadedSkill,
  SkillManagementInfo,
  SkillManagementResult,
  SkillManagementScope,
} from './types.ts'

const DEFAULT_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 1024 * 1024
const VALID_SKILL_SLUG = /^[a-z0-9][a-z0-9._-]*$/

export interface InstallManagedSkillInput {
  source: string
  slug: string
  scope: SkillManagementScope
  projectRoot?: string
  cwd?: string
}

export interface UpdateManagedSkillInput {
  slug: string
  scope: SkillManagementScope
  projectRoot?: string
  cwd?: string
}

export type UninstallManagedSkillInput = UpdateManagedSkillInput

interface SkillsCliRunOptions {
  cwd: string
  timeoutMs?: number
}

export type SkillsCliRunner = (
  args: string[],
  options: SkillsCliRunOptions,
) => Promise<SkillManagementResult>

export interface SkillsCliServiceOptions {
  globalSkillsDir?: string
  runner?: SkillsCliRunner
}

interface SkillLockEntry {
  source?: string
  sourceType?: string
  sourceUrl?: string
  skillPath?: string
  skillFolderHash?: string
  installedAt?: string
  updatedAt?: string
}

interface SkillLockFile {
  skills?: Record<string, SkillLockEntry>
}

export interface SkillManagementPaths {
  globalLockPath?: string
}

function safeCliEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP',
    'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'SSH_AUTH_SOCK',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
  ]

  const env: NodeJS.ProcessEnv = {}
  for (const key of allowed) {
    if (process.env[key] !== undefined) env[key] = process.env[key]
  }
  env.NO_COLOR = '1'
  return env
}

export const runSkillsCli: SkillsCliRunner = (args, options) => new Promise((resolve, reject) => {
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: safeCliEnvironment(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  let outputBytes = 0
  let settled = false

  const finishWithError = (error: Error) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    reject(error)
  }

  const appendOutput = (target: 'stdout' | 'stderr', chunk: Buffer) => {
    outputBytes += chunk.byteLength
    if (outputBytes > MAX_OUTPUT_BYTES) {
      child.kill()
      finishWithError(new Error('skills command produced too much output'))
      return
    }
    if (target === 'stdout') stdout += chunk.toString()
    else stderr += chunk.toString()
  }

  child.stdout.on('data', (chunk: Buffer) => appendOutput('stdout', chunk))
  child.stderr.on('data', (chunk: Buffer) => appendOutput('stderr', chunk))
  child.on('error', finishWithError)
  child.on('close', (code, signal) => {
    if (settled) return
    settled = true
    clearTimeout(timer)
    if (code === 0) {
      resolve({ stdout, stderr })
      return
    }
    const detail = stderr.trim() || stdout.trim() || `exit code ${code ?? 'unknown'}`
    reject(new Error(signal ? `skills command stopped by ${signal}: ${detail}` : `skills command failed: ${detail}`))
  })

  const timer = setTimeout(() => {
    child.kill()
    finishWithError(new Error('skills command timed out'))
  }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
})

export class SkillsCliService {
  private readonly globalSkillsDir: string
  private readonly runner: SkillsCliRunner

  constructor(options: SkillsCliServiceOptions = {}) {
    this.globalSkillsDir = options.globalSkillsDir ?? GLOBAL_AGENT_SKILLS_DIR
    this.runner = options.runner ?? runSkillsCli
  }

  async install(input: InstallManagedSkillInput): Promise<SkillManagementResult> {
    const source = input.source.trim()
    const slug = input.slug.trim()

    if (!source || source.startsWith('-')) {
      throw new Error('Enter a valid skill source')
    }
    if (!VALID_SKILL_SLUG.test(slug)) {
      throw new Error('Skill name can only contain lowercase letters, numbers, dots, dashes, and underscores')
    }
    if (input.scope === 'project' && !input.projectRoot) {
      throw new Error('Select a project before installing a project skill')
    }

    const targetDir = input.scope === 'global'
      ? join(this.globalSkillsDir, slug)
      : join(input.projectRoot!, PROJECT_AGENT_SKILLS_DIR, slug)
    if (existsSync(targetDir)) {
      throw new Error(`Skill "${slug}" already exists in ${input.scope} scope`)
    }

    const args = [
      '--yes',
      'skills',
      'add',
      source,
      '--skill',
      slug,
      '--agent',
      'universal',
      '--yes',
      '--copy',
    ]
    if (input.scope === 'global') args.push('--global')

    const result = await this.runner(args, {
      cwd: input.cwd ?? input.projectRoot ?? homedir(),
    })

    if (!existsSync(join(targetDir, 'SKILL.md'))) {
      throw new Error(`skills command completed but "${slug}" was not installed`)
    }
    return result
  }

  async update(input: UpdateManagedSkillInput): Promise<SkillManagementResult> {
    const slug = input.slug.trim()
    if (!VALID_SKILL_SLUG.test(slug)) {
      throw new Error('Enter a valid skill name')
    }
    if (input.scope === 'project' && !input.projectRoot) {
      throw new Error('Select a project before updating a project skill')
    }

    const targetDir = input.scope === 'global'
      ? join(this.globalSkillsDir, slug)
      : join(input.projectRoot!, PROJECT_AGENT_SKILLS_DIR, slug)
    if (!existsSync(join(targetDir, 'SKILL.md'))) {
      throw new Error(`Skill "${slug}" does not exist in ${input.scope} scope`)
    }

    const args = ['--yes', 'skills', 'update', slug]
    args.push(input.scope === 'global' ? '--global' : '--project', '--yes')
    const result = await this.runner(args, {
      cwd: input.cwd ?? input.projectRoot ?? homedir(),
    })

    if (!existsSync(join(targetDir, 'SKILL.md'))) {
      throw new Error(`Skill "${slug}" disappeared while updating`)
    }
    return result
  }

  async uninstall(input: UninstallManagedSkillInput): Promise<SkillManagementResult> {
    const slug = input.slug.trim()
    if (!VALID_SKILL_SLUG.test(slug)) {
      throw new Error('Enter a valid skill name')
    }
    if (input.scope === 'project' && !input.projectRoot) {
      throw new Error('Select a project before uninstalling a project skill')
    }

    const targetDir = input.scope === 'global'
      ? join(this.globalSkillsDir, slug)
      : join(input.projectRoot!, PROJECT_AGENT_SKILLS_DIR, slug)
    if (!existsSync(join(targetDir, 'SKILL.md'))) {
      throw new Error(`Skill "${slug}" does not exist in ${input.scope} scope`)
    }

    const args = ['--yes', 'skills', 'remove', slug]
    if (input.scope === 'global') args.push('--global')
    args.push('--yes')
    const result = await this.runner(args, {
      cwd: input.cwd ?? input.projectRoot ?? homedir(),
    })

    if (existsSync(join(targetDir, 'SKILL.md'))) {
      throw new Error(`skills command completed but "${slug}" is still installed`)
    }
    return result
  }
}

function normalizeSkillName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._]+/g, '-')
    .replace(/^[.\-]+|[.\-]+$/g, '')
    .slice(0, 255) || 'unnamed-skill'
}

function readLockEntries(path: string): Record<string, SkillLockEntry> {
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SkillLockFile
    return parsed && typeof parsed.skills === 'object' && parsed.skills ? parsed.skills : {}
  } catch {
    return {}
  }
}

function findLockEntry(
  entries: Record<string, SkillLockEntry>,
  slug: string,
): SkillLockEntry | undefined {
  if (entries[slug]) return entries[slug]
  const normalizedSlug = normalizeSkillName(slug)
  return Object.entries(entries).find(([name]) => normalizeSkillName(name) === normalizedSlug)?.[1]
}

function toManagementInfo(
  scope: SkillManagementScope,
  entry: SkillLockEntry,
): SkillManagementInfo {
  const canUpdate = scope === 'global'
    ? entry.sourceType === 'github' && !!entry.skillFolderHash && !!entry.skillPath
    : entry.sourceType !== 'local' && entry.sourceType !== 'node_modules' && !!entry.skillPath

  return {
    manager: 'skills-cli',
    scope,
    source: entry.source,
    sourceType: entry.sourceType,
    sourceUrl: entry.sourceUrl,
    skillPath: entry.skillPath,
    installedAt: entry.installedAt,
    updatedAt: entry.updatedAt,
    canUpdate,
  }
}

/** Add CLI provenance without changing Craft's existing skill precedence or ordering. */
export function annotateManagedSkills(
  skills: LoadedSkill[],
  projectRoot?: string,
  paths: SkillManagementPaths = {},
): LoadedSkill[] {
  const defaultGlobalLockPath = process.env.XDG_STATE_HOME
    ? join(process.env.XDG_STATE_HOME, 'skills', '.skill-lock.json')
    : join(dirname(GLOBAL_AGENT_SKILLS_DIR), '.skill-lock.json')
  const globalEntries = readLockEntries(paths.globalLockPath ?? defaultGlobalLockPath)
  const projectEntries = projectRoot
    ? readLockEntries(join(projectRoot, 'skills-lock.json'))
    : {}

  return skills.map(skill => {
    if (skill.source === 'workspace') return skill
    const entries = skill.source === 'global' ? globalEntries : projectEntries
    const entry = findLockEntry(entries, skill.slug)
    if (!entry) return skill
    return { ...skill, management: toManagementInfo(skill.source, entry) }
  })
}
