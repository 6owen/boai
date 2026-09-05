import { beforeAll, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let results: Record<string, any>;
beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'boai-model-discovery-'));
  const home = join(root, 'boai');
  const source = join(root, 'source');
  mkdirSync(home); mkdirSync(source);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [] }));
  const script = `
    import { writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { registerOnboardingHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/onboarding.ts'))};
    import { registerLlmConnectionsHandlers } from ${JSON.stringify(resolve(import.meta.dir, '../handlers/rpc/llm-connections.ts'))};
    import { initModelRefreshService, setFetcherPlatform } from '@craft-agent/server-core/model-fetchers';
    import { RPC_CHANNELS } from '@craft-agent/shared/protocol';
    import { getLlmConnection, updateLlmConnection, addLlmConnection } from '@craft-agent/shared/config';
    import { getCredentialManager } from '@craft-agent/shared/credentials';
    import { scanLocalConfigs } from '@craft-agent/shared/auth';
    const requests = [];
    let fail = false;
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(req) {
      const url = new URL(req.url);
      const authorized = req.headers.get('authorization') === 'Bearer fixture-discovery-key';
      requests.push({ path: url.pathname, after: url.searchParams.get('after_id'), authorized });
      if (!authorized) return Response.json({ error: 'unauthorized' }, { status: 401 });
      if (fail || url.pathname.startsWith('/unsupported')) return Response.json({ error: 'not found' }, { status: 404 });
      if (url.pathname === '/v1/models') return Response.json({ data: [{ id: 'relay-a' }, { id: 'relay-b' }] });
      if (url.pathname === '/api/anthropic/v1/models') {
        return url.searchParams.has('after_id')
          ? Response.json({ data: [{ id: 'glm-fixture', display_name: 'GLM Fixture' }], has_more: false })
          : Response.json({ data: [{ id: 'glm-small', display_name: 'GLM Small' }], has_more: true, last_id: 'glm-small' });
      }
      return new Response('', { status: 404 });
    } });
    const base = 'http://127.0.0.1:' + server.port;
    const cm = getCredentialManager();
    const platform = { appRootPath: process.cwd(), isPackaged: false, logger: { info() {}, warn() {}, error() {}, debug() {} } };
    setFetcherPlatform(platform);
    const refresh = initModelRefreshService(async slug => ({ apiKey: await cm.getLlmApiKey(slug) }));
    const callbacks = new Map();
    const rpc = { handle: (channel, fn) => callbacks.set(channel, fn) };
    registerOnboardingHandlers(rpc, { platform });
    registerLlmConnectionsHandlers(rpc, { platform, sessionManager: { reinitializeAuth: async () => {} } });
    const source = ${JSON.stringify(source)};
    const importConfig = async config => {
      writeFileSync(join(source, 'settings.json'), JSON.stringify(config));
      const found = scanLocalConfigs({ directory: source, env: {} }).logins[0];
      return callbacks.get(RPC_CHANNELS.onboarding.IMPORT_LOCAL_API_KEY)({}, found.configId, { directory: source });
    };
    const claudeConfig = { env: { ANTHROPIC_BASE_URL: base + '/api/anthropic', ANTHROPIC_AUTH_TOKEN: 'fixture-discovery-key', ANTHROPIC_MODEL: 'glm-fixture' } };
    const claude = await importConfig(claudeConfig);
    const discovered = getLlmConnection(claude.slug);
    const ids = connection => connection.models.map(m => typeof m === 'string' ? m : m.id);
    const openai = await importConfig({ base_url: base + '/v1', api_key: 'fixture-discovery-key' });
    const discoveredOpenai = getLlmConnection(openai.slug);
    const unsupported = await importConfig({ base_url: base + '/unsupported/v1', api_key: 'fixture-discovery-key' });
    updateLlmConnection(claude.slug, { defaultModel: 'glm-small', models: discovered.models.map(m => ({ ...m, supportsImages: false, contextWindow: 500_000 })) });
    const reimport = await importConfig(claudeConfig);
    const reimported = getLlmConnection(claude.slug);
    fail = true;
    const failedRefresh = await callbacks.get(RPC_CHANNELS.llmConnections.REFRESH_MODELS)({}, claude.slug);
    const afterFailure = getLlmConnection(claude.slug);
    fail = false;
    addLlmConnection({ ...discovered, slug: 'old-import', modelSelectionMode: 'userDefined3Tier', models: ['glm-fixture'] });
    await cm.setLlmApiKey('old-import', 'fixture-discovery-key');
    await refresh.refreshNow('old-import');
    const upgraded = getLlmConnection('old-import');
    const serialized = JSON.stringify({ discovered, discoveredOpenai, unsupported, reimported, afterFailure, upgraded });
    console.log('RESULT:' + JSON.stringify({ claude, ids: ids(discovered), defaultModel: discovered.defaultModel, mode: discovered.modelSelectionMode, openai, openaiIds: ids(discoveredOpenai), openaiDefault: discoveredOpenai.defaultModel, unsupported, reimport, reimportDefault: reimported.defaultModel, visionPreserved: reimported.models.every(m => m.supportsImages === false), failedRefresh, afterFailureIds: ids(afterFailure), upgradedIds: ids(upgraded), requests, secretLeaked: serialized.includes('fixture-discovery-key') }));
    refresh.stopAll(); server.stop(true);
  `;
  try {
    const proc = Bun.spawn([process.execPath, '-e', script], { cwd: resolve(import.meta.dir, '../../../..'), env: { ...process.env, BOAI_HOME: home }, stdout: 'pipe', stderr: 'pipe' });
    const [stdout, stderr, exitCode] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
    results = JSON.parse(stdout.split('\n').find(line => line.startsWith('RESULT:'))!.slice(7));
  } finally { rmSync(root, { recursive: true, force: true }); }
}, 20_000);

it('imports the connection, then discovers all Anthropic pages using its key', () => {
  expect(results.claude.success).toBe(true);
  expect(results.ids).toEqual(['glm-small', 'glm-fixture']);
  expect(results.defaultModel).toBe('glm-fixture');
  expect(results.mode).toBe('automaticallySyncedFromProvider');
  expect(results.requests.slice(0, 2)).toEqual([
    { path: '/api/anthropic/v1/models', after: null, authorized: true },
    { path: '/api/anthropic/v1/models', after: 'glm-small', authorized: true },
  ]);
  expect(results.secretLeaked).toBe(false);
});
it('imports only base URL and key, obtaining selectable models from an OpenAI endpoint', () => {
  expect(results.openai).toMatchObject({ success: true, modelRequired: false });
  expect(results.openaiIds).toEqual(['relay-a', 'relay-b']);
  expect(results.openaiDefault).toBe('relay-a');
});
it('asks for a model only after discovery fails, keeping the stored credential', () => {
  expect(results.unsupported).toMatchObject({ success: true, modelRequired: true });
});
it('reimporting does not duplicate a connection or undo its chosen default and vision settings', () => {
  expect(results.reimport.slug).toBe(results.claude.slug);
  expect(results.reimportDefault).toBe('glm-small');
  expect(results.visionPreserved).toBe(true);
});
it('reports failed refreshes and keeps cached models instead of substituting an unrelated catalog', () => {
  expect(results.failedRefresh.success).toBe(false);
  expect(results.afterFailureIds).toEqual(['glm-small', 'glm-fixture']);
});
it('unlocks and refreshes already-imported single-model connections', () => {
  expect(results.upgradedIds).toEqual(['glm-small', 'glm-fixture']);
});
