import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const repositoryRoot = join(import.meta.dir, '..', '..')
const forbiddenPackage = '@anthropic-ai/claude-agent-sdk'

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), 'utf8')
}

describe('PI-only dependency boundary', () => {
  test('does not declare the Claude Agent SDK in runtime manifests', () => {
    const manifests = [
      'package.json',
      'apps/electron/package.json',
      'packages/core/package.json',
      'packages/server-core/package.json',
      'packages/shared/package.json',
    ]

    for (const manifest of manifests) {
      const packageJson = JSON.parse(read(manifest)) as Record<string, Record<string, string> | undefined>
      for (const dependencyField of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
        expect(packageJson[dependencyField]?.[forbiddenPackage], `${manifest}:${dependencyField}`).toBeUndefined()
      }
    }
  })

  test('does not resolve or package the Claude Agent SDK', () => {
    const releaseInputs = [
      'bun.lock',
      'apps/electron/electron-builder.yml',
      'scripts/build-server.ts',
      'scripts/electron-build-main.ts',
      'scripts/electron-dev.ts',
      'scripts/build/common.ts',
      'scripts/build/darwin.ts',
      'scripts/build/linux.ts',
      'scripts/build/win32.ts',
    ]

    for (const input of releaseInputs) {
      expect(read(input), input).not.toContain(forbiddenPackage)
    }
  })
})
