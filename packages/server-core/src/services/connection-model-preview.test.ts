import { beforeAll, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let results: Record<string, any>;
beforeAll(async () => {
  const home = mkdtempSync(join(tmpdir(), 'boai-model-preview-'));
  writeFileSync(join(home, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [] }));
  const script = `
    import { registerLlmConnectionsHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/llm-connections.ts'))};
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { getLlmConnection, getLlmConnections, addLlmConnection } from '@craft-agent/shared/config';
    import { getCredentialManager } from '@craft-agent/shared/credentials';
    const requests = [];
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch(req) {
      const path = new URL(req.url).pathname;
      const auth = req.headers.get('authorization');
      requests.push({ path, storedKey: auth === 'Bearer fixture-stored-key', replacementKey: auth === 'Bearer fixture-replacement-key' });
      if (auth !== 'Bearer fixture-stored-key' && auth !== 'Bearer fixture-replacement-key' && path !== '/keyless/v1/models') return new Response('', { status: 401 });
      if (path === '/malformed/v1/models') return Response.json({ success: true });
      return Response.json({ data: [{ id: 'original', display_name: 'Original' }, { id: 'other-model', display_name: 'Other model' }] });
    } });
    const base = 'http://127.0.0.1:' + server.port;
    const cm = getCredentialManager();
    addLlmConnection({ slug: 'existing', name: 'Existing', providerType: 'pi_compat', piAuthProvider: 'anthropic', authType: 'api_key_with_endpoint', baseUrl: base + '/stored', customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'original', models: [{ id: 'original', name: 'Original', shortName: 'Original', description: '', provider: 'pi', contextWindow: 64_000, supportsImages: false }], createdAt: Date.now() });
    await cm.setLlmApiKey('existing', 'fixture-stored-key');
    const before = JSON.stringify(getLlmConnections());
    const callbacks = new Map();
    registerLlmConnectionsHandlers({ handle: (channel, fn) => callbacks.set(channel, fn) }, { platform: { appRootPath: process.cwd(), isPackaged: false, logger: { info() {}, warn() {}, error() {} } }, sessionManager: { reinitializeAuth: async () => {} } });
    const preview = params => callbacks.get(RPC_CHANNELS.llmConnections.DISCOVER_MODELS)({}, params);
    const draft = { connectionSlug: 'existing', apiKey: '', baseUrl: base + '/draft/v1', customEndpoint: { api: 'openai-responses' } };
    const edited = await preview(draft);
    const editRequest = requests.at(-1);
    const fresh = await preview({ ...draft, connectionSlug: undefined, apiKey: 'fixture-replacement-key' });
    const replacement = await preview({ ...draft, apiKey: 'fixture-replacement-key' });
    const replacementRequest = requests.at(-1);
    const invalidKey = await preview({ ...draft, apiKey: 'fixture-invalid-key' });
    const malformed = await preview({ ...draft, baseUrl: base + '/malformed/v1' });
    const beforeInvalid = requests.length;
    const masked = await preview({ ...draft, apiKey: 'fixture••••••••key' });
    const invalidUrl = await preview({ ...draft, baseUrl: 'file:///tmp/config.json' });
    const missing = await preview({ ...draft, connectionSlug: 'missing' });
    const invalidProtocol = await preview({ ...draft, customEndpoint: { api: 'invalid' } });
    const invalidRequests = requests.length - beforeInvalid;
    const keyless = await preview({ baseUrl: base + '/keyless/v1', customEndpoint: { api: 'openai-completions' } });
    const unchanged = before === JSON.stringify(getLlmConnections()) && await cm.getLlmApiKey('existing') === 'fixture-stored-key';
    const saved = await callbacks.get(RPC_CHANNELS.settings.SETUP_LLM_CONNECTION)({}, { slug: 'existing', baseUrl: base + '/stored', customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'other-model', models: ['other-model', 'original'], modelSelectionMode: 'automaticallySyncedFromProvider' });
    const afterSave = getLlmConnection('existing');
    console.log('RESULT:' + JSON.stringify({ edited, editRequest, fresh, replacement, replacementRequest, invalidKey, malformed, masked, invalidUrl, missing, invalidProtocol, invalidRequests, keyless, unchanged, saved, afterSave }));
    server.stop(true);
  `;
  try {
    const proc = Bun.spawn([process.execPath, '-e', script], { cwd: resolve(import.meta.dir, '../../../..'), env: { ...process.env, BOAI_HOME: home }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
    results = JSON.parse(stdout.split('\n').find(line => line.startsWith('RESULT:'))!.slice(7));
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 20_000);

it('fetches an unsaved endpoint with the stored key and returns searchable model metadata', () => {
  expect(results.edited).toEqual({ success: true, models: [{ id: 'original', name: 'Original' }, { id: 'other-model', name: 'Other model' }] });
  expect(results.editRequest).toEqual({ path: '/draft/v1/models', storedKey: true, replacementKey: false });
  expect(results.unchanged).toBe(true);
});
it('uses a new key both before connection creation and when replacing a saved key', () => {
  expect(results.fresh.success).toBe(true);
  expect(results.replacement.success).toBe(true);
  expect(results.replacementRequest.replacementKey).toBe(true);
});
it('reports authentication and malformed-list errors honestly', () => {
  expect(results.invalidKey.success).toBe(false);
  expect(results.invalidKey.error).toContain('401');
  expect(results.malformed.success).toBe(false);
});
it('rejects previews, invalid URLs/protocols and missing saved connections before making requests', () => {
  for (const result of [results.masked, results.invalidUrl, results.missing, results.invalidProtocol]) expect(result.success).toBe(false);
  expect(results.invalidRequests).toBe(0);
});
it('supports local endpoints that do not require a key', () => {
  expect(results.keyless.success).toBe(true);
});
it('saving the selected default keeps the complete catalog and explicit model capabilities', () => {
  expect(results.saved.success).toBe(true);
  expect(results.afterSave.defaultModel).toBe('other-model');
  expect(results.afterSave.models[1]).toMatchObject({ id: 'original', supportsImages: false, contextWindow: 64_000 });
  expect(results.afterSave.models).toHaveLength(2);
  expect(results.afterSave.modelSelectionMode).toBe('automaticallySyncedFromProvider');
});
