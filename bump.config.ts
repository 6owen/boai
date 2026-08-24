import { defineConfig } from 'bumpp'

export default defineConfig({
  recursive: true,
  commit: 'chore: release {tag}',
  tag: 'v{version}',
  push: true,
  execute: 'bun run check-version',
  printCommits: true,
})
