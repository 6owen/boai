import { describe, it, expect, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import {
  readCodexCliChatGptTokens,
  resolveCodexCliHome,
  decodeCodexIdTokenEmail,
  detectLocalLogins,
} from '../local-login-detection';

// ── fixtures ────────────────────────────────────────────────────────────────

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function makeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url(payload)}.test-signature`;
}

const FIXED_EXP_SECONDS = 4102444800; // 2100-01-01T00:00:00Z
const ACCESS_TOKEN = makeJwt({ exp: FIXED_EXP_SECONDS, sub: 'user-1' });
const REFRESH_TOKEN = 'refresh-token-value';
const ID_TOKEN = makeJwt({
  email: 'someone@example.com',
  sub: 'auth0|abc123',
});

interface AuthJsonOverrides {
  auth_mode?: string;
  last_refresh?: string | number;
  omitRefreshToken?: boolean;
  omitIdToken?: boolean;
  includeApiKey?: boolean;
  nonJwtAccessToken?: boolean;
}

function writeAuthJson(dir: string, overrides: AuthJsonOverrides = {}): void {
  const authPath = join(dir, 'auth.json');
  const tokens: Record<string, string> = {
    access_token: ACCESS_TOKEN,
    ...(overrides.omitRefreshToken ? {} : { refresh_token: REFRESH_TOKEN }),
    ...(overrides.omitIdToken ? {} : { id_token: ID_TOKEN }),
    account_id: 'acct-123',
  };
  if (overrides.nonJwtAccessToken) tokens.access_token = 'not-a-jwt';
  const data: Record<string, unknown> = {
    tokens,
    last_refresh: overrides.last_refresh ?? '2026-08-01T00:00:00Z',
  };
  if (overrides.auth_mode !== undefined) data.auth_mode = overrides.auth_mode;
  if (overrides.includeApiKey) data.OPENAI_API_KEY = 'sk-test-key';
  writeFileSync(authPath, JSON.stringify(data));
}

function makeCodexHome(overrides: AuthJsonOverrides = {}): string {
  const dir = mkdtempSync(join(tmpdir(), 'local-login-detection-'));
  writeAuthJson(dir, overrides);
  return dir;
}

const cleanedDirs: string[] = [];
function track(dir: string): string {
  cleanedDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of cleanedDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── readCodexCliChatGptTokens ───────────────────────────────────────────────

describe('readCodexCliChatGptTokens', () => {
  it('parses chatgpt-mode tokens with expiresAt from the access token JWT exp', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt' }));
    const result = readCodexCliChatGptTokens({ codexHome: home });

    expect(result).not.toBeNull();
    expect(result!.accessToken).toBe(ACCESS_TOKEN);
    expect(result!.refreshToken).toBe(REFRESH_TOKEN);
    expect(result!.idToken).toBe(ID_TOKEN);
    expect(result!.accountId).toBe('acct-123');
    expect(result!.expiresAt).toBe(FIXED_EXP_SECONDS * 1000);
  });

  it('accepts case-insensitive chatgpt auth_mode variants', () => {
    for (const mode of ['ChatGPT', 'CHATGPT', 'chatgptauthtokens', 'ChatGPTAuthTokens']) {
      const home = track(makeCodexHome({ auth_mode: mode }));
      expect(readCodexCliChatGptTokens({ codexHome: home })).not.toBeNull();
    }
  });

  it('treats a file without auth_mode but without OPENAI_API_KEY as chatgpt tokens', () => {
    const home = track(makeCodexHome({}));
    expect(readCodexCliChatGptTokens({ codexHome: home })).not.toBeNull();
  });

  it('returns null when auth_mode says api key', () => {
    for (const mode of ['apikey', 'api_key', 'APIKEY']) {
      const home = track(makeCodexHome({ auth_mode: mode }));
      expect(readCodexCliChatGptTokens({ codexHome: home })).toBeNull();
    }
  });

  it('returns null when no auth_mode but OPENAI_API_KEY is present', () => {
    const home = track(makeCodexHome({ includeApiKey: true }));
    expect(readCodexCliChatGptTokens({ codexHome: home })).toBeNull();
  });

  it('returns null when the refresh token is missing', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt', omitRefreshToken: true }));
    expect(readCodexCliChatGptTokens({ codexHome: home })).toBeNull();
  });

  it('returns null when auth.json does not exist', () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    expect(readCodexCliChatGptTokens({ codexHome: dir })).toBeNull();
  });

  it('falls back to last_refresh + 60min when the access token has no decodable exp', () => {
    const lastRefresh = '2026-08-01T12:00:00Z';
    const dir = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    writeAuthJson(dir, { auth_mode: 'chatgpt', last_refresh: lastRefresh, nonJwtAccessToken: true });

    const result = readCodexCliChatGptTokens({ codexHome: dir });
    expect(result).not.toBeNull();
    expect(result!.expiresAt).toBe(new Date(lastRefresh).getTime() + 60 * 60 * 1000);
  });

  it('honors the CODEX_HOME environment variable', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt' }));
    const result = readCodexCliChatGptTokens({ env: { CODEX_HOME: home } });
    expect(result).not.toBeNull();
    expect(result!.refreshToken).toBe(REFRESH_TOKEN);
  });

  it('reads through a symlinked CODEX_HOME', () => {
    const real = track(makeCodexHome({ auth_mode: 'chatgpt' }));
    const link = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    const linkPath = join(link, 'home-link');
    symlinkSync(real, linkPath);
    expect(readCodexCliChatGptTokens({ env: { CODEX_HOME: linkPath } })).not.toBeNull();
  });

  it('does not include the id_token when absent', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt', omitIdToken: true }));
    const result = readCodexCliChatGptTokens({ codexHome: home });
    expect(result).not.toBeNull();
    expect(result!.idToken).toBeUndefined();
  });
});

// ── resolveCodexCliHome ─────────────────────────────────────────────────────

describe('resolveCodexCliHome', () => {
  it('prefers CODEX_HOME over the default ~/.codex', () => {
    const custom = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    expect(resolveCodexCliHome({ CODEX_HOME: custom })).toBe(custom);
  });

  it('defaults to ~/.codex', () => {
    expect(resolveCodexCliHome({})).toBe(join(homedir(), '.codex'));
  });
});

// ── decodeCodexIdTokenEmail ─────────────────────────────────────────────────

describe('decodeCodexIdTokenEmail', () => {
  it('extracts the email claim from the id_token JWT', () => {
    expect(decodeCodexIdTokenEmail(ID_TOKEN)).toBe('someone@example.com');
  });

  it('returns undefined for a non-JWT id_token', () => {
    expect(decodeCodexIdTokenEmail('not-a-jwt')).toBeUndefined();
  });

  it('returns undefined for undefined input', () => {
    expect(decodeCodexIdTokenEmail(undefined)).toBeUndefined();
  });
});

// ── detectLocalLogins ───────────────────────────────────────────────────────

describe('detectLocalLogins', () => {
  it('returns a token-free DTO with provider, email, expiry, and usable flag', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt' }));
    const logins = detectLocalLogins({ env: { CODEX_HOME: home }, force: true });

    expect(logins).toHaveLength(1);
    const login = logins[0]!;
    if (login.authType !== 'oauth') throw new Error('Expected an OAuth login');
    expect(login.sourceId).toBe('codex-cli');
    expect(login.provider).toBe('openai-codex');
    expect(login.accountEmail).toBe('someone@example.com');
    expect(login.expiresAt).toBe(FIXED_EXP_SECONDS * 1000);
    expect(login.usable).toBe(true);
    // Token material must never leak into the DTO.
    for (const value of Object.values(login)) {
      const serialized = String(value);
      expect(serialized.includes(ACCESS_TOKEN)).toBe(false);
      expect(serialized.includes(REFRESH_TOKEN)).toBe(false);
    }
  });

  it('marks an expired login as not usable but still reports it', () => {
    const expiredExpSeconds = Math.floor(Date.now() / 1000) - 3600; // 1h ago
    const dir = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    const authPath = join(dir, 'auth.json');
    writeAuthJson(dir, { auth_mode: 'chatgpt' });
    const raw = JSON.parse(readFileSync(authPath, 'utf8'));
    raw.tokens.access_token = makeJwt({ exp: expiredExpSeconds });
    writeFileSync(authPath, JSON.stringify(raw));

    const logins = detectLocalLogins({ env: { CODEX_HOME: dir }, force: true });
    expect(logins).toHaveLength(1);
    expect(logins[0]!.usable).toBe(false);
  });

  it('returns an empty array when no local login exists', () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'local-login-detection-')));
    expect(detectLocalLogins({ env: { CODEX_HOME: dir }, force: true })).toEqual([]);
  });

  it('caches results within the TTL window and refreshes on file change', () => {
    const home = track(makeCodexHome({ auth_mode: 'chatgpt' }));

    const first = detectLocalLogins({ env: { CODEX_HOME: home }, force: true });
    expect(first).toHaveLength(1);

    // Same fingerprint within TTL → cached path returns the same DTO shape.
    const second = detectLocalLogins({ env: { CODEX_HOME: home } });
    expect(second).toEqual(first);

    // Switching to API-key mode immediately replaces the cached OAuth result.
    writeAuthJson(home, { auth_mode: 'apikey', includeApiKey: true });
    expect(detectLocalLogins({ env: { CODEX_HOME: home }, force: true })).toMatchObject([
      { sourceId: 'codex-api-key', authType: 'api_key', hasApiKey: true },
    ]);
  });
});
