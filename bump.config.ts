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
  // bumpp executes strings directly, without a shell; run each check explicitly.
  execute: async () => {
    for (const args of [
      ['run', 'check-version'],
      ['install', '--lockfile-only', '--ignore-scripts'],
      ['install', '--frozen-lockfile', '--lockfile-only', '--ignore-scripts'],
    ]) {
      const child = Bun.spawn([process.execPath, ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
      const code = await child.exited
      if (code !== 0) throw new Error(`Release preparation failed: bun ${args.join(' ')}`)
    }
  },
  printCommits: true,
})
