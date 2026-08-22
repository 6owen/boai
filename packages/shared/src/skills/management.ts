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
  SkillUpdateCheckResult,
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

export interface CheckManagedSkillUpdatesInput {
  scope: SkillManagementScope
  slugs?: string[]
  projectRoot?: string
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
  globalLockPath?: string
  runner?: SkillsCliRunner
  treeFetcher?: SkillsTreeFetcher
}

interface SkillLockEntry {
  source?: string
  sourceType?: string
  sourceUrl?: string
  skillPath?: string
  skillFolderHash?: string
  ref?: string
  installedAt?: string
  updatedAt?: string
}

interface SkillLockFile {
  skills?: Record<string, SkillLockEntry>
}

export interface SkillManagementPaths {
  globalLockPath?: string
}

export interface SkillsSourceTree {
  rootHash: string
  folders: Record<string, string>
}

export type SkillsTreeFetcher = (
  ownerRepo: string,
  ref?: string,
) => Promise<SkillsSourceTree | null>

interface GitHubTreeResponse {
  sha?: string
  tree?: Array<{ path?: string; type?: string; sha?: string }>
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

function runGitHubApi(endpoint: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('gh', ['api', endpoint, '--method', 'GET'], {
      env: { ...safeCliEnvironment(), GH_PROMPT_DISABLED: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    let bytes = 0
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(stdout)
    }
    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      bytes += chunk.byteLength
      if (bytes > 50 * 1024 * 1024) {
        child.kill()
        finish(new Error('GitHub tree response was too large'))
        return
      }
      if (target === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
    }

    child.stdout.on('data', (chunk: Buffer) => append('stdout', chunk))
    child.stderr.on('data', (chunk: Buffer) => append('stderr', chunk))
    child.on('error', finish)
    child.on('close', code => {
      if (code === 0) finish()
      else finish(new Error(stderr.trim() || `gh exited with code ${code ?? 'unknown'}`))
    })
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('GitHub update check timed out'))
    }, 30_000)
  })
}

function parseSourceTree(raw: string): SkillsSourceTree | null {
  try {
    const response = JSON.parse(raw) as GitHubTreeResponse
    if (!response.sha || !Array.isArray(response.tree)) return null
    const folders: Record<string, string> = {}
    for (const entry of response.tree) {
      if (entry.type === 'tree' && entry.path && entry.sha) folders[entry.path] = entry.sha
    }
    return { rootHash: response.sha, folders }
  } catch {
    return null
  }
}

async function fetchGitHubTree(ownerRepo: string, ref?: string): Promise<SkillsSourceTree | null> {
  const branches = ref ? [ref] : ['HEAD', 'main', 'master']
  for (const branch of branches) {
    const endpoint = `repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`
    try {
      const tree = parseSourceTree(await runGitHubApi(endpoint))
      if (tree) return tree
    } catch {
      // Fall through to the token/anonymous HTTP request.
    }

    try {
      const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN
      const response = await fetch(`https://api.github.com/${endpoint}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'craft-agents',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: AbortSignal.timeout(30_000),
      })
      if (!response.ok) continue
      const tree = parseSourceTree(await response.text())
      if (tree) return tree
    } catch {
      // Try the next conventional branch name.
    }
  }
  return null
}

function githubOwnerRepo(entry: SkillLockEntry): string | null {
  const shorthand = entry.source?.replace(/\.git$/i, '')
  if (shorthand && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(shorthand)) return shorthand
  if (!entry.sourceUrl) return null
  try {
    const url = new URL(entry.sourceUrl)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    const path = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '')
    return /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(path) ? path : null
  } catch {
    return null
  }
}

function skillFolderPath(skillPath: string): string {
  const normalized = skillPath.replace(/\\/g, '/')
  const slash = normalized.lastIndexOf('/')
  return slash === -1 ? '' : normalized.slice(0, slash)
}

export class SkillsCliService {
  private readonly globalSkillsDir: string
  private readonly globalLockPath: string
  private readonly runner: SkillsCliRunner
  private readonly treeFetcher: SkillsTreeFetcher

  constructor(options: SkillsCliServiceOptions = {}) {
    this.globalSkillsDir = options.globalSkillsDir ?? GLOBAL_AGENT_SKILLS_DIR
    const defaultGlobalLockPath = process.env.XDG_STATE_HOME
      ? join(process.env.XDG_STATE_HOME, 'skills', '.skill-lock.json')
      : join(dirname(this.globalSkillsDir), '.skill-lock.json')
    this.globalLockPath = options.globalLockPath ?? defaultGlobalLockPath
    this.runner = options.runner ?? runSkillsCli
    this.treeFetcher = options.treeFetcher ?? fetchGitHubTree
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

  async checkUpdates(input: CheckManagedSkillUpdatesInput): Promise<SkillUpdateCheckResult> {
    if (input.scope === 'project' && !input.projectRoot) {
      throw new Error('Select a project before checking project skill updates')
    }

    const entries = readLockEntries(input.scope === 'global'
      ? this.globalLockPath
      : join(input.projectRoot!, 'skills-lock.json'))
    const requested = input.slugs?.map(normalizeSkillName)
    const selected = Object.entries(entries).filter(([name]) =>
      !requested || requested.includes(normalizeSkillName(name)))

    const groups = new Map<string, Array<{ slug: string; entry: SkillLockEntry }>>()
    let skippedCount = 0
    for (const [name, entry] of selected) {
      const ownerRepo = entry.sourceType === 'github' ? githubOwnerRepo(entry) : null
      if (!ownerRepo || !entry.skillFolderHash || !entry.skillPath) {
        skippedCount++
        continue
      }
      const key = `${ownerRepo}\n${entry.ref ?? ''}`
      const group = groups.get(key) ?? []
      group.push({ slug: normalizeSkillName(name), entry })
      groups.set(key, group)
    }

    const groupEntries = [...groups.entries()]
    const updates: SkillUpdateCheckResult['updates'] = []
    let checkedCount = 0
    const concurrency = 6
    for (let index = 0; index < groupEntries.length; index += concurrency) {
      await Promise.all(groupEntries.slice(index, index + concurrency).map(async ([key, skills]) => {
        const [ownerRepo, ref] = key.split('\n')
        const tree = await this.treeFetcher(ownerRepo!, ref || undefined)
        if (!tree) {
          skippedCount += skills.length
          return
        }
        for (const { slug, entry } of skills) {
          const folderPath = skillFolderPath(entry.skillPath!)
          const latestHash = folderPath ? tree.folders[folderPath] : tree.rootHash
          if (!latestHash) {
            skippedCount++
            continue
          }
          checkedCount++
          if (latestHash.toLowerCase() !== entry.skillFolderHash!.toLowerCase()) {
            updates.push({ slug, scope: input.scope })
          }
        }
      }))
    }

    updates.sort((a, b) => a.slug.localeCompare(b.slug))
    return { updates, checkedCount, skippedCount }
  }

  async updateAllGlobal(cwd = homedir()): Promise<SkillManagementResult> {
    return this.runner(
      ['--yes', 'skills', 'update', '--global', '--yes'],
      { cwd },
    )
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
