import { beforeAll, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let results: Record<string, any>;

// Isolate config/credential singletons from the developer's accounts and other tests.
beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'boai-connection-validation-'));
  const home = join(root, 'boai');
  mkdirSync(home);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [] }));
  const script = `
    import { registerLlmConnectionsHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/llm-connections.ts'))};
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { addLlmConnection, getLlmConnection } from '@craft-agent/shared/config';
    import { getCredentialManager } from '@craft-agent/shared/credentials';
    import { PiAgent } from ${JSON.stringify(resolve(import.meta.dir, '../../../shared/src/agent/pi-agent.ts'))};
    const requests = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const body = await req.json();
      const authorized = req.headers.get('authorization') === 'Bearer fixture-valid-key' || req.headers.get('x-api-key') === 'fixture-valid-key';
      requests.push({ path: new URL(req.url).pathname, model: body.model, authorized });
      if (!authorized) return Response.json({ error: { message: 'Invalid fixture key' } }, { status: 401 });
      if (body.model === 'missing-model') return Response.json({ error: { message: 'Unknown fixture model' } }, { status: 404 });
      if (body.model === 'malformed-response') return Response.json({ success: true });
      if (body.model === 'thinking-model') return Response.json({ id: 'msg_thinking', type: 'message', role: 'assistant', model: body.model, content: [{ type: 'thinking', thinking: 'reasoning' }], stop_reason: 'max_tokens', usage: { input_tokens: 1, output_tokens: 16 } });
      return Response.json({ id: 'msg_fixture', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'ok' }], model: body.model, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } });
    } });
    const baseUrl = 'http://127.0.0.1:' + server.port + '/api/anthropic';
    const cm = getCredentialManager();
    for (const [slug, key] of [['invalid', 'fixture-invalid-key'], ['valid', 'fixture-valid-key']]) {
      addLlmConnection({ slug, name: slug, providerType: 'pi_compat', piAuthProvider: 'anthropic', authType: 'api_key_with_endpoint', baseUrl, customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'glm-fixture', models: ['glm-fixture'], createdAt: Date.now() });
      await cm.setLlmApiKey(slug, key);
    }
    const callbacks = new Map();
    registerLlmConnectionsHandlers({ handle: (channel, fn) => callbacks.set(channel, fn) }, { platform: { appRootPath: process.cwd(), isPackaged: false, logger: { info() {}, warn() {}, error() {} } }, sessionManager: { reinitializeAuth: async () => {} } });
    const call = (channel, arg) => callbacks.get(channel)({}, arg);
    const stored = await call(RPC_CHANNELS.llmConnections.TEST, 'invalid');
    const storedRequests = requests.splice(0);
    const setup = { provider: 'pi', apiKey: '', connectionSlug: 'valid', baseUrl, piAuthProvider: 'anthropic', model: 'glm-fixture', customEndpoint: { api: 'anthropic-messages' } };
    const edit = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, setup);
    const editRequests = requests.splice(0);
    const badModel = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, model: 'missing-model' });
    const badModelRequests = requests.splice(0);
    const masked = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, connectionSlug: undefined, apiKey: 'fixture••••••••key' });
    const maskedRequests = requests.splice(0);
    const malformed = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, model: 'malformed-response' });
    const thinking = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, model: 'thinking-model' });
    const valid = await call(RPC_CHANNELS.llmConnections.TEST, 'valid');
    const replacement = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, apiKey: 'fixture-invalid-key' });
    const saved = await call(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION, { slug: 'valid', baseUrl, piAuthProvider: 'anthropic', customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'glm-fixture', models: ['glm-fixture'] });
    const keptKeyedAuth = getLlmConnection('valid').authType === 'api_key_with_endpoint';
    addLlmConnection({ slug: 'old-import', name: 'old-import', providerType: 'pi_compat', piAuthProvider: 'anthropic', authType: 'api_key_with_endpoint', baseUrl, customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'glm-fixture[1m]', models: ['glm-fixture[1m]'], createdAt: Date.now(), localImport: { sourceId: 'claude-code-api-key', configId: 'old-id' } });
    await cm.setLlmApiKey('old-import', 'fixture-valid-key');
    requests.splice(0);
    const oldImport = await call(RPC_CHANNELS.llmConnections.TEST, 'old-import');
    const oldImportRequests = requests.splice(0);
    addLlmConnection({ slug: 'oauth', name: 'oauth', providerType: 'pi', piAuthProvider: 'openai-codex', authType: 'oauth', defaultModel: 'pi/oauth-fixture', createdAt: Date.now() });
    await cm.setLlmOAuth('oauth', { accessToken: 'fixture-access', refreshToken: 'fixture-refresh' });
    const completionCalls = [];
    PiAgent.prototype.runMiniCompletion = async function () {
      completionCalls.push({ slug: this.config.connectionSlug, authType: this.config.authType, model: this.config.model, api: this.config.runtime?.customEndpoint?.api });
      if (this.config.authType === 'oauth') throw new Error('401 Fixture OAuth token rejected');
      return 'ok';
    };
    const oauth = await call(RPC_CHANNELS.llmConnections.TEST, 'oauth');
    const explicitProtocol = await call(RPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, { ...setup, customEndpoint: { api: 'openai-responses' } });
    const unchanged = getLlmConnection('valid').defaultModel === 'glm-fixture' && (await cm.getLlmApiKey('valid')) === 'fixture-valid-key';
    console.log('RESULT:' + JSON.stringify({ stored, storedRequests, edit, editRequests, badModel, badModelRequests, masked, maskedRequests, unchanged, malformed, thinking, valid, replacement, saved, keptKeyedAuth, oldImport, oldImportRequests, oauth, explicitProtocol, completionCalls }));
    server.stop(true);
  `;
  try {
    const proc = Bun.spawn([process.execPath, '-e', script], { cwd: resolve(import.meta.dir, '../../../..'), env: { ...process.env, BOAI_HOME: home }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
    results = JSON.parse(stdout.split('\n').find(line => line.startsWith('RESULT:'))!.slice(7));
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20_000);

it('stored validation actually requests the configured endpoint and rejects a 401', () => {
  expect(results.stored.success).toBe(false);
  expect(results.storedRequests).toEqual([{ path: '/api/anthropic/v1/messages', model: 'glm-fixture', authorized: false }]);
});

it('editing without a replacement key tests the server-stored secret', () => {
  expect(results.edit).toEqual({ success: true });
  expect(results.editRequests).toEqual([{ path: '/api/anthropic/v1/messages', model: 'glm-fixture', authorized: true }]);
});

it('tests proposed model changes without overwriting the existing connection', () => {
  expect(results.badModel.success).toBe(false);
  expect(results.badModelRequests).toEqual([{ path: '/api/anthropic/v1/messages', model: 'missing-model', authorized: true }]);
  expect(results.unchanged).toBe(true);
});

it('rejects display-only key previews before constructing HTTP headers', () => {
  expect(results.masked.success).toBe(false);
  expect(results.masked.error).toContain('masked');
  expect(results.maskedRequests).toEqual([]);
});

it('accepts a real stored connection and rejects a newly entered invalid key', () => {
  expect(results.valid.success).toBe(true);
  expect(results.replacement.success).toBe(false);
});

it('accepts a thinking response within the test token limit, but rejects unrelated HTTP 200 JSON', () => {
  expect(results.thinking.success).toBe(true);
  expect(results.malformed.success).toBe(false);
});

it('preserves a saved local endpoint key and its authentication type on edit', () => {
  expect(results.saved.success).toBe(true);
  expect(results.keptKeyedAuth).toBe(true);
  expect(results.unchanged).toBe(true);
});

it('repairs Claude Code model modifiers in previously imported connections', () => {
  expect(results.oldImport.success).toBe(true);
  expect(results.oldImportRequests).toEqual([{ path: '/api/anthropic/v1/messages', model: 'glm-fixture', authorized: true }]);
});

it('runs OAuth validation through the configured agent and reports its rejection', () => {
  expect(results.oauth.success).toBe(false);
  expect(results.completionCalls[0]).toMatchObject({ slug: 'oauth', authType: 'oauth', model: 'pi/oauth-fixture' });
});

it('uses the explicit custom protocol even when a provider hint suggests Anthropic', () => {
  expect(results.explicitProtocol.success).toBe(true);
  expect(results.completionCalls[1]).toMatchObject({ api: 'openai-responses', model: 'glm-fixture' });
});
