import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectLocalLogins, readCodexApiKeyConfig } from '../local-login-detection';

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true })));
function fixture(config = '', auth?: object) {
  const codexHome = mkdtempSync(join(tmpdir(), 'boai-codex-api-'));
  dirs.push(codexHome);
  writeFileSync(join(codexHome, 'config.toml'), config);
  if (auth) writeFileSync(join(codexHome, 'auth.json'), JSON.stringify(auth));
  return {
    codexHome,
    read: (env: NodeJS.ProcessEnv = {}) => readCodexApiKeyConfig({ codexHome, env }),
    scan: (env: NodeJS.ProcessEnv = {}) => detectLocalLogins({ env: { ...env, CODEX_HOME: codexHome } }),
  };
}
const auth = { auth_mode: 'apikey', OPENAI_API_KEY: 'fixture-file-key' };
const relay = `model = "relay-model"
model_provider = "relay"
[model_providers.relay]
name = "My relay"
base_url = "https://relay.example/v1/"
requires_openai_auth = true
`;

describe('Codex API configuration detection', () => {
  it('scans a standard auth.json key without exposing its value', () => {
    const f = fixture('model = "custom-model"', auth);
    expect(f.read()?.apiKey).toBe(auth.OPENAI_API_KEY);
    expect(f.scan()).toMatchObject([{
      sourceId: 'codex-api-key', authType: 'api_key', provider: 'openai',
      baseUrl: 'https://api.openai.com/v1', model: 'custom-model',
      api: 'openai-responses', hasApiKey: true, usable: true,
    }]);
    expect(JSON.stringify(f.scan())).not.toContain(auth.OPENAI_API_KEY);
    expect(JSON.stringify(f.scan())).not.toContain('apiKey');
  });

  it('combines the active custom provider with the auth file and defaults to Responses', () => {
    const f = fixture(relay, auth);
    expect(f.read()).toMatchObject({ apiKey: auth.OPENAI_API_KEY, detected: {
      providerName: 'My relay', model: 'relay-model', baseUrl: 'https://relay.example/v1',
      api: 'openai-responses', usable: true,
    } });
  });

  it('reads legacy API-key auth files without auth_mode', () => {
    expect(fixture('', { OPENAI_API_KEY: 'legacy-key' }).read()?.apiKey).toBe('legacy-key');
  });

  it('resolves env_key without mixing in a stored key or another provider', () => {
    const f = fixture(`${relay}env_key = "RELAY_API_KEY"
[model_providers.unused]
base_url = "https://wrong.example/v1"
experimental_bearer_token = "unused-secret"
`, auth);
    const env = { RELAY_API_KEY: 'fixture-env-key', OPENAI_API_KEY: 'wrong-key' };
    expect(f.read(env)?.apiKey).toBe('fixture-env-key');
    expect(f.read(env)?.detected.baseUrl).toBe('https://relay.example/v1');
    expect(f.read({ OPENAI_API_KEY: 'wrong-key' })?.detected).toMatchObject({
      usable: false, hasApiKey: false, issue: 'missing-api-key', envKey: 'RELAY_API_KEY',
    });
    expect(JSON.stringify(f.scan(env))).not.toContain('fixture-env-key');
    expect(JSON.stringify(f.scan(env))).not.toContain('unused-secret');
  });

  it('reads a direct bearer token and the legacy chat wire protocol', () => {
    const f = fixture(`${relay}experimental_bearer_token = 'direct-secret'
wire_api = "chat"
`, auth);
    expect(f.read()).toMatchObject({ apiKey: 'direct-secret', detected: { api: 'openai-completions' } });
  });

  it('honors openai_base_url before OPENAI_BASE_URL', () => {
    const env = { OPENAI_API_KEY: 'env-openai-key', OPENAI_BASE_URL: 'https://env.example/v1' };
    expect(fixture().read(env)?.detected.baseUrl).toBe('https://env.example/v1');
    expect(fixture('openai_base_url = "https://config.example/v1"').read(env)?.detected.baseUrl)
      .toBe('https://config.example/v1');
  });

  it('uses the selected legacy default profile model and provider', () => {
    const f = fixture(`${relay}
[profiles.work]
model = "profile-model"
model_provider = "work"
[model_providers.work]
base_url = "https://work.example/v1"
env_key = "WORK_KEY"
`);
    const path = join(f.codexHome, 'config.toml');
    writeFileSync(path, `profile = "work"\n${readFileSync(path, 'utf8')}`);
    expect(f.read({ WORK_KEY: 'profile-key' })).toMatchObject({
      apiKey: 'profile-key', detected: { baseUrl: 'https://work.example/v1', model: 'profile-model' },
    });
  });

  it('handles TOML quoted provider names, comments and multiline strings', () => {
    const f = fixture(`model_provider = 'my.proxy'
model = 'model#one' # comment
[model_providers.'my.proxy']
name = """My
proxy"""
base_url = 'https://relay.example/v1'
experimental_bearer_token = 'key#with#hash'
`);
    expect(f.read()).toMatchObject({ apiKey: 'key#with#hash', detected: {
      model: 'model#one', providerName: 'My\nproxy', usable: true,
    } });
  });

  it('notices config and environment changes without waiting for the OAuth cache TTL', () => {
    const f = fixture(`${relay}env_key = "RELAY_KEY"`);
    const first = f.scan({ RELAY_KEY: 'one' })[0]!;
    expect(first.usable).toBe(true);
    expect(f.scan()[0]?.usable).toBe(false);
    writeFileSync(join(f.codexHome, 'config.toml'), relay.replace('relay.example', 'new.example'));
    writeFileSync(join(f.codexHome, 'auth.json'), JSON.stringify(auth));
    expect(f.scan()[0]).toMatchObject({ baseUrl: 'https://new.example/v1', usable: true });
    expect(f.read()?.detected.configId).not.toBe('configId' in first ? first.configId : undefined);
  });

  it('keeps configuration identity stable across key rotation', () => {
    const f = fixture(`${relay}env_key = "KEY"`);
    expect(f.read({ KEY: 'first' })?.detected.configId).toBe(f.read({ KEY: 'second' })?.detected.configId);
  });

  it('does not treat a ChatGPT login or its tokens as an API key', () => {
    const oauth = { auth_mode: 'chatgpt', OPENAI_API_KEY: 'stale-api-key', tokens: {
      access_token: 'oauth-access', refresh_token: 'oauth-refresh',
    } };
    const f = fixture('', oauth);
    expect(f.read({ OPENAI_API_KEY: 'unrelated-shell-key' })).toBeNull();
    expect(f.scan()).toMatchObject([{ authType: 'oauth', sourceId: 'codex-cli' }]);
    const custom = fixture(relay, oauth);
    expect(custom.read({ OPENAI_API_KEY: 'unrelated-shell-key' })).toMatchObject({
      apiKey: undefined, detected: { issue: 'missing-api-key', usable: false },
    });
  });

  it('lists API configuration and an active OAuth account as separate choices', () => {
    const f = fixture(`${relay}env_key = "MISSING_KEY"`, { auth_mode: 'chatgpt', tokens: {
      access_token: 'oauth-access', refresh_token: 'oauth-refresh',
    } });
    expect(f.scan()).toMatchObject([
      { authType: 'api_key', issue: 'missing-api-key', usable: false },
      { authType: 'oauth', sourceId: 'codex-cli', usable: true },
    ]);
  });

  it('does not borrow the global OpenAI key for a custom provider without OpenAI auth', () => {
    const f = fixture(relay.replace('requires_openai_auth = true', ''), auth);
    expect(f.read({ OPENAI_API_KEY: 'unrelated-key' })?.detected.issue).toBe('missing-api-key');
  });

  it('accepts endpoint and key without a model for later discovery', () => {
    expect(fixture(relay.replace('model = "relay-model"', ''), auth).read()?.detected).toMatchObject({ usable: true });
  });

  it('reports invalid TOML without returning the source line or falling back to OpenAI', () => {
    const f = fixture('experimental_bearer_token = "secret-in-parse-error', auth);
    expect(f.scan()).toMatchObject([{ usable: false, issue: 'invalid-config' }]);
    expect(JSON.stringify(f.scan())).not.toContain('secret-in-parse-error');
  });

  it('does not expose embedded URL credentials or query secrets', () => {
    for (const url of ['https://user:password@relay.example/v1', 'https://relay.example/v1?key=secret', 'file:///secret']) {
      const f = fixture(relay.replace('https://relay.example/v1/', url), auth);
      expect(f.scan()).toMatchObject([{ usable: false, issue: 'invalid-base-url', baseUrl: undefined }]);
      expect(JSON.stringify(f.scan())).not.toContain(url);
    }
  });

  it('flags unsupported headers, commands and protocols without executing anything', () => {
    for (const extra of ['http_headers = { Authorization = "secret" }',
      'query_params = { api_version = "v1" }', 'wire_api = "unknown"',
      'auth = { command = "must-never-run" }']) {
      const f = fixture(`${relay}${extra}`, auth);
      expect(f.scan()).toMatchObject([{ usable: false, issue: 'unsupported-config' }]);
      expect(JSON.stringify(f.scan())).not.toContain('secret');
    }
  });

  it('only reads the Codex files and leaves their contents unchanged', () => {
    const f = fixture(relay, auth);
    const before = ['auth.json', 'config.toml'].map(name => readFileSync(join(f.codexHome, name), 'utf8'));
    f.scan();
    expect(['auth.json', 'config.toml'].map(name => readFileSync(join(f.codexHome, name), 'utf8'))).toEqual(before);
  });

  it('returns no candidate when Codex has no API configuration', () => {
    expect(fixture().scan()).toEqual([]);
  });
});
