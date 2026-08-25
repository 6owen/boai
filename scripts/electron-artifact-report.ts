#!/usr/bin/env bun

import {
  existsSync,
  lstatSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { join, relative, sep } from 'node:path'

export interface ArtifactSizeEntry {
  path: string
  bytes: number
}

export interface ElectronArtifactReport {
  artifactPath: string
  totalBytes: number
  fileCount: number
  categories: {
    frameworks: number
    claude: number
    bundledBun: number
    sourceMaps: number
    locales: number
    renderer: number
    main: number
    piAgentServer: number
    runtimeResources: number
  }
  largestFiles: ArtifactSizeEntry[]
  largestDirectories: ArtifactSizeEntry[]
}

export interface ArtifactValidationIssue {
  code:
    | 'build-only-resource'
    | 'bundled-bun'
    | 'missing-locale'
    | 'missing-runtime'
    | 'raw-source'
    | 'source-map'
    | 'test-artifact'
    | 'unsupported-locale'
  path: string
  message: string
}

interface ArtifactFile {
  absolutePath: string
  relativePath: string
  bytes: number
}

function toPosix(path: string): string {
  return path.split(sep).join('/')
}

function walkFiles(rootPath: string): ArtifactFile[] {
  const files: ArtifactFile[] = []
  const pending = [rootPath]

  while (pending.length > 0) {
    const currentPath = pending.pop()!
    for (const entry of readdirSync(currentPath, { withFileTypes: true })) {
      const absolutePath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }

      const stats = lstatSync(absolutePath)
      files.push({
        absolutePath,
        relativePath: toPosix(relative(rootPath, absolutePath)),
        bytes: stats.isSymbolicLink() ? 0 : stats.size,
      })
    }
  }

  return files
}

function addDirectorySizes(files: ArtifactFile[]): ArtifactSizeEntry[] {
  const sizes = new Map<string, number>()

  for (const file of files) {
    const parts = file.relativePath.split('/')
    for (let i = 1; i < parts.length; i++) {
      const directory = parts.slice(0, i).join('/')
      sizes.set(directory, (sizes.get(directory) ?? 0) + file.bytes)
    }
  }

  return [...sizes.entries()]
    .map(([path, bytes]) => ({ path, bytes }))
    .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
    .slice(0, 20)
}

function sumMatching(files: ArtifactFile[], predicate: (path: string) => boolean): number {
  return files.reduce(
    (total, file) => total + (predicate(file.relativePath) ? file.bytes : 0),
    0,
  )
}

