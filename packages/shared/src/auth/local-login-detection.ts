/**
 * @input  Codex auth.json, config.toml and process environment (honors CODEX_HOME)
 * @output Secret-free OAuth/API configuration DTOs, plus server-only credential readers
 * @pos    OpenClaw-style local login scan — runs only when requested from the local configuration page, never contacts the network
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { DetectedApiKeyConfig } from './local-config-types.ts';
import { readCodexApiKeyConfig } from './codex-api-key-detection.ts';
export { readCodexApiKeyConfig } from './codex-api-key-detection.ts';
export type { DetectedCodexApiKey, CodexApiKeyConfig, CodexConfigIssue } from './codex-api-key-detection.ts';

const CODEX_CLI_AUTH_FILENAME = 'auth.json';
const CODEX_CLI_FALLBACK_EXPIRY_MS = 60 * 60 * 1000;
/** Detection freshness window, aligned with OpenClaw EXTERNAL_CLI_SYNC_TTL_MS. */
const DETECTION_TTL_MS = 15 * 60 * 1000;

/** A local login or API configuration found on this machine. Never contains secrets. */
export type DetectedLogin = DetectedOAuthLogin | DetectedApiKeyConfig;

export interface DetectedOAuthLogin {
  authType: 'oauth';
  sourcePath?: string;
  /** Opaque account identity used to match the explicitly selected scan result. */
  configId: string;
  /** Detection source id, e.g. 'codex-cli'. */
  sourceId: string;
  /** piAuthProvider this login can power, e.g. 'openai-codex'. */
  provider: string;
  /** Account email decoded from the id_token (display only). */
  accountEmail?: string;
  /** Access-token expiry in Unix ms. */
  expiresAt: number;
  /** False when the access token is expired (refresh may still recover it). */
  usable: boolean;
}

/** Full OAuth tokens read from a local CLI store — server-side import use only. */
export interface LocalLoginTokens {
  accessToken: string;
  refreshToken: string;
  idToken?: string;
  accountId?: string;
  /** Access-token expiry in Unix ms (JWT exp, or last_refresh + 1h fallback). */
  expiresAt: number;
}

