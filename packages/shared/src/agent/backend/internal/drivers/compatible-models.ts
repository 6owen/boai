import type { LlmConnection } from '../../../../config/llm-connections.ts';
import type { ModelFetchResult } from '../../../../config/model-fetcher.ts';
import type { ModelDefinition } from '../../../../config/models.ts';

/** Discover models from the configured endpoint, without guessing another provider's catalog. */
export async function fetchCompatibleModels(
  connection: LlmConnection,
  apiKey: string | undefined,
  timeoutMs: number,
): Promise<ModelFetchResult> {
  if (!connection.baseUrl || !connection.customEndpoint) throw new Error('Model discovery requires an endpoint and protocol');
  const url = new URL(connection.baseUrl);
  const anthropic = connection.customEndpoint.api === 'anthropic-messages';
  const basePath = url.pathname.replace(/\/+$/, '');
  url.pathname = `${basePath}${anthropic && !basePath.endsWith('/v1') ? '/v1' : ''}/models`;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (apiKey) headers.authorization = `Bearer ${apiKey}`;
  if (anthropic) {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
    url.searchParams.set('limit', '100');
  }
  const models = new Map<string, ModelDefinition>();
  const cursors = new Set<string>();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    for (let page = 0; page < 20; page++) {
      const response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`Model list request failed (HTTP ${response.status})`);
      const result = await response.json() as { data?: unknown[]; has_more?: boolean; last_id?: string };
      if (!Array.isArray(result.data)) throw new Error('The endpoint did not return a model list');
      for (const entry of result.data) {
        if (!entry || typeof entry !== 'object') continue;
        const row = entry as Record<string, unknown>;
        if (typeof row.id !== 'string' || !row.id.trim()) continue;
        const id = row.id.trim();
        const name = typeof row.display_name === 'string' ? row.display_name : typeof row.name === 'string' ? row.name : id;
        const contextWindow = typeof row.context_window === 'number' ? row.context_window : typeof row.context_length === 'number' ? row.context_length : undefined;
        models.set(id, { id, name, shortName: name, description: '', provider: 'pi', contextWindow: contextWindow && contextWindow > 0 ? contextWindow : 131_072 });
      }
      if (!result.has_more) {
        if (!models.size) throw new Error('The endpoint returned no models');
        return { models: [...models.values()] };
      }
      if (!result.last_id || cursors.has(result.last_id)) throw new Error('The endpoint returned an invalid model page');
      cursors.add(result.last_id);
      url.searchParams.set('after_id', result.last_id);
    }
    throw new Error('The model list exceeded the pagination limit');
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Model list request timed out');
    // Parsing and network errors can contain response data. Never include secrets in errors.
    const message = error instanceof Error ? error.message : 'Model discovery failed';
    throw new Error(apiKey ? message.replaceAll(apiKey, '[redacted]').slice(0, 300) : message.slice(0, 300));
  } finally { clearTimeout(timer); }
}
