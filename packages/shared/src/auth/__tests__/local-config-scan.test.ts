import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scanLocalConfigs, readScannedApiKeyConfig } from '../local-config-scan';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'boai-directory-scan-'))); dirs.push(root);
  const options = { directory: root, env: {}, userHome: root };
  const write = (file: string, content: string | object) => {
    const path = join(root, file); mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content)); return path;
  };
  return { root, options, write, scan: () => scanLocalConfigs(options), read: (id: string) => readScannedApiKeyConfig(id, options) };
}
const openai = { baseUrl: 'https://relay.example/v1', apiKey: 'fixture-openai-key', model: 'relay-model' };

describe('chosen configuration directory', () => {
  it('reads non-default Codex homes and returns the exact source file', () => {
    const f = fixture();
    const source = f.write('alternate/config.toml', 'model_provider="relay"\nmodel="gpt-model"\n[model_providers.relay]\nbase_url="https://codex.example/v1"\nrequires_openai_auth=true');
    f.write('alternate/auth.json', { auth_mode: 'apikey', OPENAI_API_KEY: 'fixture-codex-key' });
    expect(f.scan().logins).toMatchObject([{ sourceId: 'codex-api-key', sourcePath: source, api: 'openai-responses', usable: true }]);
    expect(f.read(f.scan().logins[0]!.configId)?.apiKey).toBe('fixture-codex-key');
  });
  it('finds OAuth accounts in non-default homes without returning tokens', () => {
    const f = fixture(); f.write('alternate/auth.json', { auth_mode: 'chatgpt', tokens: { access_token: 'fixture-access', refresh_token: 'fixture-refresh', account_id: 'fixture-account' } });
    expect(f.scan().logins).toMatchObject([{ authType: 'oauth', sourcePath: join(f.root, 'alternate/auth.json') }]);
    expect(JSON.stringify(f.scan())).not.toContain('fixture-access');
    expect(JSON.stringify(f.scan())).not.toContain('fixture-refresh');
  });
  it('reads Claude Code env tokens, endpoint and model as Anthropic protocol', () => {
    const f = fixture(); const path = f.write('.claude/settings.json', { env: { ANTHROPIC_BASE_URL: 'https://claude.example', ANTHROPIC_AUTH_TOKEN: 'fixture-claude-token', ANTHROPIC_MODEL: 'claude-model' } });
    expect(f.scan().logins).toMatchObject([{ sourceId: 'claude-code-api-key', sourcePath: path, provider: 'anthropic', api: 'anthropic-messages', model: 'claude-model', usable: true }]);
    expect(f.read(f.scan().logins[0]!.configId)?.apiKey).toBe('fixture-claude-token');
    expect(JSON.stringify(f.scan())).not.toContain('fixture-claude-token');
  });
  it('reads Claude API keys and a top-level model from settings.local.json', () => {
    const f = fixture(); f.write('settings.local.json', { model: 'my-model', env: { ANTHROPIC_API_KEY: 'fixture-anthropic-key' } });
    expect(f.scan().logins).toMatchObject([{ provider: 'anthropic', model: 'my-model', baseUrl: 'https://api.anthropic.com', usable: true }]);
  });
  for (const [name, content] of [
    ['providers.json', { providers: { relay: openai } }],
    ['providers.toml', '[providers.relay]\nbase_url="https://relay.example/v1"\napi_key="fixture-openai-key"\nmodel="relay-model"'],
    ['providers.yaml', 'providers:\n  relay:\n    base_url: https://relay.example/v1\n    api_key: fixture-openai-key\n    model: relay-model'],
    ['.env.local', 'export OPENAI_BASE_URL="https://relay.example/v1"\nOPENAI_API_KEY=fixture-openai-key\nOPENAI_MODEL=relay-model'],
  ] as const) {
    it(`recognizes OpenAI fields in ${name}`, () => {
      const f = fixture(); f.write(name, content);
      expect(f.scan().logins).toMatchObject([{ provider: 'openai', api: 'openai-completions', model: 'relay-model', usable: true }]);
      expect(f.read(f.scan().logins[0]!.configId)?.apiKey).toBe('fixture-openai-key');
      expect(JSON.stringify(f.scan())).not.toContain('fixture-openai-key');
    });
  }
  it('keeps multiple providers and files separate even with identical endpoints', () => {
    const f = fixture(); f.write('one.json', { providers: [{ ...openai, apiKey: 'first-key' }, { ...openai, apiKey: 'second-key' }] }); f.write('two.json', openai);
    const found = f.scan().logins; expect(found).toHaveLength(3);
    expect(new Set(found.map(row => row.configId)).size).toBe(3);
    expect(found.map(row => f.read(row.configId)?.apiKey)).toEqual(['first-key', 'second-key', 'fixture-openai-key']);
  });
  it('never pairs credentials from one sibling with another endpoint', () => {
    const f = fixture(); f.write('config.json', { a: { base_url: openai.baseUrl, model: openai.model }, b: { api_key: 'wrong-sibling-key' } });
    expect(f.scan().logins).toMatchObject([{ hasApiKey: false, usable: false, issue: 'missing-api-key' }]);
  });
  it('resolves only explicit environment references using an adjacent .env file', () => {
    const f = fixture(); f.write('.env', 'RELAY_KEY=reference-key'); f.write('client.json', { ...openai, apiKey: '${RELAY_KEY}' });
    expect(f.read(f.scan().logins[0]!.configId)?.apiKey).toBe('reference-key');
  });
  it('requires credentials but leaves model selection to discovery', () => {
    const f = fixture(); f.write('config.json', [{ base_url: openai.baseUrl, api_key: '$MISSING_KEY' }, { base_url: openai.baseUrl, api_key: 'fixture-key' }]);
    expect(f.scan().logins).toMatchObject([{ issue: 'missing-api-key', envKey: 'MISSING_KEY' }, { usable: true, hasApiKey: true }]);
  });
  it('rejects stale scan identities when endpoint or model changes', () => {
    const f = fixture(); f.write('client.json', openai); const id = f.scan().logins[0]!.configId;
    f.write('client.json', { ...openai, baseUrl: 'https://other.example/v1' }); expect(f.read(id)).toBeNull();
  });
  it('keeps identity stable across key rotation and reads the current key', () => {
    const f = fixture(); f.write('client.json', openai); const id = f.scan().logins[0]!.configId;
    f.write('client.json', { ...openai, apiKey: 'rotated-fixture-key' }); expect(f.read(id)?.apiKey).toBe('rotated-fixture-key');
  });
  it('skips broken and unrelated files without exposing their text', () => {
    const f = fixture(); f.write('broken.json', '{ "api_key": "private-parse-error'); f.write('package.json', { dependencies: { openai: '^1.0.0' } }); f.write('client.json', openai);
    expect(f.scan().logins).toHaveLength(1); expect(JSON.stringify(f.scan())).not.toContain('private-parse-error');
  });
  it('does not follow symlinks outside the selected directory or scan dependency folders', () => {
    const f = fixture(); const outside = fixture(); outside.write('client.json', openai);
    symlinkSync(outside.root, join(f.root, 'outside')); f.write('node_modules/client.json', openai); expect(f.scan().logins).toHaveLength(0);
  });
  it('bounds scan depth and file size and reports partial results', () => {
    const f = fixture(); f.write('a/b/c/d/hidden.json', openai); f.write('huge.json', ' '.repeat(1024 * 1024 + 1)); f.write('visible.json', openai);
    expect(f.scan()).toMatchObject({ truncated: true }); expect(f.scan().logins).toHaveLength(1);
  });
  it('rejects an unavailable selected directory without falling back to defaults', () => {
    const f = fixture(); expect(() => scanLocalConfigs({ ...f.options, directory: join(f.root, 'missing') })).toThrow('selected configuration directory');
  });
  it('default scans honor CODEX_HOME and CLAUDE_CONFIG_DIR', () => {
    const f = fixture(); f.write('codex/auth.json', { auth_mode: 'apikey', OPENAI_API_KEY: 'fixture-codex-key' });
    f.write('claude/settings.json', { env: { ANTHROPIC_API_KEY: 'fixture-claude-key', ANTHROPIC_MODEL: 'claude-model' } });
    const result = scanLocalConfigs({ env: { CODEX_HOME: join(f.root, 'codex'), CLAUDE_CONFIG_DIR: join(f.root, 'claude') }, userHome: f.root });
    expect(result.logins.map(row => row.sourceId).sort()).toEqual(['claude-code-api-key', 'codex-api-key']);
  });
  it('marks unsupported protocols or headers for manual completion', () => {
    const f = fixture(); f.write('client.json', { ...openai, headers: { 'X-Extra': 'private-header' } });
    expect(f.scan().logins).toMatchObject([{ issue: 'unsupported-config', usable: false }]); expect(JSON.stringify(f.scan())).not.toContain('private-header');
  });
  it('pairs mixed OpenAI field conventions without silently using the default endpoint', () => {
    const f = fixture(); f.write('settings.json', { base_url: openai.baseUrl, OPENAI_API_KEY: 'mixed-key', model: 'model' });
    expect(f.scan().logins).toMatchObject([{ baseUrl: openai.baseUrl, usable: true }]);
    f.write('settings.json', { OPENAI_BASE_URL: openai.baseUrl, api_key: 'mixed-key', model: 'model' });
    expect(f.scan().logins).toMatchObject([{ baseUrl: openai.baseUrl, usable: true }]);
  });
  it('resolves Claude aliases while preserving an explicit custom model', () => {
    const f = fixture(); f.write('settings.json', { model: 'opus', env: { ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-relay', ANTHROPIC_DEFAULT_OPUS_MODEL: 'opus-relay' } });
    expect(f.scan().logins).toMatchObject([{ model: 'opus-relay' }]);
    f.write('settings.json', { model: 'custom-model', env: { ANTHROPIC_API_KEY: 'fixture-key', ANTHROPIC_DEFAULT_SONNET_MODEL: 'sonnet-relay' } });
    expect(f.scan().logins).toMatchObject([{ model: 'custom-model' }]);
  });
  it('never executes shell expressions stored in env files', () => {
    const f = fixture(); f.write('.env', 'OPENAI_BASE_URL=https://relay.example/v1\nOPENAI_API_KEY="$(touch should-not-exist)"\nOPENAI_MODEL=model');
    expect(f.scan().logins).toMatchObject([{ issue: 'unsupported-config', usable: false }]);
  });
  it('removes Claude Code context modifiers from direct models and mapped aliases', () => {
    const f = fixture();
    for (const model of ['glm-fixture[1m]', 'sonnet[1m]']) {
      f.write('settings.json', { model, env: { ANTHROPIC_AUTH_TOKEN: 'fixture-token', ANTHROPIC_BASE_URL: 'https://glm.example/api/anthropic', ANTHROPIC_DEFAULT_SONNET_MODEL: 'glm-fixture[1m]' } });
      expect(f.scan().logins).toMatchObject([{ model: 'glm-fixture', usable: true }]);
    }
    f.write('settings.json', { ...openai, model: 'literal[1m]' });
    expect(f.scan().logins).toMatchObject([{ model: 'literal[1m]' }]);
  });
});
