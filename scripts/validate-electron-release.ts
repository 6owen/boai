#!/usr/bin/env bun

import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  collectElectronArtifactReport,
  validateElectronArtifact,
} from './electron-artifact-report.ts'

const rootDir = join(import.meta.dir, '..')
const releaseDir = join(rootDir, 'apps', 'electron', 'release')
const candidates = [
  ['mac-arm64', join(releaseDir, 'mac-arm64', 'BoAI.app')],
  ['mac-x64', join(releaseDir, 'mac', 'BoAI.app')],
  ['win-x64', join(releaseDir, 'win-unpacked')],
  ['linux', join(releaseDir, 'linux-unpacked')],
] as const

const artifacts = candidates.filter(([, artifactPath]) => existsSync(artifactPath))
if (artifacts.length === 0) {
  console.error(`No unpacked Electron artifact found under ${releaseDir}`)
  process.exit(2)
}

let failed = false
for (const [name, artifactPath] of artifacts) {
  const issues = validateElectronArtifact(artifactPath)
  if (issues.length > 0) {
    failed = true
    console.error(`Electron artifact validation failed for ${name}:`)
    for (const issue of issues) {
      console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`)
    }
    continue
  }

  const report = collectElectronArtifactReport(artifactPath)
  const reportPath = join(releaseDir, `artifact-report-${name}.json`)
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
  console.log(
    `Electron artifact ${name} passed: ${(report.totalBytes / 1024 / 1024).toFixed(2)} MiB (${report.fileCount} files)`,
  )
}

if (failed) process.exit(1)
