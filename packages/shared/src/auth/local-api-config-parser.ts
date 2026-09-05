import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';
import { basename, extname } from 'node:path';
import { normalizeConfigEndpoint } from './codex-api-key-detection.ts';
import type { LocalApiKeyConfig, DetectedApiKeyConfig, LocalConfigIssue } from './local-config-types.ts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const normalized = (key: string) => key.replace(/[_-]/g, '').toLowerCase();
function get(record: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const entry = Object.entries(record).find(([name]) => normalized(name) === normalized(key));
    const value = str(entry?.[1]);
    if (value) return value;
  }
}

/** Parse literal dotenv assignments; never evaluate shell expressions. */
export function parseConfigEnv(text: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2]!;
    if (value.startsWith('"') || value.startsWith("'")) {
      const quote = value[0]!;
      const end = value.lastIndexOf(quote);
      if (end === 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) continue;
      value = value.slice(1, end);
    } else value = value.replace(/\s+#.*$/, '').trim();
    env[match[1]!] = value;
  }
  return env;
}

/** Recognize explicit endpoint/key pairs within the same object or env block. */
export function parseLocalApiConfigs(text: string, path: string, env: NodeJS.ProcessEnv = {}): LocalApiKeyConfig[] {
  let document: unknown;
  try {
    const ext = extname(path).toLowerCase();
    document = basename(path).startsWith('.env') || ext === '.env' ? parseConfigEnv(text)
      : ext === '.toml' ? parseToml(text)
      : ['.yaml', '.yml'].includes(ext) ? parseYaml(text, { maxAliasCount: 20 }) : JSON.parse(text);
  } catch { return []; }
  const results: LocalApiKeyConfig[] = [];
  let visited = 0;
  function visit(value: unknown, pointer: string, inheritedModel?: string, depth = 0): void {
    if (++visited > 1000 || depth > 8) return;
    if (Array.isArray(value)) { value.forEach((item, i) => visit(item, `${pointer}/${i}`, inheritedModel, depth + 1)); return; }
    const node = object(value);
    const model = get(node, 'model', 'modelName', 'defaultModel') ?? inheritedModel;
    const environment = object(node.env);
    const fields = Object.keys(environment).length ? { ...node, ...environment } : node;
    const anthropic = !!get(fields, 'ANTHROPIC_BASE_URL', 'ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN');
    const openai = !!get(fields, 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'OPENAI_API_KEY');
    for (const provider of [...(anthropic ? ['anthropic'] as const : []), ...(openai ? ['openai'] as const : []), ...(!anthropic && !openai ? ['generic'] as const : [])]) {
      const isAnthropic = provider === 'anthropic';
      const generic = provider === 'generic';
      const rawUrl = isAnthropic ? get(fields, 'ANTHROPIC_BASE_URL', ...(!openai ? ['baseUrl', 'apiBase', 'apiBaseUrl'] : [])) ?? 'https://api.anthropic.com'
        : get(fields, 'OPENAI_BASE_URL', 'OPENAI_API_BASE', ...(!anthropic ? ['baseUrl', 'apiBase', 'apiBaseUrl'] : [])) ?? (openai ? 'https://api.openai.com/v1' : undefined);
      const rawKey = isAnthropic ? get(fields, 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY', ...(!openai ? ['apiKey'] : []))
        : get(fields, 'OPENAI_API_KEY', ...(!anthropic ? ['apiKey'] : []));
      const envKey = generic ? get(fields, 'envKey', 'apiKeyEnv') : undefined;
      // Require a recognizable pair/schema; unrelated keys named "key" are not AI credentials.
      if (!rawUrl && !rawKey && !envKey) continue;
      if (generic && !rawUrl) continue;
      const reference = rawKey?.match(/^(?:\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)|os\.environ\/([A-Za-z_][A-Za-z0-9_]*))$/);
      const keyVariable = envKey ?? reference?.slice(1).find(Boolean);
      const apiKey = keyVariable ? str(env[keyVariable]) : rawKey;
      const protocol = get(fields, 'api', 'wireApi', 'protocol');
      const api: DetectedApiKeyConfig['api'] = isAnthropic || protocol === 'anthropic-messages' ? 'anthropic-messages'
        : ['responses', 'openai-responses'].includes(protocol ?? '') ? 'openai-responses' : 'openai-completions';
      const actualProvider = api === 'anthropic-messages' ? 'anthropic' : 'openai';
      const sourceId = isAnthropic ? 'claude-code-api-key' : 'openai-config';
      const baseUrl = normalizeConfigEndpoint(rawUrl);
      const configuredModel = get(fields, isAnthropic ? 'ANTHROPIC_MODEL' : 'OPENAI_MODEL') ?? model;
      const alias = (isAnthropic ? configuredModel?.replace(/\[1m\]$/i, '') : configuredModel) ?? 'sonnet';
      const rawSelectedModel = isAnthropic && ['sonnet', 'opus', 'haiku'].includes(alias)
        ? get(fields, `ANTHROPIC_DEFAULT_${alias.toUpperCase()}_MODEL`) ?? configuredModel : configuredModel;
      // Claude Code removes this context-window modifier before sending the model ID.
      // Keep it in the source identity so already-imported configurations are still matched.
      const selectedModel = isAnthropic ? rawSelectedModel?.replace(/\[1m\]$/i, '') : rawSelectedModel;
      const unsupported = !!protocol && !['responses', 'chat', 'openai-responses', 'openai-completions', 'anthropic-messages'].includes(protocol)
        || ['headers', 'httpHeaders', 'envHttpHeaders', 'queryParams', 'apiKeyHelper'].some(key => Object.keys(node).some(name => normalized(name) === normalized(key) && !!node[name]))
        || !!apiKey?.match(/\$\(|`/)
        || (isAnthropic && ['CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY'].some(key => fields[key] === '1' || fields[key] === true));
      const issue: LocalConfigIssue | undefined = unsupported ? 'unsupported-config' : !baseUrl ? 'invalid-base-url'
        : !apiKey ? 'missing-api-key' : undefined;
      const configId = createHash('sha256').update(JSON.stringify([path, pointer, sourceId, baseUrl, rawSelectedModel, api, keyVariable])).digest('hex');
      results.push({ detected: {
        authType: 'api_key', sourceId, configId, sourcePath: path, provider: actualProvider,
        providerName: get(node, 'name', 'providerName') ?? (isAnthropic ? 'Claude Code' : 'OpenAI'),
        baseUrl, model: selectedModel, api, hasApiKey: !!apiKey, usable: !issue,
        ...(issue ? { issue } : {}), ...(keyVariable ? { envKey: keyVariable } : {}),
      }, apiKey });
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'env' || ['mcpServers', 'hooks', 'permissions'].includes(key)) continue;
      if (child && typeof child === 'object') visit(child, `${pointer}/${key}`, model, depth + 1);
    }
  }
  visit(document, '');
  return results;
}
