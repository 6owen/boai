import { describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { load } from 'js-yaml'

import { stageElectronResources } from '../electron-build-resources.ts'

describe('Electron packaging resources', () => {
  test('stages the Pi and session subprocesses beside bundled resources', () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'boai-electron-resources-'))
    const electronDir = join(rootDir, 'apps', 'electron')

    try {
      mkdirSync(join(electronDir, 'resources'), { recursive: true })
      mkdirSync(join(rootDir, 'packages', 'pi-agent-server', 'dist'), { recursive: true })
      mkdirSync(join(rootDir, 'packages', 'session-mcp-server', 'dist'), { recursive: true })

      writeFileSync(join(electronDir, 'resources', 'icon.png'), 'icon')
      writeFileSync(join(rootDir, 'packages', 'pi-agent-server', 'dist', 'index.js'), 'pi')
      writeFileSync(join(rootDir, 'packages', 'session-mcp-server', 'dist', 'index.js'), 'session')

      stageElectronResources(rootDir)

      expect(readFileSync(join(electronDir, 'dist', 'resources', 'pi-agent-server', 'index.js'), 'utf8')).toBe('pi')
      expect(readFileSync(join(electronDir, 'dist', 'resources', 'session-mcp-server', 'index.js'), 'utf8')).toBe('session')
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })

  test('uses a BoAI-specific bundle identifier', () => {
    const configPath = join(import.meta.dir, '..', '..', 'apps', 'electron', 'electron-builder.yml')
    const config = load(readFileSync(configPath, 'utf8')) as { appId?: string }

    expect(config.appId).toBe('com.boai.desktop')
  })
})
