import { Glob } from 'bun'
import { readFile } from 'node:fs/promises'

interface PackageManifest {
  name?: string
  version?: string
}

async function readManifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, 'utf8')) as PackageManifest
}

const rootManifest = await readManifest('package.json')
const expectedVersion = rootManifest.version

if (!expectedVersion) {
  throw new Error('Root package.json does not declare a version')
}

const mismatches: string[] = []
const packageFiles = [...new Glob('{apps,packages}/*/package.json').scanSync('.')].sort()

for (const packageFile of packageFiles) {
  const manifest = await readManifest(packageFile)
  if (manifest.version !== expectedVersion) {
    mismatches.push(`${packageFile}: ${manifest.version ?? '<missing>'}`)
  }
}

if (mismatches.length > 0) {
  console.error(`Expected every workspace package to use version ${expectedVersion}:`)
  for (const mismatch of mismatches) console.error(`- ${mismatch}`)
  process.exit(1)
}

console.log(`Version ${expectedVersion} is consistent across ${packageFiles.length + 1} packages.`)
