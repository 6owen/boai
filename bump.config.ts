import { defineConfig } from 'bumpp'

export default defineConfig({
  recursive: true,
  commit: 'chore: release {tag}',
  tag: 'v{version}',
  // scripts/release.ts pushes the current branch and the new tag explicitly.
  // Keeping bumpp's built-in push disabled prevents inherited local tags from
  // being uploaded to this fork.
  push: false,
  execute: 'bun run check-version',
  printCommits: true,
})
