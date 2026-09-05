/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { getAuthState, getSetupNeeds, detectLocalLogins, scanLocalConfigs, type LocalConfigScanOptions, type LocalApiKeyImportOptions } from '@craft-agent/shared/auth'
import { getLlmConnection, setSetupDeferred } from '@craft-agent/shared/config'
import { prepareMcpOAuth } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import { getModelRefreshService } from '../../model-fetchers'
import { importCodexApiKeyAsConnection, importScannedApiKeyAsConnection } from '../../services/codex-api-key-import'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.DETECT_LOCAL_LOGINS,
  RPC_CHANNELS.onboarding.IMPORT_CODEX_API_KEY,
  RPC_CHANNELS.onboarding.SCAN_LOCAL_CONFIGS,
  RPC_CHANNELS.onboarding.IMPORT_LOCAL_API_KEY,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState)
    // Redact raw credentials — renderer only needs boolean flags (hasCredentials, setupNeeds)
    return {
      authState: {
        ...authState,
        billing: {
          ...authState.billing,
          apiKey: authState.billing.apiKey ? '••••' : null,
        },
      },
      setupNeeds,
    }
  })

  // onboarding:detectLocalLogins — token-free local login scan for the
  // dedicated scan page (`force` re-reads from disk).
  server.handle(RPC_CHANNELS.onboarding.DETECT_LOCAL_LOGINS, async (_ctx, options?: { force?: boolean }) => {
    return detectLocalLogins({ force: options?.force })
  })

  server.handle(RPC_CHANNELS.onboarding.IMPORT_CODEX_API_KEY, async (_ctx, configId: string) => {
    try {
      return await importCodexApiKeyAsConnection(configId)
    } catch {
      // Storage/parse exceptions may contain credential material. Return only a code.
      return { success: false, error: 'save-failed' }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.SCAN_LOCAL_CONFIGS, async (_ctx, options?: LocalConfigScanOptions) => {
    return scanLocalConfigs(options)
  })

  server.handle(RPC_CHANNELS.onboarding.IMPORT_LOCAL_API_KEY, async (_ctx, configId: string, options?: LocalApiKeyImportOptions) => {
    try {
      const result = await importScannedApiKeyAsConnection(configId, options)
      if (!result.success || !result.slug) return result
      // Credentials establish the connection; a source model is only its initial default.
      // Discovery can fail independently (some gateways do not expose /models).
      try { await getModelRefreshService().refreshNow(result.slug) } catch { /* keep cached/source models */ }
      return { ...result, modelRequired: !getLlmConnection(result.slug)?.defaultModel }
    } catch { return { success: false, error: 'save-failed' } }
  })

  // Validate MCP connection
  server.handle(RPC_CHANNELS.onboarding.VALIDATE_MCP, async (_ctx, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Prepare MCP server OAuth (server-side only — no browser open).
  // Returns authUrl for the client to open locally.
  // NOTE: Currently unused in renderer. If re-enabled, needs client-side
  // orchestration (callback server + browser open) like performOAuth().
  server.handle(RPC_CHANNELS.onboarding.START_MCP_OAUTH, async (_ctx, mcpUrl: string, callbackPort?: number) => {
    log.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received')
    try {
      if (!callbackPort) {
        throw new Error('callbackPort is required — client must run a local callback server')
      }
      const prepared = await prepareMcpOAuth(mcpUrl, { callbackPort })
      log.info('[Onboarding:Main] MCP OAuth prepared, returning authUrl to client')

      return {
        success: true,
        authUrl: prepared.authUrl,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        tokenEndpoint: prepared.tokenEndpoint,
        clientId: prepared.clientId,
        redirectUri: prepared.redirectUri,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding:Main] MCP OAuth prepare failed:', message)
      return { success: false, error: message }
    }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    setSetupDeferred(true)
    log?.info('[Onboarding] User deferred setup')
    return { success: true }
  })
}
