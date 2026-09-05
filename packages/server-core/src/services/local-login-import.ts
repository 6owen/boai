/** Explicitly import the account selected on the local configuration page. */
import {
  addLlmConnection, getDefaultLlmConnection, getLlmConnections,
  setDefaultLlmConnection, type LlmConnection,
} from '@craft-agent/shared/config';
import { getCredentialManager } from '@craft-agent/shared/credentials';
import {
  readLocalLoginTokens, decodeCodexIdTokenEmail, getLocalLoginConfigId,
  type LocalLoginTokens, type LocalLoginDetectionOptions,
} from '@craft-agent/shared/auth';
import { createBuiltInConnection } from '@craft-agent/server-core/domain';
import { getModelRefreshService } from '@craft-agent/server-core/model-fetchers';

interface ImportDependencies {
  readTokens(sourceId: string, options?: LocalLoginDetectionOptions): LocalLoginTokens | null;
  listConnections(): LlmConnection[];
  addConnection(connection: LlmConnection): boolean;
  writeTokens(slug: string, tokens: LocalLoginTokens): Promise<void>;
  deleteCredentials(slug: string): Promise<void>;
  getDefault(): string | null;
  setDefault(slug: string): void;
  refreshModels(slug: string): Promise<unknown>;
}

/** Only an import of the same account can reuse an existing connection. */
export function resolveImportTargetSlug(
  connections: readonly LlmConnection[],
  requestedSlug: string,
  identity: { sourceId: string; configId: string },
): string {
  const imported = connections.find(connection =>
    connection.localImport?.sourceId === identity.sourceId
    && connection.localImport.configId === identity.configId
    && connection.providerType === 'pi'
    && connection.piAuthProvider === 'openai-codex'
    && connection.authType === 'oauth',
  );
  if (imported) return imported.slug;
  const taken = new Set(connections.map(connection => connection.slug));
  const base = requestedSlug.replace(/-\d+$/, '');
  let slug = requestedSlug;
  for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export interface LocalLoginImportResult {
  success: boolean;
  error?: string;
  accountEmail?: string;
  slug?: string;
}

let importQueue: Promise<void> = Promise.resolve();

export function importLocalLoginAsConnection(params: {
  sourceId: string;
  slug: string;
  expectedConfigId: string;
  codexHome?: string;
}, deps: ImportDependencies = {
  readTokens: readLocalLoginTokens,
  listConnections: getLlmConnections,
  addConnection: addLlmConnection,
  writeTokens: (slug, tokens) => getCredentialManager().setLlmOAuth(slug, tokens),
  deleteCredentials: slug => getCredentialManager().deleteLlmCredentials(slug),
  getDefault: getDefaultLlmConnection,
  setDefault: setDefaultLlmConnection,
  refreshModels: slug => getModelRefreshService().refreshNow(slug),
}): Promise<LocalLoginImportResult> {
  const result = importQueue.then(async (): Promise<LocalLoginImportResult> => {
    const tokens = deps.readTokens(params.sourceId, { codexHome: params.codexHome });
    if (!tokens || !params.expectedConfigId || getLocalLoginConfigId(tokens) !== params.expectedConfigId) {
      return { success: false, error: 'config-changed' };
    }
    const identity = { sourceId: params.sourceId, configId: params.expectedConfigId };
    const connections = deps.listConnections();
    const slug = resolveImportTargetSlug(connections, params.slug, identity);
    await deps.writeTokens(slug, tokens);
    if (!connections.some(connection => connection.slug === slug)) {
      try {
        const connection = { ...createBuiltInConnection(slug), localImport: identity };
        if (!deps.addConnection(connection)) {
          await deps.deleteCredentials(slug);
          return { success: false, error: 'save-failed' };
        }
      } catch {
        await deps.deleteCredentials(slug);
        return { success: false, error: 'save-failed' };
      }
    }
    if (!deps.getDefault()) deps.setDefault(slug);
    try { await deps.refreshModels(slug); } catch { /* Import can succeed without model discovery. */ }
    return { success: true, slug, accountEmail: decodeCodexIdTokenEmail(tokens.idToken) };
  });
  importQueue = result.then(() => undefined, () => undefined);
  return result;
}
