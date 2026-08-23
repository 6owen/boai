import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportResources, importResources } from '../resource-bundle.ts'
import type { ResourceBundle } from '../types.ts'

describe('legacy automation resource compatibility', () => {
  let workspaceRoot: string

  beforeEach(() => {
    workspaceRoot = mkdtempSync(join(tmpdir(), 'boai-resource-compat-'))
    mkdirSync(join(workspaceRoot, 'sources'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'skills'), { recursive: true })
  })

  afterEach(() => {
    rmSync(workspaceRoot, { recursive: true, force: true })
  })

  it('does not export legacy automations even when an old caller requests them', () => {
    writeFileSync(
      join(workspaceRoot, 'automations.json'),
      JSON.stringify({
        version: 2,
        automations: {
          UserPromptSubmit: [{ id: 'abc123', actions: [{ type: 'prompt', prompt: 'legacy' }] }],
        },
      }),
    )

    const { bundle, warnings } = exportResources(workspaceRoot, { automations: 'all' })

    expect(bundle.resources).not.toHaveProperty('automations')
    expect(warnings.some((warning) => warning.includes('Automations are no longer exported'))).toBe(true)
  })

  it('ignores legacy automations on import without creating or modifying their config', async () => {
    const automationsPath = join(workspaceRoot, 'automations.json')
    const original = JSON.stringify({ version: 2, automations: {} })
    writeFileSync(automationsPath, original)

    const legacyBundle = {
      version: 1,
      exportedAt: Date.now(),
      resources: {
        automations: [{
          id: 'abc123',
          event: 'UserPromptSubmit',
          matcher: { id: 'abc123', actions: [{ type: 'prompt', prompt: 'legacy' }] },
        }],
      },
    } as ResourceBundle

    const result = await importResources(workspaceRoot, legacyBundle, 'overwrite', {
      clearSourceCredentials: async () => {},
    })

    expect(result).not.toHaveProperty('automations')
    expect(result.warnings.some((warning) => warning.includes('Ignored 1 legacy automation'))).toBe(true)
    expect(existsSync(automationsPath)).toBe(true)
    expect(readFileSync(automationsPath, 'utf8')).toBe(original)
  })
})