function formatMiB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`
}

export function collectElectronArtifactReport(artifactPath: string): ElectronArtifactReport {
  if (!existsSync(artifactPath) || !lstatSync(artifactPath).isDirectory()) {
    throw new Error(`Electron unpacked artifact directory not found: ${artifactPath}`)
  }

  const files = walkFiles(artifactPath)
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0)

  return {
    artifactPath,
    totalBytes,
    fileCount: files.length,
    categories: {
      frameworks: sumMatching(files, (path) => path.startsWith('Contents/Frameworks/')),
      claude: sumMatching(files, (path) => path.includes('/@anthropic-ai/claude-agent-sdk')),
      bundledBun: sumMatching(files, (path) => /(^|\/)vendor\/bun\/(bun|bun\.exe)$/.test(path)),
      sourceMaps: sumMatching(files, (path) => path.endsWith('.map')),
      locales: sumMatching(files, (path) => /(^|\/)locales\/[^/]+\.pak$/.test(path) || path.includes('.lproj/')),
      renderer: sumMatching(files, (path) => path.includes('/dist/renderer/')),
      main: sumMatching(files, (path) => path.endsWith('/dist/main.cjs')),
      piAgentServer: sumMatching(files, (path) => path.includes('/pi-agent-server/')),
      runtimeResources: sumMatching(files, (path) => path.includes('/dist/resources/')),
    },
    largestFiles: files
      .map(({ relativePath: path, bytes }) => ({ path, bytes }))
      .sort((a, b) => b.bytes - a.bytes || a.path.localeCompare(b.path))
      .slice(0, 20),
    largestDirectories: addDirectorySizes(files),
  }
}

function findAppRoot(artifactPath: string): string | undefined {
  const macAppRoot = join(artifactPath, 'Contents', 'Resources', 'app')
  if (existsSync(macAppRoot)) return macAppRoot

  const unpackedAppRoot = join(artifactPath, 'resources', 'app')
  if (existsSync(unpackedAppRoot)) return unpackedAppRoot

  if (existsSync(join(artifactPath, 'dist', 'main.cjs'))) return artifactPath
  return undefined
}

function isAllowedLproj(name: string): boolean {
  return name === 'Base.lproj'
    || name === 'en.lproj'
    || name === 'zh_CN.lproj'
}

function buildOnlyResource(path: string): boolean {
  if (!/(^|\/)app\/(?:dist\/)?resources\//.test(path)) return false

  return /(^|\/)(?:AGENTS\.md|Assets\.car|generate-icons\.sh)$/.test(path)
    || /(^|\/)dmg-background(?:@2x)?\.(?:png|tiff)$/.test(path)
    || /(^|\/)icon\.icon\//.test(path)
    || /(^|\/)icon\.(?:icns|ico|png|svg)$/.test(path)
}

export function validateElectronArtifact(artifactPath: string): ArtifactValidationIssue[] {
  if (!existsSync(artifactPath) || !lstatSync(artifactPath).isDirectory()) {
    throw new Error(`Electron unpacked artifact directory not found: ${artifactPath}`)
  }

  const files = walkFiles(artifactPath)
  const issues: ArtifactValidationIssue[] = []

  for (const file of files) {
    const path = file.relativePath

    if (path.endsWith('.map')) {
      issues.push({ code: 'source-map', path, message: 'Source maps must not ship in release artifacts' })
    }
    if (/(^|\/)vendor\/bun\/(?:bun|bun\.exe)$/.test(path)) {
      issues.push({ code: 'bundled-bun', path, message: 'Desktop artifacts must use Electron Node instead of bundled Bun' })
    }
    if (path.includes('/@anthropic-ai/claude-agent-sdk')) {
      issues.push({ code: 'claude-runtime', path, message: 'PI-only artifacts must not contain the Claude Agent SDK or native runtime' })
    }
    if (buildOnlyResource(path)) {
      issues.push({ code: 'build-only-resource', path, message: 'Build-only resource was copied into the application runtime' })
    }
    if (/(^|\/)src\//.test(path) && /(^|\/)app\//.test(path)) {
      issues.push({ code: 'raw-source', path, message: 'Raw source files must not ship in the packaged app' })
    }
    if (/(^|\/)(?:__tests__|tests?|__pycache__)\//.test(path)) {
      issues.push({ code: 'test-artifact', path, message: 'Tests and caches must not ship in the packaged app' })
    }

    const localePak = path.match(/(^|\/)locales\/([^/]+\.pak)$/)?.[2]
    if (localePak && localePak !== 'en-US.pak' && localePak !== 'zh-CN.pak') {
      issues.push({ code: 'unsupported-locale', path, message: `Unsupported Electron locale: ${localePak}` })
    }

    const lproj = path.split('/').find((part) => part.endsWith('.lproj'))
    if (lproj && !isAllowedLproj(lproj)) {
      issues.push({ code: 'unsupported-locale', path, message: `Unsupported macOS locale: ${lproj}` })
    }
  }

  const packagedPaths = new Set(files.map((file) => file.relativePath))
  const isMacArtifact = existsSync(join(artifactPath, 'Contents'))
  const requiredLocales = isMacArtifact
    ? [
        ['English', /(^|\/)en\.lproj\/locale\.pak$/],
        ['Simplified Chinese', /(^|\/)zh_CN\.lproj\/locale\.pak$/],
      ] as const
    : [
        ['English', /(^|\/)locales\/en-US\.pak$/],
        ['Simplified Chinese', /(^|\/)locales\/zh-CN\.pak$/],
      ] as const

  for (const [label, pattern] of requiredLocales) {
    if (![...packagedPaths].some((path) => pattern.test(path))) {
      issues.push({
        code: 'missing-locale',
        path: label,
        message: `${label} Electron locale is missing from the packaged app`,
      })
    }
  }

  const appRoot = findAppRoot(artifactPath)
  if (!appRoot) {
    issues.push({ code: 'missing-runtime', path: artifactPath, message: 'Could not locate the packaged app root' })
    return issues
  }

  const requiredRuntimes: Array<[string, string[]]> = [
    ['PI Agent Server', [
      join(appRoot, 'dist', 'resources', 'pi-agent-server', 'index.js'),
      join(appRoot, 'resources', 'pi-agent-server', 'index.js'),
    ]],
    ['ripgrep', [
      join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg'),
      join(appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', 'rg.exe'),
    ]],
  ]

  for (const [label, candidates] of requiredRuntimes) {
    if (!candidates.some(existsSync)) {
      issues.push({
        code: 'missing-runtime',
        path: toPosix(relative(artifactPath, candidates[0])),
        message: `${label} is missing from the packaged app`,
      })
    }
  }

  return issues
}

function printReport(report: ElectronArtifactReport): void {
  console.log(`Artifact: ${report.artifactPath}`)
  console.log(`Total: ${formatMiB(report.totalBytes)} (${report.totalBytes} bytes, ${report.fileCount} files)`)
  console.log('\nCategories:')
  for (const [category, bytes] of Object.entries(report.categories)) {
    console.log(`  ${category.padEnd(18)} ${formatMiB(bytes)}`)
  }
  console.log('\nLargest files:')
  for (const entry of report.largestFiles) {
    console.log(`  ${formatMiB(entry.bytes).padStart(12)}  ${entry.path}`)
  }
  console.log('\nLargest directories:')
  for (const entry of report.largestDirectories) {
    console.log(`  ${formatMiB(entry.bytes).padStart(12)}  ${entry.path}`)
  }
}

if (import.meta.main) {
  const artifactPath = process.argv[2]
  if (!artifactPath) {
    console.error('Usage: bun scripts/electron-artifact-report.ts <unpacked-app> [--json <path>]')
    process.exit(2)
  }

  const report = collectElectronArtifactReport(artifactPath)
  printReport(report)

  const jsonFlag = process.argv.indexOf('--json')
  const jsonPath = jsonFlag >= 0 ? process.argv[jsonFlag + 1] : undefined
  if (jsonFlag >= 0 && !jsonPath) {
    console.error('--json requires an output path')
    process.exit(2)
  }
  if (jsonPath) {
    writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`)
  }
}
