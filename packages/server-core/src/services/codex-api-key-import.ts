import {
  addLlmConnection, getLlmConnections, getDefaultLlmConnection,
  setDefaultLlmConnection,
  type LlmConnection,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import { readScannedApiKeyConfig, type LocalApiKeyImportOptions, readCodexApiKeyConfig, resolveCodexCliHome, type LocalApiKeyConfig } from '@craft-agent/shared/auth';

interface ImportDependencies {
  readConfig(): LocalApiKeyConfig | null;
  listConnections(): LlmConnection[];
  addConnection(connection: LlmConnection): boolean;
  writeKey(slug: string, key: string): Promise<void>;
  deleteKey(slug: string): Promise<void>;
  getDefault(): string | null;
  setDefault(slug: string): void;
}

export interface CodexApiKeyImportResult {
  success: boolean;
  slug?: string;
  error?: 'config-changed' | 'incomplete-config' | 'save-failed';
}

// Multiple windows can import concurrently. Serialize slug allocation and
// credential persistence so a failed duplicate cannot erase the winning key.
let importQueue: Promise<void> = Promise.resolve();

/**
 * Re-read secrets at import time and require the same endpoint/model the user
 * selected. Only credentials travel into CredentialManager; RPC returns a slug.
 */
export function importCodexApiKeyAsConnection(
  configId: string,
  deps: ImportDependencies = {
    readConfig: () => readCodexApiKeyConfig({ codexHome: resolveCodexCliHome() }),
    listConnections: getLlmConnections,
    addConnection: addLlmConnection,
    writeKey: (slug, key) => getCredentialManager().setLlmApiKey(slug, key),
    deleteKey: (slug) => getCredentialManager().deleteLlmCredentials(slug),
    getDefault: getDefaultLlmConnection,
    setDefault: setDefaultLlmConnection,
  },
): Promise<CodexApiKeyImportResult> {
  const result = importQueue.then(() => performImport(configId, deps));
  importQueue = result.then(() => undefined, () => undefined);
  return result;
}

export function importScannedApiKeyAsConnection(configId: string, options: LocalApiKeyImportOptions = {}) {
  return importCodexApiKeyAsConnection(configId, {
    readConfig: () => readScannedApiKeyConfig(configId, options),
    listConnections: getLlmConnections,
    addConnection: addLlmConnection,
    writeKey: (slug, key) => getCredentialManager().setLlmApiKey(slug, key),
    deleteKey: slug => getCredentialManager().deleteLlmCredentials(slug),
    getDefault: getDefaultLlmConnection,
    setDefault: setDefaultLlmConnection,
  });
}

async function performImport(configId: string, deps: ImportDependencies): Promise<CodexApiKeyImportResult> {
  const config = deps.readConfig();
  if (!config || config.detected.configId !== configId) return { success: false, error: 'config-changed' };
  const { detected, apiKey } = config;
  if (!detected.usable || !apiKey || !detected.baseUrl) return { success: false, error: 'incomplete-config' };

  const model = detected.model;
  const connections = deps.listConnections();
  // Preserve manually created/edited connections even when they share the URL.
  const existing = connections.find(connection =>
    connection.localImport?.sourceId === detected.sourceId
    && connection.localImport.configId === configId
    && connection.baseUrl === detected.baseUrl
    && connection.customEndpoint?.api === detected.api
    && connection.providerType === 'pi_compat'
    && connection.piAuthProvider === detected.provider
    && connection.authType === 'api_key_with_endpoint',
  );
  const baseSlug = detected.sourceId === 'openai-config' ? 'local-api-key' : detected.sourceId;
  let slug = existing?.slug ?? baseSlug;
  if (!existing) {
    const taken = new Set(connections.map(connection => connection.slug));
    for (let n = 2; taken.has(slug); n++) slug = `${baseSlug}-${n}`;
  }

  await deps.writeKey(slug, apiKey);
  if (!existing) {
    try {
      const saved = deps.addConnection({
        slug,
        name: detected.sourceId === 'codex-api-key' ? `Codex · ${detected.providerName}` : `${detected.providerName} · API Key`,
        providerType: 'pi_compat',
        piAuthProvider: detected.provider,
        authType: 'api_key_with_endpoint',
        baseUrl: detected.baseUrl,
        customEndpoint: { api: detected.api },
        defaultModel: model,
        models: model ? [model] : [],
        modelSelectionMode: 'automaticallySyncedFromProvider',
        localImport: { sourceId: detected.sourceId, configId },
        createdAt: Date.now(),
      });
      if (!saved) {
        await deps.deleteKey(slug);
        return { success: false, error: 'save-failed' };
      }
    } catch {
      await deps.deleteKey(slug);
      return { success: false, error: 'save-failed' };
    }
  }
  if (!deps.getDefault()) deps.setDefault(slug);
  return { success: true, slug };
}
