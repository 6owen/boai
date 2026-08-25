import { describe, expect, it } from 'bun:test';
import {
  connectionAuthTypeToBackendAuthType,
  connectionTypeToProvider,
  createAgent,
  createBackend,
  detectProvider,
  getAvailableProviders,
  initializeBackendHostRuntime,
  isProviderAvailable,
  providerTypeToAgentProvider,
  resolveModelForProvider,
  resolveSetupTestConnectionHint,
  validateStoredBackendConnection,
} from '../factory.ts';
import type { BackendConfig } from '../types.ts';
import { PiAgent } from '../../pi-agent.ts';
import type { LlmConnection, Workspace } from '../../../config/storage.ts';
import type { SessionConfig } from '../../../sessions/storage.ts';
import { isValidProviderAuthCombination } from '../../../config/llm-connections.ts';

function createTestConfig(overrides: Partial<BackendConfig> = {}): BackendConfig {
  const workspace: Workspace = {
    id: 'test-workspace',
    name: 'Test Workspace',
    slug: 'workspace',
    rootPath: '/test/workspace',
    createdAt: Date.now(),
  };
  const session: SessionConfig = {
    id: 'test-session',
    name: 'Test Session',
    workspaceRootPath: workspace.rootPath,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
    permissionMode: 'ask',
  };
  return { provider: 'pi', workspace, session, isHeadless: true, ...overrides };
}

describe('PI-only backend factory', () => {
  it('always detects and creates the PI backend', () => {
    expect(detectProvider('api_key')).toBe('pi');
    expect(detectProvider('oauth_token')).toBe('pi');
    expect(createBackend(createTestConfig())).toBeInstanceOf(PiAgent);
    expect(createAgent).toBe(createBackend);
  });

  it('advertises PI as the only backend', () => {
    expect(getAvailableProviders()).toEqual(['pi']);
    expect(isProviderAvailable('pi')).toBe(true);
    expect(isProviderAvailable('unknown' as never)).toBe(false);
  });

  it('routes connection provider types through PI', () => {
    expect(providerTypeToAgentProvider('pi')).toBe('pi');
    expect(providerTypeToAgentProvider('pi_compat')).toBe('pi');
    expect(connectionTypeToProvider('anthropic')).toBe('pi');
    expect(connectionTypeToProvider('openai')).toBe('pi');
    expect(connectionTypeToProvider('openai-compat')).toBe('pi');
  });

  it('keeps generic PI authentication mappings', () => {
    expect(connectionAuthTypeToBackendAuthType('api_key')).toBe('api_key');
    expect(connectionAuthTypeToBackendAuthType('oauth')).toBe('oauth');
    expect(connectionAuthTypeToBackendAuthType('none')).toBeUndefined();
    expect(isValidProviderAuthCombination('pi', 'api_key')).toBe(true);
    expect(isValidProviderAuthCombination('pi', 'oauth')).toBe(true);
    expect(isValidProviderAuthCombination('pi', 'none')).toBe(true);
    expect(isValidProviderAuthCombination('pi_compat', 'api_key_with_endpoint')).toBe(true);
  });

  it('initializes the PI host runtime', () => {
    expect(() => initializeBackendHostRuntime({
      hostRuntime: { appRootPath: process.cwd(), isPackaged: false },
    })).not.toThrow();
  });

  it('resolves setup hints to native PI or PI-compatible connections', () => {
    expect(resolveSetupTestConnectionHint({ provider: 'pi' })).toEqual({
      providerType: 'pi',
      piAuthProvider: undefined,
    });
    expect(resolveSetupTestConnectionHint({
      provider: 'pi',
      baseUrl: 'https://example.com/v1',
      customEndpoint: { api: 'openai-completions' },
    })).toEqual({
      providerType: 'pi_compat',
      piAuthProvider: 'openai',
      customEndpoint: { api: 'openai-completions' },
    });
  });

  it('rejects a missing stored connection', async () => {
    const result = await validateStoredBackendConnection({
      slug: '__missing-connection__',
      hostRuntime: { appRootPath: process.cwd(), isPackaged: false },
    });
    expect(result).toEqual({ success: false, error: 'Connection not found' });
  });

  it('uses a valid connection default when the selected model is stale', () => {
    const connection = {
      providerType: 'pi',
      defaultModel: 'pi/model-a',
      models: ['pi/model-a', 'pi/model-b'],
    } as LlmConnection;
    expect(resolveModelForProvider('pi', 'pi/stale', connection)).toBe('pi/model-a');
  });

  it('supports runtime model switching on PI', () => {
    const agent = createBackend(createTestConfig({ model: 'pi/model-a' }));
    agent.setModel('pi/model-b');
    expect(agent.getModel()).toBe('pi/model-b');
  });
});
