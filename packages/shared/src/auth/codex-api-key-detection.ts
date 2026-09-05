/**
 * Read the active user-level Codex API configuration. Never executes shell or
 * credential commands, contacts an endpoint, or includes secrets in scan DTOs.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse } from 'smol-toml';

import type { DetectedApiKeyConfig, LocalConfigIssue } from './local-config-types.ts';
export type CodexConfigIssue = LocalConfigIssue;
export interface DetectedCodexApiKey extends DetectedApiKeyConfig {
  sourceId: 'codex-api-key';
  provider: 'openai';
  api: 'openai-responses' | 'openai-completions';
}

export interface CodexApiKeyConfig {
  detected: DetectedCodexApiKey;
  /** Server-side only. Never spread this object into an RPC response. */
  apiKey?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function readOptional(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** Only public endpoint metadata is eligible for the renderer and connection config. */
export function normalizeConfigEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

export function readCodexApiKeyConfig(options: {
  codexHome: string;
  env?: NodeJS.ProcessEnv;
}): CodexApiKeyConfig | null {
  const env = options.env ?? process.env;
  let config: Record<string, unknown>;
  let auth: Record<string, unknown>;
  try {
    config = record(parse(readOptional(join(options.codexHome, 'config.toml')) ?? ''));
    auth = record(JSON.parse(readOptional(join(options.codexHome, 'auth.json')) ?? '{}'));
    // Older Codex releases support a default profile embedded in config.toml.
    const profile = str(config.profile);
    if (profile) {
      const selected = record(record(config.profiles)[profile]);
      if (!Object.keys(selected).length) throw new Error('Missing selected profile');
      config = { ...config, ...selected };
    }
  } catch {
    // Parse errors can contain source lines with secrets. Do not return/log them.
    return { detected: {
      sourceId: 'codex-api-key', authType: 'api_key', provider: 'openai',
      providerName: 'Codex', sourcePath: join(options.codexHome, 'config.toml'),
      configId: createHash('sha256').update(resolve(options.codexHome) + ':invalid').digest('hex'), api: 'openai-responses',
      hasApiKey: false, usable: false, issue: 'invalid-config',
    } };
  }

  const providerId = str(config.model_provider) ?? 'openai';
  const isOpenAi = providerId === 'openai';
  const provider = record(record(config.model_providers)[providerId]);
  const authMode = str(auth.auth_mode)?.toLowerCase();
  const usesChatGpt = authMode
    ? ['chatgpt', 'chatgptauthtokens'].includes(authMode)
    : typeof auth.OPENAI_API_KEY !== 'string' && !!auth.tokens;
  const storedKey = usesChatGpt ? undefined : str(auth.OPENAI_API_KEY);
  const envKey = str(provider.env_key);
  const directKey = str(provider.experimental_bearer_token);
  const rawUrl = isOpenAi
    ? str(config.openai_base_url) ?? str(env.OPENAI_BASE_URL) ?? str(provider.base_url) ?? 'https://api.openai.com/v1'
    : str(provider.base_url);

  // Do not turn an existing ChatGPT login into an unrelated API-key connection
  // just because the parent shell happens to export OPENAI_API_KEY.
  if (isOpenAi && usesChatGpt && !envKey && !directKey) return null;
  const apiKey = envKey ? str(env[envKey]) : directKey
    ?? ((!usesChatGpt && (isOpenAi || provider.requires_openai_auth === true)) ? storedKey ?? str(env.OPENAI_API_KEY) : undefined);
  if (isOpenAi && !apiKey && !authMode && !config.openai_base_url && !env.OPENAI_BASE_URL
    && !Object.keys(provider).length) return null;

  const baseUrl = normalizeConfigEndpoint(rawUrl);
  const model = str(config.model);
  const wireApi = str(provider.wire_api) ?? 'responses';
  // Support legacy Codex "chat" providers as well as current Responses providers.
  const api = wireApi === 'chat' ? 'openai-completions' : 'openai-responses';
  const unsupported = !['responses', 'chat'].includes(wireApi)
    || (!isOpenAi && !Object.keys(provider).length)
    || !!provider.auth
    || [provider.http_headers, provider.env_http_headers, provider.query_params]
      .some(value => Object.keys(record(value)).length > 0);
  const issue: CodexConfigIssue | undefined = unsupported ? 'unsupported-config'
    : !baseUrl ? 'invalid-base-url'
    : !apiKey ? 'missing-api-key'
    : undefined;
  const configId = createHash('sha256')
    .update(JSON.stringify([resolve(options.codexHome), providerId, baseUrl, model, api])).digest('hex');
  return {
    detected: {
      sourceId: 'codex-api-key', authType: 'api_key', provider: 'openai',
      providerName: str(provider.name) ?? (isOpenAi ? 'OpenAI' : providerId),
      configId, sourcePath: join(options.codexHome, Object.keys(config).length ? 'config.toml' : 'auth.json'), baseUrl, model, api, hasApiKey: !!apiKey,
      usable: !issue, ...(issue ? { issue } : {}), ...(envKey ? { envKey } : {}),
    },
    apiKey,
  };
}
