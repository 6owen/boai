import { readFile } from 'node:fs/promises'

interface PackageManifest {
  version?: string
}

async function run(command: string, args: string[]): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const output = await new Response(child.stdout).text()
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
  return output.trim()
}

const branch = await run('git', ['branch', '--show-current'])
if (branch !== 'main') {
  throw new Error(`Releases must be created from main, not ${branch || 'detached HEAD'}`)
}
if (await run('git', ['status', '--porcelain'])) {
  throw new Error('Commit all changes before releasing. The release commit must contain only version and lockfile updates.')
}

const forwardedArgs = Bun.argv.slice(2).filter(arg => arg !== '--')
const bumpp = Bun.spawn(['bunx', 'bumpp', ...forwardedArgs], {
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})

const bumpExitCode = await bumpp.exited
if (bumpExitCode !== 0) process.exit(bumpExitCode)

const manifest = JSON.parse(await readFile('package.json', 'utf8')) as PackageManifest
if (!manifest.version) throw new Error('Root package.json does not declare a version')

const tag = `v${manifest.version}`
const headCommit = await run('git', ['rev-parse', 'HEAD'])
const tagCommit = await run('git', ['rev-parse', `${tag}^{}`])
if (tagCommit !== headCommit) {
  throw new Error(`${tag} does not point to the release commit`)
}

await run('git', ['push', 'origin', 'HEAD:main'])
await run('git', ['push', 'origin', `refs/tags/${tag}:refs/tags/${tag}`])
console.log(`Published ${tag} to origin without pushing unrelated tags.`)
