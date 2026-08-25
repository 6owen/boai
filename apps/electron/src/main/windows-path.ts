import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

type WindowsEnvironment = Record<string, string | undefined>
type PathExists = (path: string) => boolean

const WINDOWS_PATH_REGISTRY_KEYS = [
  'HKCU\\Environment',
  'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
] as const

function getEnvironmentValue(env: WindowsEnvironment, key: string): string | undefined {
  const direct = env[key]
  if (direct) return direct
  const normalizedKey = key.toUpperCase()
  const match = Object.keys(env).find(candidate => candidate.toUpperCase() === normalizedKey)
  return match ? env[match] : undefined
}

function expandWindowsEnvironment(value: string, env: WindowsEnvironment): string {
  return value.replace(/%([^%]+)%/g, (token, key: string) => (
    getEnvironmentValue(env, key) ?? token
  ))
}

/** Parse the Path value printed by `reg.exe query ... /v Path`. */
export function parseWindowsRegistryPath(
  output: string,
  env: WindowsEnvironment,
): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/i)
    if (match?.[1]) return expandWindowsEnvironment(match[1], env)
  }
  return undefined
}

/** Merge semicolon-delimited Windows PATH values while preserving priority. */
export function mergeWindowsPath(currentPath: string, additions: readonly string[]): string {
  const entries = [
    ...currentPath.split(';'),
    ...additions.flatMap(entry => entry.split(';')),
  ]
    .map(entry => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)

  const seen = new Set<string>()
  return entries.filter((entry) => {
    const key = entry.replace(/[\\/]+$/, '').toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).join(';')
}

/** Common user- and machine-level locations that GUI apps often miss. */
export function getCommonWindowsPathEntries(
  env: WindowsEnvironment,
  pathExists: PathExists = existsSync,
): string[] {
  const programFiles = getEnvironmentValue(env, 'ProgramFiles') ?? 'C:\\Program Files'
  const programFilesX86 = getEnvironmentValue(env, 'ProgramFiles(x86)') ?? 'C:\\Program Files (x86)'
  const localAppData = getEnvironmentValue(env, 'LOCALAPPDATA')
  const userProfile = getEnvironmentValue(env, 'USERPROFILE')
  const chocolateyInstall = getEnvironmentValue(env, 'ChocolateyInstall')

  return [
    win32.join(programFiles, 'Git', 'cmd'),
    win32.join(programFilesX86, 'Git', 'cmd'),
    localAppData ? win32.join(localAppData, 'Programs', 'Git', 'cmd') : undefined,
    localAppData ? win32.join(localAppData, 'Microsoft', 'WinGet', 'Links') : undefined,
    userProfile ? win32.join(userProfile, 'scoop', 'shims') : undefined,
    chocolateyInstall ? win32.join(chocolateyInstall, 'bin') : undefined,
  ].filter((entry): entry is string => Boolean(entry && pathExists(entry)))
}

function readRegistryPaths(env: WindowsEnvironment): string[] {
  const paths: string[] = []
  for (const key of WINDOWS_PATH_REGISTRY_KEYS) {
    try {
      const output = execFileSync('reg.exe', ['query', key, '/v', 'Path'], {
        encoding: 'utf8',
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 3000,
      })
      const path = parseWindowsRegistryPath(output, env)
      if (path) paths.push(path)
    } catch {
      // A missing registry value must not prevent application startup.
    }
  }
  return paths
}

export interface ResolvedWindowsPath {
  path: string
  addedEntries: string[]
  gitExecutable?: string
}

/** Resolve the fresh user/machine PATH instead of relying on Explorer's stale copy. */
export function resolveWindowsPath(
  env: WindowsEnvironment = process.env,
): ResolvedWindowsPath {
  const currentPath = getEnvironmentValue(env, 'PATH') ?? ''
  const registryPaths = readRegistryPaths(env)
  const commonPaths = getCommonWindowsPathEntries(env)
  const addedEntries = [...registryPaths, ...commonPaths]
  const path = mergeWindowsPath(currentPath, addedEntries)
  const childEnv = { ...env }
  const childPathKey = Object.keys(childEnv).find(key => key.toUpperCase() === 'PATH') ?? 'PATH'
  childEnv[childPathKey] = path

  try {
    const output = execFileSync('where.exe', ['git.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
      env: childEnv,
    })
    const gitExecutable = output.split(/\r?\n/).map(line => line.trim()).find(Boolean)
    return { path, addedEntries, ...(gitExecutable ? { gitExecutable } : {}) }
  } catch {
    return { path, addedEntries }
  }
}
