import type { LoadedSkill } from '../skills/types.ts'

export interface ExportOwnSkillLibraryInput {
  targetDirectory: string
  libraryName?: string
  skills: readonly LoadedSkill[]
  exportedAt?: number
}

export interface ExportOwnSkillLibraryRequest {
  targetDirectory: string
  favoriteKeys: string[]
  excludedKeys?: string[]
  workingDirectory?: string
}

export interface ExportOwnSkillLibraryResult {
  targetDirectory: string
  archivePath: string
  localSkills: string[]
  vendorSkills: string[]
  sources: string[]
  snapshots: string[]
  warnings: string[]
}

export interface OwnSkillLibraryManifest {
  schemaVersion: 1
  kind: 'boai-skill-library'
  name: string
  exportedAt: number
  skillsPath: 'skills'
  vendorPath: 'vendor'
  sourcesPath: 'sources'
}
