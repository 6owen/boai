import { it, expect } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

it('startup leaves local credentials untouched; model updates preserve explicit import ownership', async () => {
  const root = mkdtempSync(join(tmpdir(), 'boai-local-config-startup-'));
  const boaiHome = join(root, 'boai');
  const codexHome = join(root, 'codex');
  mkdirSync(boaiHome); mkdirSync(codexHome);
  writeFileSync(join(boaiHome, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [] }));
  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  writeFileSync(join(codexHome, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { access_token: `fake.${payload}.signature`, refresh_token: 'fixture-refresh', account_id: 'fixture-account' } }));
  const script = `
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { registerOnboardingHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/onboarding.ts'))};
    import { registerLlmConnectionsHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/llm-connections.ts'))};
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { addLlmConnection, updateLlmConnection, getLlmConnection } from '@craft-agent/shared/config';
    import { createBuiltInConnection } from '@craft-agent/server-core/domain';
    const configPath = join(process.env.BOAI_HOME, 'config.json');
    const before = readFileSync(configPath, 'utf8');
    const callbacks = new Map();
    registerOnboardingHandlers({ handle: (channel, fn) => callbacks.set(channel, fn) }, { platform: { logger: { info() {}, warn() {}, error() {} } } });
    globalThis.fetch = async () => { throw new Error('Network disabled in test'); };
    const result = await callbacks.get(RPC_CHANNELS.onboarding.GET_AUTH_STATE)({});
    if (!result.setupNeeds.needsBillingConfig || readFileSync(configPath, 'utf8') !== before || result.autoImportedLogin) throw new Error('Startup imported a local account');
    const ownership = { sourceId: 'codex-cli', configId: 'fixture-id' };
    addLlmConnection({ ...createBuiltInConnection('chatgpt-plus'), localImport: ownership });
    updateLlmConnection('chatgpt-plus', { lastUsedAt: Date.now() });
    if (getLlmConnection('chatgpt-plus').localImport?.configId !== ownership.configId) throw new Error('Model update lost import ownership');
    updateLlmConnection('chatgpt-plus', { localImport: undefined });
    if (getLlmConnection('chatgpt-plus').localImport) throw new Error('Manual login did not clear ownership');
    addLlmConnection({ ...createBuiltInConnection('pi-api-key'), localImport: { sourceId: 'codex-api-key', configId: 'api-fixture' } });
    registerLlmConnectionsHandlers({ handle: (channel, fn) => callbacks.set(channel, fn) }, {
      platform: { logger: { info() {}, warn() {}, error() {} } }, sessionManager: { reinitializeAuth: async () => {} },
    });
    const manual = await callbacks.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)({}, { slug: 'pi-api-key', credential: 'fixture-manual-key', piAuthProvider: 'openai' });
    if (!manual.success || getLlmConnection('pi-api-key').localImport) throw new Error('Manual API credential did not take ownership');
    console.log('PASS');
  `;
  try {
    const proc = Bun.spawn([process.execPath, '-e', script], {
      cwd: resolve(import.meta.dir, '../../../..'),
      env: { ...process.env, BOAI_HOME: boaiHome, CODEX_HOME: codexHome },
      stdout: 'pipe', stderr: 'pipe',
    });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
    expect(stdout).toContain('PASS');
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 15_000);
