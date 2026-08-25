/** PI-only authentication state derived from the active LLM connection. */

import { getCredentialManager } from '../credentials/index.ts';
import {
  getActiveWorkspace,
  getDefaultLlmConnection,
  getLlmConnection,
  type AuthType,
} from '../config/storage.ts';
import type { AuthState, SetupNeeds } from './types.ts';

function toLegacyBillingType(
  authType: NonNullable<ReturnType<typeof getLlmConnection>>['authType'],
): AuthType {
  return authType === 'oauth' ? 'oauth_token' : 'api_key';
}

export async function getAuthState(): Promise<AuthState> {
  const manager = getCredentialManager();
  const activeWorkspace = getActiveWorkspace();
  const defaultConnectionSlug = getDefaultLlmConnection();
  const connection = defaultConnectionSlug ? getLlmConnection(defaultConnectionSlug) : null;

  let hasCredentials = false;
  let apiKey: string | null = null;

  if (connection && defaultConnectionSlug) {
    hasCredentials = await manager.hasLlmCredentials(
      defaultConnectionSlug,
      connection.authType,
      connection.providerType,
    );
    if (
      connection.authType === 'api_key'
      || connection.authType === 'api_key_with_endpoint'
      || connection.authType === 'bearer_token'
    ) {
      apiKey = await manager.getLlmApiKey(defaultConnectionSlug);
      if (!apiKey && connection.baseUrl) hasCredentials = true;
    }
  }

  return {
    billing: {
      type: connection ? toLegacyBillingType(connection.authType) : null,
      hasCredentials,
      apiKey,
    },
    workspace: {
      hasWorkspace: !!activeWorkspace,
      active: activeWorkspace,
    },
  };
}

export function getSetupNeeds(state: AuthState, setupDeferred?: boolean): SetupNeeds {
  const needsBillingConfig = state.billing.type === null;
  const needsCredentials = state.billing.type !== null && !state.billing.hasCredentials;
  return {
    needsBillingConfig,
    needsCredentials,
    isFullyConfigured: (!needsBillingConfig && !needsCredentials) || !!setupDeferred,
  };
}
