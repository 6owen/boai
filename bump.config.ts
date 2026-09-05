import { defineConfig } from 'bumpp'

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
  execute: 'bun run check-version && bun install --lockfile-only --ignore-scripts && bun install --frozen-lockfile --lockfile-only --ignore-scripts',
  printCommits: true,
})
