import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const RESULT_PREFIX = '__AUTOMATION_RUNTIME_RESULT__'

describe('automation runtime decommissioning', () => {
  let configDir: string
  let workspaceRoot: string

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), 'boai-automation-runtime-'))
    workspaceRoot = join(configDir, 'workspaces', 'main')

    mkdirSync(join(workspaceRoot, 'sessions'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'sources'), { recursive: true })
    mkdirSync(join(workspaceRoot, 'skills'), { recursive: true })

    const now = Date.now()
    writeFileSync(
      join(configDir, 'config.json'),
      JSON.stringify({
        llmConnections: [],
        workspaces: [{
          id: 'ws_decommissioned',
          name: 'Main',
          slug: 'main',
          rootPath: workspaceRoot,
          createdAt: now,
        }],
        activeWorkspaceId: 'ws_decommissioned',
        activeSessionId: null,
      }),
    )
    writeFileSync(
      join(workspaceRoot, 'config.json'),
      JSON.stringify({
        id: 'ws_decommissioned',
        name: 'Main',
        slug: 'main',
        createdAt: now,
        updatedAt: now,
      }),
    )
    writeFileSync(
      join(workspaceRoot, 'automations.json'),
      JSON.stringify({
        automations: {
          SchedulerTick: [{
            matcher: 'legacy-schedule',
            cron: '* * * * *',
            actions: [{ type: 'prompt', prompt: 'This must never run.' }],
          }],
        },
      }),
    )
  })

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true })
  })

  it('does not create a scheduler for a workspace with legacy automations', () => {
    const script = `
      import { SessionManager } from './packages/server-core/src/sessions/SessionManager.ts';
      const manager = new SessionManager();
      manager.setupConfigWatcher(${JSON.stringify(workspaceRoot)}, 'ws_decommissioned');
      console.log('${RESULT_PREFIX}' + JSON.stringify(manager.getWorkspaceAutomationSummary('ws_decommissioned')));
      manager.cleanup();
      process.exit(0);
    `
    const result = Bun.spawnSync([process.execPath, '--eval', script], {
      cwd: join(import.meta.dir, '..', '..', '..', '..'),
      env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    expect(result.exitCode).toBe(0)
    const line = result.stdout
      .toString()
      .split('\n')
      .find((entry) => entry.startsWith(RESULT_PREFIX))
    expect(line).toBeDefined()
    expect(JSON.parse(line!.slice(RESULT_PREFIX.length))).toEqual({
      automationCount: 0,
      schedulerRunning: false,
    })
  }, 15_000)
})
