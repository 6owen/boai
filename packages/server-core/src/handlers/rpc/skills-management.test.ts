import { afterEach, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const SKILLS_HANDLER_URL = pathToFileURL(join(import.meta.dir, 'skills.ts')).href
const tempDirs: string[] = []

function makeFixture(): { configDir: string; projectRoot: string } {
  const now = Date.now()
  const configDir = mkdtempSync(join(tmpdir(), 'boai-skill-management-rpc-'))
  const projectRoot = mkdtempSync(join(tmpdir(), 'boai-selected-project-'))
  tempDirs.push(configDir, projectRoot)

  const workspaceRoot = join(configDir, 'workspaces', 'personal-ai')
  mkdirSync(workspaceRoot, { recursive: true })
  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
    id: 'workspace-config-1',
    name: 'Personal AI',
    slug: 'personal-ai',
    createdAt: now,
    updatedAt: now,
  }))
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'workspace-1',
      name: 'Personal AI',
      rootPath: workspaceRoot,
      createdAt: now,
    }],
    activeWorkspaceId: 'workspace-1',
    activeSessionId: null,
    llmConnections: [],
  }))

  return { configDir, projectRoot }
}

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('installs a project Skill into an explicitly selected directory without an attached session', () => {
  const { configDir, projectRoot } = makeFixture()
  const script = `
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { registerSkillsHandlers } from ${JSON.stringify(SKILLS_HANDLER_URL)};

    const handlers = new Map();
    const installCalls = [];
    const server = {
      handle(channel, handler) { handlers.set(channel, handler); },
      push() {},
      async invokeClient() { return undefined; },
      hasClientCapability() { return false; },
      findClientsWithCapability() { return []; },
    };
    const deps = {
      sessionManager: {
        getSessions() { return []; },
      },
      oauthFlowStore: {},
      platform: {
        appRootPath: '/',
        resourcesPath: '/',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: false,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        imageProcessor: {
          async getMetadata() { return null; },
          async process() { return Buffer.from(''); },
        },
      },
    };
    const skillsCli = {
      async install(options) {
        installCalls.push(options);
        return { stdout: 'installed', stderr: '' };
      },
    };

    registerSkillsHandlers(server, deps, skillsCli);
    const handler = handlers.get(RPC_CHANNELS.skills.INSTALL);
    let payload;
    try {
      const result = await handler(
        { clientId: 'test-client', workspaceId: 'workspace-1', webContentsId: 1 },
        'workspace-1',
        {
          source: 'owner/repository',
          slug: 'example-skill',
          scope: 'project',
          workingDirectory: ${JSON.stringify(projectRoot)},
        },
      );
      payload = { ok: true, result, installCalls };
    } catch (error) {
      payload = { ok: false, error: error instanceof Error ? error.message : String(error), installCalls };
    }
    console.log('__SKILL_MANAGEMENT_RESULT__' + JSON.stringify(payload));
  `

  const run = Bun.spawnSync([process.execPath, '--eval', script], {
    cwd: join(import.meta.dir, '..', '..', '..', '..', '..'),
    env: {
      ...process.env,
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(run.exitCode).toBe(0)

  const resultLine = run.stdout.toString().split('\n')
    .find(line => line.startsWith('__SKILL_MANAGEMENT_RESULT__'))
  expect(resultLine).toBeDefined()
  const payload = JSON.parse(resultLine!.slice('__SKILL_MANAGEMENT_RESULT__'.length))

  expect(payload).toMatchObject({
    ok: true,
    installCalls: [{
      scope: 'project',
      projectRoot,
      cwd: projectRoot,
    }],
  })
}, 15_000)

test('rejects deletion of a read-only external Agent Skill at the RPC boundary', () => {
  const { configDir } = makeFixture()
  const script = `
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { registerSkillsHandlers } from ${JSON.stringify(SKILLS_HANDLER_URL)};

    const handlers = new Map();
    const server = {
      handle(channel, handler) { handlers.set(channel, handler); },
      push() {},
      async invokeClient() { return undefined; },
      hasClientCapability() { return false; },
      findClientsWithCapability() { return []; },
    };
    const deps = {
      sessionManager: { getSessions() { return []; } },
      oauthFlowStore: {},
      platform: {
        appRootPath: '/',
        resourcesPath: '/',
        isPackaged: false,
        appVersion: '0.0.0-test',
        isDebugMode: false,
        logger: { info() {}, warn() {}, error() {}, debug() {} },
        imageProcessor: {
          async getMetadata() { return null; },
          async process() { return Buffer.from(''); },
        },
      },
    };

    registerSkillsHandlers(server, deps, {});
    const handler = handlers.get(RPC_CHANNELS.skills.DELETE);
    let payload;
    try {
      await handler(
        { clientId: 'test-client', workspaceId: 'workspace-1', webContentsId: 1 },
        'workspace-1',
        { slug: 'external-example', source: 'agent' },
      );
      payload = { ok: true };
    } catch (error) {
      payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    console.log('__SKILL_DELETE_RESULT__' + JSON.stringify(payload));
  `

  const run = Bun.spawnSync([process.execPath, '--eval', script], {
    cwd: join(import.meta.dir, '..', '..', '..', '..', '..'),
    env: { ...process.env, CRAFT_CONFIG_DIR: configDir },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(run.exitCode).toBe(0)

  const resultLine = run.stdout.toString().split('\n')
    .find(line => line.startsWith('__SKILL_DELETE_RESULT__'))
  expect(resultLine).toBeDefined()
  expect(JSON.parse(resultLine!.slice('__SKILL_DELETE_RESULT__'.length))).toEqual({
    ok: false,
    error: 'External Agent skills are read-only',
  })
}, 15_000)
