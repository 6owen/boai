import { describe, it, expect } from 'bun:test';
import { importLocalLoginAsConnection } from './local-login-import';
import { getLocalLoginConfigId, type LocalLoginTokens } from '@craft-agent/shared/auth';
import { createBuiltInConnection } from '@craft-agent/server-core/domain';
import type { LlmConnection } from '@craft-agent/shared/config';

function fixture() {
  let tokens: LocalLoginTokens = { accessToken: 'fake-access', refreshToken: 'fake-refresh', accountId: 'account-a', expiresAt: Date.now() + 3600_000 };
  const connections: LlmConnection[] = [createBuiltInConnection('chatgpt-plus')];
  const credentials = new Map([['chatgpt-plus', 'manually-signed-in-account']]);
  let defaultSlug: string | null = 'chatgpt-plus';
  const deps = {
    readTokens: () => tokens,
    listConnections: () => connections,
    addConnection: (connection: LlmConnection) => { connections.push(connection); return true; },
    writeTokens: async (slug: string, value: LocalLoginTokens) => { credentials.set(slug, value.accessToken); },
    deleteCredentials: async (slug: string) => { credentials.delete(slug); },
    getDefault: () => defaultSlug,
    setDefault: (slug: string) => { defaultSlug = slug; },
    refreshModels: async () => {},
  };
  const params = () => ({ sourceId: 'codex-cli', slug: 'chatgpt-plus', expectedConfigId: getLocalLoginConfigId(tokens) });
  return { deps, connections, credentials, params, changeAccount: () => { tokens = { ...tokens, accountId: 'account-b', accessToken: 'fake-b' }; } };
}

describe('explicit local account import', () => {
  it('preserves a manually signed-in account and its default selection', async () => {
    const f = fixture();
    expect((await importLocalLoginAsConnection(f.params(), f.deps)).slug).toBe('chatgpt-plus-2');
    expect(f.credentials.get('chatgpt-plus')).toBe('manually-signed-in-account');
    expect(f.deps.getDefault()).toBe('chatgpt-plus');
  });
  it('reuses only its own matching account on repeated and concurrent imports', async () => {
    const f = fixture();
    const results = await Promise.all([importLocalLoginAsConnection(f.params(), f.deps), importLocalLoginAsConnection(f.params(), f.deps)]);
    expect(results.map(result => result.slug)).toEqual(['chatgpt-plus-2', 'chatgpt-plus-2']);
    expect(f.connections).toHaveLength(2);
  });
  it('allocates a separate connection when the CLI logs into another account', async () => {
    const f = fixture();
    await importLocalLoginAsConnection(f.params(), f.deps);
    f.changeAccount();
    expect((await importLocalLoginAsConnection(f.params(), f.deps)).slug).toBe('chatgpt-plus-3');
    expect(f.credentials.get('chatgpt-plus-2')).toBe('fake-access');
  });
  it('rejects stale results if the account changes between scanning and importing', async () => {
    const f = fixture(); const selected = f.params(); f.changeAccount();
    expect(await importLocalLoginAsConnection(selected, f.deps)).toEqual({ success: false, error: 'config-changed' });
    expect(f.credentials.size).toBe(1);
  });
  it('preserves an imported connection after the user signs in manually', async () => {
    const f = fixture(); await importLocalLoginAsConnection(f.params(), f.deps);
    f.connections[1]!.localImport = undefined;
    f.credentials.set('chatgpt-plus-2', 'other-manual-account');
    expect((await importLocalLoginAsConnection(f.params(), f.deps)).slug).toBe('chatgpt-plus-3');
    expect(f.credentials.get('chatgpt-plus-2')).toBe('other-manual-account');
  });
  it('removes orphaned credentials when persistence fails', async () => {
    const f = fixture(); f.deps.addConnection = () => false;
    expect(await importLocalLoginAsConnection(f.params(), f.deps)).toEqual({ success: false, error: 'save-failed' });
    expect(f.credentials.size).toBe(1);
  });
});
