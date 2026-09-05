import { defineConfig } from 'bumpp'
import { execFileSync } from 'node:child_process'

export default defineConfig({
  recursive: true,
  // release.ts requires a clean tree first. Include the refreshed Bun lockfile
  // in the same commit as the workspace version changes.
  all: true,
  commit: 'chore: release {tag}',
  tag: 'v{version}',
  // scripts/release.ts pushes the current branch and the new tag explicitly.
  // Keeping bumpp's built-in push disabled prevents inherited local tags from
  // being uploaded to this fork.
  push: false,
  // bumpp executes strings directly, without a shell; run each check explicitly.
  execute: () => {
    for (const args of [
      ['run', 'check-version'],
      ['install', '--lockfile-only', '--ignore-scripts'],
      ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'],
    ]) {
      execFileSync('bun', args, { stdio: 'inherit' })
    }
  },
  printCommits: true,
})
