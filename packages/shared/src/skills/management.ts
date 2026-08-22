import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { GLOBAL_AGENT_SKILLS_DIR, PROJECT_AGENT_SKILLS_DIR } from './storage.ts'
import type { SkillManagementResult, SkillManagementScope } from './types.ts'

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

function safeCliEnvironment(): NodeJS.ProcessEnv {
  const allowed = [
    'PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'TMP',
    'SystemRoot', 'COMSPEC', 'APPDATA', 'LOCALAPPDATA',
    'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'SSH_AUTH_SOCK',
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
}
