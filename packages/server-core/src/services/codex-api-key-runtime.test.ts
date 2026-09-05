import { expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelRegistry, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { InMemoryCredentialStore, InMemoryModelsStore } from '@earendil-works/pi-ai';
import { readCodexApiKeyConfig } from '@craft-agent/shared/auth';
import { StoredConfigSchema } from '@craft-agent/shared/config/validators';
import type { LlmConnection } from '@craft-agent/shared/config';
import { buildCustomEndpointModelDef } from '../../../pi-agent-server/src/custom-endpoint-models';
import { importCodexApiKeyAsConnection } from './codex-api-key-import';
import { fetchCompatibleModels } from '../../../shared/src/agent/backend/internal/drivers/compatible-models';

it('uses an imported Codex Responses connection for a real SDK request to the configured endpoint', async () => {
  let requestPath = '';
  let requestAuth = '';
  let requestBody: Record<string, unknown> = {};
  const message = { id: 'msg_test', type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Connected', annotations: [] }] };
  const events = [
    { type: 'response.created', response: { id: 'resp_test', status: 'in_progress' } },
    { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'Connected' },
    { type: 'response.output_item.done', output_index: 0, item: message },
    { type: 'response.completed', response: { id: 'resp_test', status: 'completed', output: [message],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
  ];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    requestPath = new URL(request.url).pathname;
    requestAuth = request.headers.get('authorization') ?? '';
    requestBody = await request.json() as Record<string, unknown>;
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  } });
  const codexHome = mkdtempSync(join(tmpdir(), 'boai-codex-runtime-'));
  try {
    writeFileSync(join(codexHome, 'config.toml'), `model = "relay-model"
model_provider = "relay"
[model_providers.relay]
base_url = "http://127.0.0.1:${server.port}/v1"
env_key = "RELAY_KEY"
wire_api = "responses"`);
    const readConfig = () => readCodexApiKeyConfig({ codexHome, env: { RELAY_KEY: 'runtime-fixture-key' } });
    const connections: LlmConnection[] = [];
    const keys = new Map<string, string>();
    const imported = await importCodexApiKeyAsConnection(readConfig()!.detected.configId, {
      readConfig, listConnections: () => connections,
      addConnection: connection => { connections.push(connection); return true; },
      writeKey: async (slug, key) => { keys.set(slug, key); },
      deleteKey: async slug => { keys.delete(slug); },
      getDefault: () => null, setDefault: () => {},
    });
    expect(imported.success).toBe(true);
    const connection = connections[0]!;
    expect(StoredConfigSchema.safeParse({
      workspaces: [], activeWorkspaceId: null, activeSessionId: null, llmConnections: [connection],
    }).success).toBe(true);

    // Same in-memory runtime, registry and model builder used by the Pi subprocess.
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(), modelsPath: null,
      modelsStore: new InMemoryModelsStore(), allowModelNetwork: false,
    });
    const registry = new ModelRegistry(runtime);
    registry.registerProvider('custom-endpoint', {
      baseUrl: connection.baseUrl!, apiKey: keys.get(connection.slug)!,
      api: connection.customEndpoint!.api, authHeader: true,
      models: [buildCustomEndpointModelDef(connection.defaultModel!, undefined, undefined, connection.customEndpoint!.api)],
    });
    const model = registry.find('custom-endpoint', 'relay-model')!;
    expect(model.api).toBe('openai-responses');
    const response = await runtime.completeSimple(model, {
      messages: [{ role: 'user', content: 'Connection test', timestamp: Date.now() }],
    }, { signal: AbortSignal.timeout(5_000) });
    expect(response.stopReason).toBe('stop');
    expect(response.content).toMatchObject([{ type: 'text', text: 'Connected' }]);
    expect(requestPath).toBe('/v1/responses');
    expect(requestAuth).toBe('Bearer runtime-fixture-key');
    expect(requestBody.model).toBe('relay-model');
    expect(requestBody.input).toBeArray();
    expect(requestBody.messages).toBeUndefined();
  } finally {
    server.stop(true);
    rmSync(codexHome, { recursive: true, force: true });
  }
}, 10_000);

it('discovers and switches models with a scanned Claude Code token using the Anthropic protocol', async () => {
  const { scanLocalConfigs, readScannedApiKeyConfig } = await import('@craft-agent/shared/auth');
  let requestPath = '', bearer = '', apiKeyHeader = '';
  const requestedModels: unknown[] = [];
  const events = [
    { type: 'message_start', message: { id: 'msg_fixture', type: 'message', role: 'assistant', model: 'claude-fixture', content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Connected' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } },
    { type: 'message_stop' },
  ];
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/v1/models') {
      return Response.json({ data: [{ id: 'claude-fixture' }, { id: 'glm-another-model' }] });
    }
    requestPath = new URL(request.url).pathname;
    requestedModels.push((await request.json() as { model: string }).model);
    bearer = request.headers.get('authorization') ?? '';
    apiKeyHeader = request.headers.get('x-api-key') ?? '';
    return new Response(events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  const directory = mkdtempSync(join(tmpdir(), 'boai-claude-runtime-'));
  try {
    writeFileSync(join(directory, 'settings.json'), JSON.stringify({ env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.port}`, ANTHROPIC_AUTH_TOKEN: 'fixture-bearer-token', ANTHROPIC_MODEL: 'claude-fixture' } }));
    const options = { directory, env: {} };
    const id = scanLocalConfigs(options).logins[0]!.configId;
    const connections: LlmConnection[] = [];
    const keys = new Map<string, string>();
    const result = await importCodexApiKeyAsConnection(id, {
      readConfig: () => readScannedApiKeyConfig(id, options), listConnections: () => connections,
      addConnection: connection => { connections.push(connection); return true; },
      writeKey: async (slug, key) => { keys.set(slug, key); }, deleteKey: async slug => { keys.delete(slug); },
      getDefault: () => null, setDefault: () => {},
    });
    expect(result.success).toBe(true);
    const connection = connections[0]!;
    const discovered = await fetchCompatibleModels(connection, keys.get(connection.slug), 5_000);
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStore: new InMemoryModelsStore(), allowModelNetwork: false });
    const registry = new ModelRegistry(runtime);
    registry.registerProvider('custom-endpoint', { baseUrl: connection.baseUrl!, apiKey: keys.get(connection.slug)!, api: connection.customEndpoint!.api, authHeader: true,
      models: discovered.models.map(model => buildCustomEndpointModelDef(model.id, undefined, undefined, connection.customEndpoint!.api)) });
    for (const selectedModel of ['claude-fixture', 'glm-another-model']) {
      const model = registry.find('custom-endpoint', selectedModel)!;
      const response = await runtime.completeSimple(model, { messages: [{ role: 'user', content: 'Connection test', timestamp: Date.now() }] }, { signal: AbortSignal.timeout(5_000) });
      expect(response.stopReason).toBe('stop');
      expect(response.content).toMatchObject([{ type: 'text', text: 'Connected' }]);
    }
    expect(requestedModels).toEqual(['claude-fixture', 'glm-another-model']);
    expect(connection.defaultModel).toBe('claude-fixture');
    expect(requestPath).toBe('/v1/messages');
    expect(bearer).toBe('Bearer fixture-bearer-token');
    expect(apiKeyHeader === '' || apiKeyHeader === 'fixture-bearer-token').toBe(true);
  } finally { server.stop(true); rmSync(directory, { recursive: true, force: true }); }
}, 10_000);
