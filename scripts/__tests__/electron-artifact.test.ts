import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collectElectronArtifactReport,
  validateElectronArtifact,
} from '../electron-artifact-report.ts'

const tempDirs: string[] = []

function createMacArtifact(): string {
  const root = mkdtempSync(join(tmpdir(), 'boai-artifact-'))
  tempDirs.push(root)

  const appPath = join(root, 'BoAI.app')
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  const appRoot = join(resourcesPath, 'app')

  const files: Array<[string, string]> = [
    ['dist/main.cjs', 'main'],
    ['dist/skill-usage-worker.cjs', 'stats'],
    ['dist/renderer/index.html', '<html></html>'],
    ['dist/resources/pi-agent-server/index.js', 'pi'],
    ['node_modules/@vscode/ripgrep/bin/rg', 'rg'],
  ]

  for (const [relativePath, content] of files) {
    const destination = join(appRoot, relativePath)
    mkdirSync(join(destination, '..'), { recursive: true })
    writeFileSync(destination, content)
  }

  for (const [locale, content] of [['en.lproj', 'en-US.pak'], ['zh_CN.lproj', 'zh-CN.pak']]) {
    const destination = join(
      appPath,
      'Contents',
      'Frameworks',
      'Electron Framework.framework',
      'Versions',
      'A',
      'Resources',
      locale,
      'locale.pak',
    )
    mkdirSync(join(destination, '..'), { recursive: true })
    writeFileSync(destination, content)
  }

  return appPath
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('Electron artifact boundary', () => {
  test('accepts a packaged app with required runtimes and bilingual locales', () => {
    const artifactPath = createMacArtifact()

    expect(validateElectronArtifact(artifactPath)).toEqual([])
  })

  test('rejects source maps, bundled Bun, build-only resources, and unsupported locales', () => {
    const artifactPath = createMacArtifact()
    const appRoot = join(artifactPath, 'Contents', 'Resources', 'app')
    const resourcesPath = join(artifactPath, 'Contents', 'Resources')

    const forbiddenFiles = [
      join(appRoot, 'dist', 'renderer', 'index.js.map'),
      join(appRoot, 'vendor', 'bun', 'bun'),
      join(appRoot, 'dist', 'resources', 'dmg-background.png'),
      join(
        artifactPath,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources',
        'fr.lproj',
        'locale.pak',
      ),
    ]
    for (const filePath of forbiddenFiles) {
      mkdirSync(join(filePath, '..'), { recursive: true })
      writeFileSync(filePath, 'forbidden')
    }

    expect(validateElectronArtifact(artifactPath).map((issue) => issue.code).sort()).toEqual([
      'build-only-resource',
      'bundled-bun',
      'source-map',
      'unsupported-locale',
    ])
  })

  test('rejects the Claude Agent SDK runtime in a PI-only artifact', () => {
    const artifactPath = createMacArtifact()
    const claudeBinary = join(
      artifactPath,
      'Contents',
      'Resources',
      'app',
      'node_modules',
      '@anthropic-ai',
      'claude-agent-sdk-binary',
      'claude',
    )
    mkdirSync(join(claudeBinary, '..'), { recursive: true })
    writeFileSync(claudeBinary, 'forbidden')

    expect(validateElectronArtifact(artifactPath).map((issue) => issue.code)).toContain('claude-runtime')
  })

  test('rejects a packaged app when either supported locale is missing', () => {
    const artifactPath = createMacArtifact()
    rmSync(
      join(
        artifactPath,
        'Contents',
        'Frameworks',
        'Electron Framework.framework',
        'Versions',
        'A',
        'Resources',
        'zh_CN.lproj',
      ),
      { recursive: true },
    )

    expect(validateElectronArtifact(artifactPath).map((issue) => issue.code)).toContain('missing-locale')
  })

  test('rejects a packaged app when the Skill usage worker is missing', () => {
    const artifactPath = createMacArtifact()
    rmSync(
      join(
        artifactPath,
        'Contents',
        'Resources',
        'app',
        'dist',
        'skill-usage-worker.cjs',
      ),
    )

    expect(validateElectronArtifact(artifactPath)).toContainEqual(expect.objectContaining({
      code: 'missing-runtime',
      message: 'Skill usage worker is missing from the packaged app',
    }))
  })

  test('reports exact byte totals for the artifact and major categories', () => {
    const artifactPath = createMacArtifact()
    const mapPath = join(
      artifactPath,
      'Contents',
      'Resources',
      'app',
      'dist',
      'renderer',
      'index.js.map',
    )
    writeFileSync(mapPath, '1234567')

    const report = collectElectronArtifactReport(artifactPath)

    expect(report.categories.sourceMaps).toBe(7)
    expect(report.categories.bundledBun).toBe(0)
    expect(report.categories.claude).toBe(0)
    expect(report.totalBytes).toBe(51)
  })
})
