/** Provider-neutral state shared by PI session tools and their host callbacks. */

import { getSessionPlansPath } from '../sessions/storage.ts'

const sessionPlanFilePaths = new Map<string, string>()

export function getLastPlanFilePath(sessionId: string): string | null {
  return sessionPlanFilePaths.get(sessionId) ?? null
}

export function setLastPlanFilePath(sessionId: string, path: string): void {
  sessionPlanFilePaths.set(sessionId, path)
}

export function clearPlanFileState(sessionId: string): void {
  sessionPlanFilePaths.delete(sessionId)
}

export function getSessionPlansDir(workspacePath: string, sessionId: string): string {
  return getSessionPlansPath(workspacePath, sessionId)
}

export function isPathInPlansDir(path: string, workspacePath: string, sessionId: string): boolean {
  return path.startsWith(getSessionPlansDir(workspacePath, sessionId))
}
