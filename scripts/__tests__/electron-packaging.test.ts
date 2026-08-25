import { describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'

import { stageElectronResources } from '../electron-build-resources.ts'

describe('Electron packaging resources', () => {
  test('stages only runtime resources for the target platform into a clean destination', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'boai-electron-resources-'))
    const electronDir = join(rootDir, 'apps', 'electron')

    try {
      mkdirSync(join(electronDir, 'resources'), { recursive: true })
      mkdirSync(join(rootDir, 'packages', 'pi-agent-server', 'dist'), { recursive: true })
      mkdirSync(join(rootDir, 'packages', 'session-mcp-server', 'dist'), { recursive: true })

      const resourceFiles: Array<[string, string]> = [
        ['docs/guide.md', 'guide'],
        ['themes/default.json', '{}'],
        ['config-defaults.json', '{}'],
        ['bridge-mcp-server/index.js', 'bridge'],
        ['bin/markitdown', 'wrapper'],
        ['bin/darwin-arm64/uv', 'arm64-uv'],
        ['bin/darwin-x64/uv', 'x64-uv'],
        ['scripts/markitdown_cli.py', 'runtime'],
        ['scripts/tests/test_markitdown.py', 'test'],
        ['dmg-background.png', 'background'],
        ['icon.png', 'icon'],
        ['AGENTS.md', 'instructions'],
      ]
      for (const [relativePath, content] of resourceFiles) {
        const destination = join(electronDir, 'resources', relativePath)
        mkdirSync(join(destination, '..'), { recursive: true })
        writeFileSync(destination, content)
      }

      writeFileSync(join(rootDir, 'packages', 'pi-agent-server', 'dist', 'index.js'), 'pi')
      writeFileSync(join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js'), 'session')
      mkdirSync(join(rootDir, 'packages', 'shared', 'src', 'agent'), { recursive: true })
      writeFileSync(
        join(rootDir, 'packages', 'shared', 'src', 'agent', 'powershell-parser.ps1'),
        'parser',
      )

      const stalePath = join(electronDir, 'dist', 'resources', 'stale.txt')
      mkdirSync(join(stalePath, '..'), { recursive: true })
      writeFileSync(stalePath, 'stale')

      stageElectronResources(rootDir, { platform: 'darwin', arch: 'arm64' })

      expect(readFileSync(join(electronDir, 'dist', 'resources', 'pi-agent-server', 'index.js'), 'utf8')).toBe('pi')
      expect(readFileSync(join(electronDir, 'dist', 'resources', 'session-mcp-server', 'index.js'), 'utf8')).toBe('session')
      expect(readFileSync(join(electronDir, 'dist', 'resources', 'bridge-mcp-server', 'index.js'), 'utf8')).toBe('bridge')
      expect(readFileSync(join(electronDir, 'dist', 'resources', 'bin', 'darwin-arm64', 'uv'), 'utf8')).toBe('arm64-uv')
      expect(readFileSync(join(electronDir, 'dist', 'resources', 'powershell-parser.ps1'), 'utf8')).toBe('parser')

      for (const excludedPath of [
        stalePath,
        join(electronDir, 'dist', 'resources', 'bin', 'darwin-x64'),
        join(electronDir, 'dist', 'resources', 'scripts', 'tests'),
        join(electronDir, 'dist', 'resources', 'dmg-background.png'),
        join(electronDir, 'dist', 'resources', 'icon.png'),
        join(electronDir, 'dist', 'resources', 'AGENTS.md'),
      ]) {
        expect(existsSync(excludedPath)).toBe(false)
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('uses a BoAI-specific bundle identifier', () => {
    const configPath = join(import.meta.dir, '..', '..', 'apps', 'electron', 'electron-builder.yml')
    const config = load(readFileSync(configPath, 'utf8')) as {
      appId?: string
      electronLanguages?: string[]
      files?: string[]
      mac?: { files?: string[]; electronLanguages?: string[] }
      win?: { files?: string[] }
      linux?: { files?: string[] }
    }

    expect(config.appId).toBe('com.boai.desktop')
    expect(config.electronLanguages).toEqual(['en-US', 'zh-CN'])
    expect(config.mac?.electronLanguages).toEqual(['en', 'zh_CN'])
    expect(JSON.stringify(config)).not.toContain('vendor/bun')
    expect(JSON.stringify(config)).not.toContain('packages/shared/src')
    expect(config.files).toContain('dist/**/*')
    // A platform-level list containing only exclusions causes electron-builder
    // to restore its broad default include and ship src/, tests and configs.
    expect(config.mac?.files).toBeUndefined()
    expect(config.linux?.files).toBeUndefined()
    expect(config.win?.files).toContain('dist/**/*')
    expect(config.win?.files).toContain('package.json')
  })
})
