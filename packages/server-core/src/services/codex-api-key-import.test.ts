import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LlmConnection } from '@craft-agent/shared/config';
import { readCodexApiKeyConfig } from '@craft-agent/shared/auth';
import { importCodexApiKeyAsConnection } from './codex-api-key-import';

async function withFixture(run: (f: ReturnType<typeof fixture>) => Promise<void>) {
  const f = fixture();
  try { await run(f); } finally { rmSync(f.codexHome, { recursive: true, force: true }); }
}
function fixture() {
  const codexHome = mkdtempSync(join(tmpdir(), 'boai-import-'));
  const config = `model = "relay-model"
model_provider = "relay"
[model_providers.relay]
base_url = "https://relay.example/v1"
env_key = "RELAY_KEY"`;
  writeFileSync(join(codexHome, 'config.toml'), config);
  const env: NodeJS.ProcessEnv = { RELAY_KEY: 'import-secret' };
  const connections: LlmConnection[] = [];
  const keys = new Map<string, string>();
  let defaultSlug: string | null = null;
  const deps = {
    readConfig: () => readCodexApiKeyConfig({ codexHome, env }),
    listConnections: () => connections,
    addConnection: (connection: LlmConnection) => { connections.push(connection); return true; },
    writeKey: async (slug: string, key: string) => { keys.set(slug, key); },
    deleteKey: async (slug: string) => { keys.delete(slug); },
    getDefault: () => defaultSlug,
    setDefault: (slug: string) => { defaultSlug = slug; },
  };
  const id = deps.readConfig()!.detected.configId;
  return { codexHome, config, env, connections, keys, deps, id };
}

describe('Codex API-key connection import', () => {
  it('imports the scanned endpoint, protocol and model, with the key only in credential storage', () => withFixture(async f => {
    const result = await importCodexApiKeyAsConnection(f.id, f.deps);
    expect(result).toEqual({ success: true, slug: 'codex-api-key' });
    expect(f.connections).toMatchObject([{
      providerType: 'pi_compat', piAuthProvider: 'openai', authType: 'api_key_with_endpoint',
      baseUrl: 'https://relay.example/v1', customEndpoint: { api: 'openai-responses' },
      defaultModel: 'relay-model', models: ['relay-model'],
      modelSelectionMode: 'automaticallySyncedFromProvider',
    }]);
    expect(f.keys.get(result.slug!)).toBe('import-secret');
    expect(f.deps.getDefault()).toBe(result.slug!);
    expect(JSON.stringify({ result, connections: f.connections })).not.toContain('import-secret');
  }));

  it('reuses its own connection and re-reads a rotated key on repeat imports', () => withFixture(async f => {
    const first = await importCodexApiKeyAsConnection(f.id, f.deps);
    f.env.RELAY_KEY = 'rotated-key';
    expect(await importCodexApiKeyAsConnection(f.id, f.deps)).toEqual(first);
    expect(f.connections).toHaveLength(1);
    expect(f.keys.get(first.slug!)).toBe('rotated-key');
  }));

  it('serializes imports from multiple windows without losing credentials', () => withFixture(async f => {
    const results = await Promise.all([
      importCodexApiKeyAsConnection(f.id, f.deps),
      importCodexApiKeyAsConnection(f.id, f.deps),
    ]);
    expect(results).toEqual([
      { success: true, slug: 'codex-api-key' }, { success: true, slug: 'codex-api-key' },
    ]);
    expect(f.connections).toHaveLength(1);
    expect(f.keys.get('codex-api-key')).toBe('import-secret');
  }));

  it('preserves an existing manual connection and default', () => withFixture(async f => {
    await importCodexApiKeyAsConnection(f.id, f.deps);
    const manual = f.connections[0]!;
    delete manual.localImport;
    f.keys.set(manual.slug, 'manual-key');
    const imported = await importCodexApiKeyAsConnection(f.id, f.deps);
    expect(imported.slug).toBe('codex-api-key-2');
    expect(f.connections).toHaveLength(2);
    expect(f.keys.get(manual.slug)).toBe('manual-key');
    expect(f.deps.getDefault()).toBe(manual.slug);
  }));

  it('does not overwrite an imported connection whose endpoint was manually changed', () => withFixture(async f => {
    await importCodexApiKeyAsConnection(f.id, f.deps);
    f.connections[0]!.baseUrl = 'https://manual.example/v1';
    expect((await importCodexApiKeyAsConnection(f.id, f.deps)).slug).toBe('codex-api-key-2');
    expect(f.connections[0]!.baseUrl).toBe('https://manual.example/v1');
  }));

  it('rejects stale scan results when the endpoint changes before import', () => withFixture(async f => {
    writeFileSync(join(f.codexHome, 'config.toml'), f.config.replace('relay.example', 'changed.example'));
    expect(await importCodexApiKeyAsConnection(f.id, f.deps)).toEqual({ success: false, error: 'config-changed' });
    expect(f.keys.size).toBe(0);
    expect(f.connections).toHaveLength(0);
  }));

  it('does not save a partial connection if the key becomes unavailable', () => withFixture(async f => {
    delete f.env.RELAY_KEY;
    expect(await importCodexApiKeyAsConnection(f.id, f.deps)).toEqual({ success: false, error: 'incomplete-config' });
    expect(f.keys.size).toBe(0);
    expect(f.connections).toHaveLength(0);
  }));

  it('cleans up a newly written credential when connection persistence fails', () => withFixture(async f => {
    f.deps.addConnection = () => false;
    expect(await importCodexApiKeyAsConnection(f.id, f.deps)).toEqual({ success: false, error: 'save-failed' });
    expect(f.keys.size).toBe(0);
    expect(f.deps.getDefault()).toBeNull();
  }));

});
