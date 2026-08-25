import type { SkillUsageRange, SkillUsageStats } from '@craft-agent/shared/skills'

export interface SkillUsageWorkerRequest {
  id: number
  workspaceRootPath: string
  range: SkillUsageRange
}

export type SkillUsageWorkerResponse =
  | {
      id: number
      ok: true
      stats: SkillUsageStats
    }
  | {
      id: number
      ok: false
      error: string
    }
