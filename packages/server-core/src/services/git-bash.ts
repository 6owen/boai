import { stat } from 'fs/promises'
import { win32 } from 'path'

function getEnvValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const match = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return match?.[1]
}

/**
 * Build Git Bash candidates from normal Git for Windows locations and from Git
 * directories already exposed through PATH. The PATH-derived candidates cover
 * portable and custom installations where git.exe is available but bash.exe is
 * intentionally not placed on PATH.
 */
export function getGitBashCandidatePaths(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = new Set<string>()
  const programFiles = getEnvValue(env, 'ProgramFiles') || 'C:\\Program Files'
  const programFilesX86 = getEnvValue(env, 'ProgramFiles(x86)') || 'C:\\Program Files (x86)'
  const localAppData = getEnvValue(env, 'LOCALAPPDATA')

  roots.add(win32.join(programFiles, 'Git'))
  roots.add(win32.join(programFilesX86, 'Git'))
  if (localAppData) roots.add(win32.join(localAppData, 'Programs', 'Git'))

  const pathValue = getEnvValue(env, 'PATH') || ''
  for (const rawEntry of pathValue.split(';')) {
    const entry = rawEntry.trim().replace(/^"|"$/g, '')
    if (!entry) continue

    const leaf = win32.basename(entry).toLowerCase()
    if (leaf === 'cmd' || leaf === 'bin') {
      roots.add(win32.dirname(entry))
    }
  }

  const candidates: string[] = []
  const seen = new Set<string>()
  for (const root of roots) {
    for (const relativePath of [['bin', 'bash.exe'], ['usr', 'bin', 'bash.exe']]) {
      const candidate = win32.join(root, ...relativePath)
      const normalized = candidate.toLowerCase()
      if (seen.has(normalized)) continue
      seen.add(normalized)
      candidates.push(candidate)
    }
  }

  return candidates
}

/**
 * Basic file-name validation for Git Bash executable paths.
 * Accepts Windows-style and POSIX-style separators to support cross-platform tests.
 */
export function isGitBashExecutablePath(filePath: string): boolean {
  return /(?:^|[\\/])bash\.exe$/i.test(filePath.trim())
}

/**
 * Validate a user-provided Git Bash executable path.
 * Enforces bash.exe filename and existence on disk.
 */
export async function validateGitBashPath(filePath: string): Promise<{ valid: true; path: string } | { valid: false; error: string }> {
  const trimmedPath = filePath.trim()

  if (!isGitBashExecutablePath(trimmedPath)) {
    return { valid: false, error: 'Path must point to bash.exe' }
  }

  try {
    const info = await stat(trimmedPath)
    if (!info.isFile()) {
      return { valid: false, error: 'Path must point to a file' }
    }
    return { valid: true, path: trimmedPath }
  } catch {
    return { valid: false, error: 'File does not exist at the specified path' }
  }
}

/**
 * Check if a Git Bash path is usable without returning UI-facing errors.
 */
export async function isUsableGitBashPath(filePath: string): Promise<boolean> {
  const result = await validateGitBashPath(filePath)
  return result.valid
}
