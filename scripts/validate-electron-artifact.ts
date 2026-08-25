#!/usr/bin/env bun

import { validateElectronArtifact } from './electron-artifact-report.ts'

const artifactPath = process.argv[2]
if (!artifactPath) {
  console.error('Usage: bun scripts/validate-electron-artifact.ts <unpacked-app>')
  process.exit(2)
}

const issues = validateElectronArtifact(artifactPath)
if (issues.length > 0) {
  console.error(`Electron artifact validation failed with ${issues.length} issue(s):`)
  for (const issue of issues) {
    console.error(`  [${issue.code}] ${issue.path}: ${issue.message}`)
  }
  process.exit(1)
}

console.log(`Electron artifact validation passed: ${artifactPath}`)
