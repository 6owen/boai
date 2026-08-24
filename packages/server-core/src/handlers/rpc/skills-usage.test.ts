import { afterEach, describe, expect, it } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { SkillUsageStats } from '@craft-agent/shared/skills/types'

const SKILLS_HANDLER_URL = pathToFileURL(join(import.meta.dir, 'skills.ts')).href
const tempDirs: string[] = []

interface HandlerResult {
  ok: boolean
  registered: string[]
  result?: SkillUsageStats
  error?: string
}

interface WorkspaceFixtureOptions {
  content?: string
  knownSkillSlugs?: readonly string[]
}

function setupWorkspace(
  options: WorkspaceFixtureOptions = {},
): { configDir: string; workspaceRoot: string } {
  const now = Date.now()
  const configDir = mkdtempSync(join(tmpdir(), 'boai-skill-usage-rpc-'))
  tempDirs.push(configDir)
  const workspaceRoot = join(configDir, 'workspaces', 'personal-ai')
  const sessionDir = join(workspaceRoot, 'sessions', 'session-1')
  mkdirSync(sessionDir, { recursive: true })

  writeFileSync(join(workspaceRoot, 'config.json'), JSON.stringify({
    id: 'workspace-config-1',
    name: 'Personal AI',
    slug: 'personal-ai',
    createdAt: now,
    updatedAt: now,
  }, null, 2))

  writeFileSync(join(configDir, 'config.json'), JSON.stringify({
    workspaces: [{
      id: 'workspace-1',
      name: 'Personal AI',
      rootPath: workspaceRoot,
      createdAt: now,
    }],
    activeWorkspaceId: 'workspace-1',
    activeSessionId: null,
    defaultLlmConnection: 'work-anthropic',
    llmConnections: [{
      slug: 'work-anthropic',
      name: 'Team Anthropic',
      providerType: 'pi',
      authType: 'api_key',
      piAuthProvider: 'anthropic',
      createdAt: now,
      defaultModel: 'claude-sonnet-4-5',
    }],
  }, null, 2))

  for (const slug of options.knownSkillSlugs ?? []) {
    const skillDir = join(workspaceRoot, 'skills', slug)
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), [
      '---',
      `name: "${slug}"`,
      `description: "Fixture for ${slug}"`,
      '---',
      '',
      `Use ${slug}.`,
    ].join('\n'))
  }

  const header = {
    id: 'session-1',
    workspaceRootPath: workspaceRoot,
    createdAt: now - 60_000,
    lastUsedAt: now,
    lastMessageAt: now - 1_000,
    llmConnection: 'work-anthropic',
    model: 'claude-sonnet-4-5',
    tokenUsage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
      costUsd: 0,
    },
    messageCount: 1,
    lastMessageRole: 'user',
  }
  const userMessage = {
    id: 'message-1',
    type: 'user',
    content: options.content ?? '[skill:commit] save the changes',
    timestamp: now - 1_000,
    ...(options.content ? {} : {
      badges: [{
        type: 'skill',
        label: 'Commit',
        rawText: '[skill:commit]',
        start: 0,
        end: 14,
      }],
    }),
  }
  writeFileSync(
    join(sessionDir, 'session.jsonl'),
    `${JSON.stringify(header)}\n${JSON.stringify(userMessage)}\n`,
  )

  return { configDir, workspaceRoot }
}

function invokeUsageHandler(
  configDir: string,
  workspaceId: string,
  range: string,
): HandlerResult {
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

    registerSkillsHandlers(server, deps);
    const handler = handlers.get(RPC_CHANNELS.skills.GET_USAGE_STATS);
    let payload;
    if (!handler) {
      payload = { ok: false, error: 'GET_USAGE_STATS handler not registered' };
    } else {
      try {
        const result = await handler(
          { clientId: 'test-client', workspaceId: ${JSON.stringify(workspaceId)}, webContentsId: 1 },
          ${JSON.stringify(workspaceId)},
          ${JSON.stringify(range)},
        );
        payload = { ok: true, result };
      } catch (error) {
        payload = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    payload.registered = [...handlers.keys()];
    console.log('__SKILL_USAGE_RESULT__' + JSON.stringify(payload));
  `
  const run = Bun.spawnSync([process.execPath, '--eval', script], {
    cwd: join(import.meta.dir, '..', '..', '..', '..', '..'),
    env: {
      ...process.env,
      HOME: configDir,
      CODEX_HOME: join(configDir, '.codex'),
      CRAFT_CONFIG_DIR: configDir,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const stderr = run.stderr.toString().trim()
  if (run.exitCode !== 0) {
    throw new Error(`Skill usage handler subprocess failed (exit ${run.exitCode}):\n${stderr}`)
  }
  const resultLine = run.stdout.toString().split('\n')
    .find(line => line.startsWith('__SKILL_USAGE_RESULT__'))
  if (!resultLine) {
    throw new Error(`Skill usage handler did not return a result.\n${stderr}`)
  }
  return JSON.parse(resultLine.slice('__SKILL_USAGE_RESULT__'.length)) as HandlerResult
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('Skill usage RPC handler', () => {
  it('registers GET_USAGE_STATS and returns system Agent usage', () => {
    const { configDir } = setupWorkspace()

    const response = invokeUsageHandler(configDir, 'workspace-1', '30d')

    expect(response.ok).toBe(true)
    expect(response.registered).toContain(RPC_CHANNELS.skills.GET_USAGE_STATS)
    expect(response.result).toMatchObject({
      scope: 'system',
      metric: 'requested-or-activated',
      range: '30d',
      totals: {
        activations: 1,
        skills: 1,
        sessions: 1,
        agentSources: 1,
      },
      topSkills: [{
        slug: 'commit',
        count: 1,
        sessionCount: 1,
      }],
      agentSources: [{
        key: 'agent:boai',
        agentId: 'boai',
        label: 'BoAI',
        availability: 'observed',
        confidence: 'exact',
        count: 1,
        sessionCount: 1,
        skillCount: 1,
      }],
      coverage: {
        detectedAgents: 1,
        observableAgents: 1,
      },
    })
  })

  it('preserves installed Plugin Skill identities with the same leaf slug', () => {
    const { configDir } = setupWorkspace({
      content: '[skill:kata-code:starter-react] [skill:other:starter-react]',
      knownSkillSlugs: ['kata-code:starter-react', 'other:starter-react'],
    })

    const response = invokeUsageHandler(configDir, 'workspace-1', '30d')

    expect(response.result?.totals).toMatchObject({ activations: 2, skills: 2 })
    expect(response.result?.topSkills.map(item => item.slug)).toEqual([
      'kata-code:starter-react',
      'other:starter-react',
    ])
  })

  it('rejects an unsupported usage range', () => {
    const { configDir } = setupWorkspace()

    const response = invokeUsageHandler(configDir, 'workspace-1', 'yesterday')

    expect(response).toMatchObject({
      ok: false,
      error: 'Invalid Skill usage range',
    })
  })

  it('rejects a missing workspace', () => {
    const { configDir } = setupWorkspace()

    const response = invokeUsageHandler(configDir, 'missing-workspace', '30d')

    expect(response).toMatchObject({
      ok: false,
      error: 'Workspace not found',
    })
  })
})