export interface LocalLoginDetectionOptions {
  /** Explicit Codex home directory (skips resolution). */
  codexHome?: string;
  /** Environment to read CODEX_HOME from; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Resolve the Codex CLI home directory. External CLI state belongs to the OS
 * user, not to BoAI's relocatable config dir, so the default is always ~/.codex
 * unless CODEX_HOME says otherwise.
 */
export function resolveCodexCliHome(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.CODEX_HOME?.trim();
  return resolve(configured || join(homedir(), '.codex'));
}

/**
 * ChatGPT-token mode matches the Codex CLI contract: an explicit auth_mode wins
 * ("chatgpt" / "chatgptauthtokens"); without one, tokens are the active mode
 * only when no OPENAI_API_KEY is stored (mirrors OpenClaw's reader).
 */
function authJsonUsesChatGptTokens(data: Record<string, unknown>): boolean {
  const authMode = typeof data.auth_mode === 'string' ? data.auth_mode.toLowerCase() : undefined;
  if (authMode) {
    return authMode === 'chatgpt' || authMode === 'chatgptauthtokens';
  }
  return typeof data.OPENAI_API_KEY !== 'string';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  const encodedPayload = parts.length >= 2 ? parts[1] : undefined;
  if (!encodedPayload) {
    return null;
  }
  try {
    const payload: unknown = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    return payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function decodeJwtExpiryMs(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) {
    return null;
  }
  return exp * 1000;
}

function lastRefreshFallbackMs(lastRefresh: unknown): number {
  const base =
    typeof lastRefresh === 'string' || typeof lastRefresh === 'number'
      ? new Date(lastRefresh).getTime()
      : Number.NaN;
  return (Number.isFinite(base) ? base : Date.now()) + CODEX_CLI_FALLBACK_EXPIRY_MS;
}

/**
 * Read ChatGPT tokens from the local Codex CLI login (read-only; the file is
 * never written back and token material is never logged).
 * Returns null when there is no usable ChatGPT login (missing file, API-key
 * mode, or incomplete tokens).
 */
export function readCodexCliChatGptTokens(
  options: LocalLoginDetectionOptions = {},
): LocalLoginTokens | null {
  const codexHome = options.codexHome ?? resolveCodexCliHome(options.env);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(codexHome, CODEX_CLI_AUTH_FILENAME), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const data = raw as Record<string, unknown>;
  if (!authJsonUsesChatGptTokens(data)) {
    return null;
  }

  const tokens = data.tokens;
  if (!tokens || typeof tokens !== 'object' || Array.isArray(tokens)) {
    return null;
  }
  const tokenFields = tokens as Record<string, unknown>;
  const accessToken = typeof tokenFields.access_token === 'string' ? tokenFields.access_token : '';
  const refreshToken =
    typeof tokenFields.refresh_token === 'string' ? tokenFields.refresh_token : '';
  if (!accessToken || !refreshToken) {
    return null;
  }

  const expiresAt = decodeJwtExpiryMs(accessToken) ?? lastRefreshFallbackMs(data.last_refresh);

  return {
    accessToken,
    refreshToken,
    idToken:
      typeof tokenFields.id_token === 'string' && tokenFields.id_token
        ? tokenFields.id_token
        : undefined,
    accountId:
      typeof tokenFields.account_id === 'string' && tokenFields.account_id
        ? tokenFields.account_id
        : undefined,
    expiresAt,
  };
}

/** Extract the account email from a Codex id_token JWT (display only). */
export function decodeCodexIdTokenEmail(idToken: string | undefined): string | undefined {
  if (!idToken) {
    return undefined;
  }
  const email = decodeJwtPayload(idToken)?.email;
  return typeof email === 'string' && email.trim() ? email.trim() : undefined;
}

/** Stable across token refreshes; never exposes account IDs or token material. */
export function getLocalLoginConfigId(tokens: LocalLoginTokens): string {
  const payload = tokens.idToken ? decodeJwtPayload(tokens.idToken) : null;
  const subject = typeof payload?.sub === 'string' ? payload.sub : decodeCodexIdTokenEmail(tokens.idToken);
  return createHash('sha256').update(JSON.stringify([
    tokens.accountId ?? null, subject ?? null,
    tokens.accountId || subject ? null : tokens.accessToken,
  ])).digest('hex');
}

// ── detection registry ──────────────────────────────────────────────────────

interface LocalLoginSource {
  id: string;
  provider: string;
  credentialPath: (env: NodeJS.ProcessEnv) => string;
  read: (options: LocalLoginDetectionOptions) => LocalLoginTokens | null;
  emailOf: (tokens: LocalLoginTokens) => string | undefined;
}

// Additional sources (claude-code ~/.claude/.credentials.json, gemini-cli
// ~/.gemini/oauth_creds.json) slot in here later without touching callers.
const SOURCES: LocalLoginSource[] = [
  {
    id: 'codex-cli',
    provider: 'openai-codex',
    credentialPath: (env) => join(resolveCodexCliHome(env), CODEX_CLI_AUTH_FILENAME),
    read: (options) => readCodexCliChatGptTokens(options),
    emailOf: (tokens) => decodeCodexIdTokenEmail(tokens.idToken),
  },
];

interface DetectionCacheEntry {
  cacheKey: string;
  fingerprint: number | null;
  readAt: number;
  value: DetectedOAuthLogin | null;
}

const detectionCache = new Map<string, DetectionCacheEntry>();

function credentialFingerprint(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

export interface DetectLocalLoginsOptions {
  /** Bypass the TTL cache and re-read from disk. */
  force?: boolean;
  /** Environment for source resolution; defaults to process.env. */
  env?: NodeJS.ProcessEnv;
  /** Clock override for expiry evaluation (tests). */
  now?: number;
}

/**
 * Scan the active Codex configuration. Pure file/environment reads — no
 * network or Keychain. OAuth results use an auth-file mtime + TTL cache;
 * API configs are read afresh because files and environment jointly select
 * the endpoint/key. API configurations and active OAuth accounts are listed separately.
 */
export function detectLocalLogins(options: DetectLocalLoginsOptions = {}): DetectedLogin[] {
  const env = options.env ?? process.env;
  // API configs span auth.json, config.toml and environment variables. Read them
  // afresh rather than retaining keys or a stale auth-file-only fingerprint.
  const apiConfig = readCodexApiKeyConfig({ codexHome: resolveCodexCliHome(env), env });
  const now = options.now ?? Date.now();
  const results: DetectedLogin[] = apiConfig ? [apiConfig.detected] : [];

  for (const source of SOURCES) {
    const env = options.env ?? process.env;
    const cacheKey = `${source.id}:${source.credentialPath(env)}`;
    const fingerprint = credentialFingerprint(source.credentialPath(env));
    const cached = detectionCache.get(source.id);

    if (
      !options.force &&
      cached &&
      cached.cacheKey === cacheKey &&
      cached.fingerprint === fingerprint &&
      now - cached.readAt < DETECTION_TTL_MS
    ) {
      if (cached.value) {
        results.push({ ...cached.value, usable: cached.value.expiresAt > now });
      }
      continue;
    }

    const tokens = source.read({ env });
    const value: DetectedOAuthLogin | null = tokens
      ? {
          authType: 'oauth',
          configId: getLocalLoginConfigId(tokens),
          sourceId: source.id,
          provider: source.provider,
          ...(source.emailOf(tokens) ? { accountEmail: source.emailOf(tokens) } : {}),
          expiresAt: tokens.expiresAt,
          usable: tokens.expiresAt > now,
        }
      : null;
    detectionCache.set(source.id, {
      cacheKey,
      fingerprint,
      readAt: now,
      value,
    });
    if (value) {
      results.push(value);
    }
  }

  return results;
}

/** Read full tokens for a detection source (server-side import path only). */
export function readLocalLoginTokens(
  sourceId: string,
  options: LocalLoginDetectionOptions = {},
): LocalLoginTokens | null {
  const source = SOURCES.find((entry) => entry.id === sourceId);
  return source ? source.read(options) : null;
}
