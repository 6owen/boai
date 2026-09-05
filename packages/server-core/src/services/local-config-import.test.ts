import { afterEach, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanLocalConfigs, readScannedApiKeyConfig, type LocalApiKeyImportOptions } from '@craft-agent/shared/auth';
import type { LlmConnection } from '@craft-agent/shared/config';
import { importCodexApiKeyAsConnection } from './codex-api-key-import';
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(content: object) {
  const directory = mkdtempSync(join(tmpdir(), 'boai-generic-import-')); dirs.push(directory);
  writeFileSync(join(directory, 'settings.json'), JSON.stringify(content));
  const options = { directory, env: {} };
  const detected = scanLocalConfigs(options).logins[0]!;
  const connections: LlmConnection[] = [];
  const keys = new Map<string, string>();
  const run = (overrides: LocalApiKeyImportOptions = {}) => importCodexApiKeyAsConnection(detected.configId, {
    readConfig: () => readScannedApiKeyConfig(detected.configId, { ...options, ...overrides }),
    listConnections: () => connections,
    addConnection: connection => { connections.push(connection); return true; },
    writeKey: async (slug, key) => { keys.set(slug, key); },
    deleteKey: async slug => { keys.delete(slug); },
    getDefault: () => 'manual-account', setDefault: () => { throw new Error('must preserve manual default'); },
  });
  return { directory, detected, keys, connections, run };
}
it('imports a Claude Code token into an Anthropic-compatible connection', async () => {
  const f = fixture({ env: { ANTHROPIC_BASE_URL: 'https://claude.example', ANTHROPIC_API_KEY: 'fixture-claude-key', ANTHROPIC_MODEL: 'claude-model' } });
  const result = await f.run();
  expect(result).toMatchObject({ success: true, slug: 'claude-code-api-key' });
  expect(f.connections).toMatchObject([{ piAuthProvider: 'anthropic', customEndpoint: { api: 'anthropic-messages' }, defaultModel: 'claude-model' }]);
  expect(f.keys.get(result.slug!)).toBe('fixture-claude-key');
});
it('imports general OpenAI JSON and reuses only the same source', async () => {
  const f = fixture({ base_url: 'https://openai.example/v1', api_key: 'fixture-openai-key', model: 'model', api: 'openai-responses' });
  expect(await f.run()).toEqual({ success: true, slug: 'local-api-key' });
  expect(await f.run()).toEqual({ success: true, slug: 'local-api-key' });
  expect(f.connections).toHaveLength(1);
  expect(f.connections[0]?.customEndpoint?.api).toBe('openai-responses');
});
it('imports endpoint and key without imposing a model', async () => {
  const f = fixture({ baseUrl: 'https://relay.example/v1', apiKey: 'fixture-preserved-key' });
  expect(await f.run()).toEqual({ success: true, slug: 'local-api-key' });
  expect(f.keys.get('local-api-key')).toBe('fixture-preserved-key');
  expect(f.connections[0]?.defaultModel).toBeUndefined();
  expect(f.connections[0]?.models).toEqual([]);
  expect(f.connections[0]?.modelSelectionMode).toBe('automaticallySyncedFromProvider');
});
it('does not bypass unsupported settings by supplying a model', async () => {
  const f = fixture({ baseUrl: 'https://relay.example/v1', apiKey: 'fixture-key', protocol: 'unknown' });
  expect(await f.run({ model: 'chosen-model' })).toMatchObject({ success: false, error: 'incomplete-config' });
  expect(f.keys.size).toBe(0);
});
it('rejects importing the selected configuration from another directory', async () => {
  const f = fixture({ baseUrl: 'https://relay.example/v1', apiKey: 'fixture-key', model: 'model' });
  const other = fixture({ baseUrl: 'https://relay.example/v1', apiKey: 'different-key', model: 'model' });
  expect(await f.run({ directory: other.directory })).toEqual({ success: false, error: 'config-changed' });
  expect(f.keys.size).toBe(0);
});
