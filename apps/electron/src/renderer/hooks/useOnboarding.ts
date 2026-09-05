/**
 * useOnboarding Hook
 *
 * Manages the state machine for the onboarding wizard.
 * Flow:
 * 1. Welcome
 * 2. Git Bash (Windows only, if not found)
 * 3. API setup
 * 4. Credentials
 * 5. Complete
 */
import { useState, useCallback, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type {
  OnboardingState,
  OnboardingStep,
  ApiSetupMethod,
} from '@/components/onboarding'
import type { LocalConfigScanStatus } from '@/components/onboarding/LocalConfigScanStep'
import type { ProviderChoice } from '@/components/onboarding/ProviderSelectStep'
import type { LocalModelSubmitData } from '@/components/onboarding/LocalModelStep'
import type { ApiKeySubmitData } from '@/components/apisetup'
import type { CustomEndpointConfig } from '@config/llm-connections'
import type { SetupNeeds, LlmConnectionSetup, DetectedLogin } from '../../shared/types'
import type { DetectedApiKeyConfig } from '@craft-agent/shared/auth'

interface UseOnboardingOptions {
  /** Called when onboarding is complete */
  onComplete: () => void
  /** Initial setup needs from auth state check */
  initialSetupNeeds?: SetupNeeds
  /** Start the wizard at a specific step (default: 'welcome') */
  initialStep?: OnboardingStep
  /** Pre-select an API setup method (useful when editing an existing connection) */
  initialApiSetupMethod?: ApiSetupMethod
  /** Called when user goes back from the initial step (dismisses the wizard) */
  onDismiss?: () => void
  /** Called immediately after config is saved to disk (before wizard closes).
   *  Use this to propagate billing/model changes to the UI without waiting for onComplete. */
  onConfigSaved?: () => void
  /** Slug of existing connection being edited (null = creating new) */
  editingSlug?: string | null
  /** Set of slugs already in use (for generating unique slugs when creating new) */
  existingSlugs?: Set<string>
}

interface UseOnboardingReturn {
  // State
  state: OnboardingState

  // Wizard actions
  handleContinue: () => void
  handleBack: () => void

  // Provider select (new flow)
  handleSelectProvider: (choice: ProviderChoice) => void

  // API Setup (legacy — kept for direct edit)
  handleSelectApiSetupMethod: (method: ApiSetupMethod) => void

  // Credentials
  handleSubmitCredential: (data: ApiKeySubmitData) => void

  // Local model
  handleSubmitLocalModel: (data: LocalModelSubmitData) => void
  handleStartOAuth: (methodOverride?: ApiSetupMethod, connectionSlugOverride?: string) => void

  // Explicit local configuration scan and import
  detectedLogins: DetectedLogin[]
  /** Read local configuration only from the dedicated secondary page. */
  scanLocalLogins: () => Promise<void>
  localConfigScanStatus: LocalConfigScanStatus
  localConfigDirectory?: string
  localConfigScanPartial: boolean
  handleChooseConfigDirectory: () => Promise<void>
  handleScanDefaultConfigs: () => void
  handleImportLocalConfig: (login: DetectedLogin) => void

  // Copilot device code (displayed during device flow)
  copilotDeviceCode?: { userCode: string; verificationUri: string }

  // Git Bash (Windows)
  handleBrowseGitBash: () => Promise<string | null>
  handleUseGitBashPath: (path: string) => void
  handleRecheckGitBash: () => void
  handleClearError: () => void

  // Skip setup ("Setup later")
  handleSkipSetup: () => void

  // Completion
  handleFinish: () => void
  handleCancel: () => void

  // Direct edit (skip method selection, jump to credentials)
  jumpToCredentials: (method: ApiSetupMethod) => void

  // Reset
  reset: () => void
}

// Base slug for each setup method (used as template key in ipc.ts)
export const BASE_SLUG_FOR_METHOD: Record<ApiSetupMethod, string> = {
  anthropic_api_key: 'anthropic-api',
  pi_chatgpt_oauth: 'chatgpt-plus',
  pi_copilot_oauth: 'github-copilot',
  pi_api_key: 'pi-api-key',
}

/**
 * Generate a unique slug for a new connection.
 * If the base slug is taken, appends -2, -3, etc.
 * When editingSlug is provided, reuses that slug (editing existing connection).
 */
export function resolveSlugForMethod(
  method: ApiSetupMethod,
  editingSlug: string | null,
  existingSlugs: Set<string>,
): string {
  // Editing an existing connection — reuse its slug
  if (editingSlug) return editingSlug

  const base = BASE_SLUG_FOR_METHOD[method]
  if (!existingSlugs.has(base)) return base

  let i = 2
  while (existingSlugs.has(`${base}-${i}`)) i++
  return `${base}-${i}`
}

// Map ApiSetupMethod to LlmConnectionSetup for the new unified connection system
function isLoopbackEndpoint(baseUrl?: string): boolean {
  if (!baseUrl?.trim()) return false
  try {
    const hostname = new URL(baseUrl.trim()).hostname
    const normalizedHostname = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname
    return normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname === '::1'
  } catch {
    return false
  }
}

export function apiSetupMethodToConnectionSetup(
  method: ApiSetupMethod,
  options: {
    credential?: string
    baseUrl?: string
    connectionDefaultModel?: string
    models?: string[]
    piAuthProvider?: string
    modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
    customEndpoint?: CustomEndpointConfig
    iamCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
    awsRegion?: string
    bedrockAuthMethod?: 'iam_credentials' | 'environment'
  },
  editingSlug: string | null,
  existingSlugs: Set<string>,
): LlmConnectionSetup {
  const slug = resolveSlugForMethod(method, editingSlug, existingSlugs)

  switch (method) {
    case 'anthropic_api_key':
      return {
        slug,
        credential: options.credential,
        baseUrl: options.baseUrl,
        defaultModel: options.connectionDefaultModel,
        models: options.models,
        piAuthProvider: 'anthropic',
        customEndpoint: options.customEndpoint,
      }
    case 'pi_chatgpt_oauth':
    case 'pi_copilot_oauth':
      return {
        slug,
        credential: options.credential,
      }
    case 'pi_api_key':
      return {
        slug,
        credential: options.credential,
        baseUrl: options.baseUrl,
        defaultModel: options.connectionDefaultModel,
        models: options.models,
        piAuthProvider: options.piAuthProvider,
        modelSelectionMode: options.modelSelectionMode,
        customEndpoint: options.customEndpoint,
        iamCredentials: options.iamCredentials,
        awsRegion: options.awsRegion,
        bedrockAuthMethod: options.bedrockAuthMethod,
      }
  }
}

export function useOnboarding({
  onComplete,
  initialSetupNeeds,
  initialStep = 'provider-select',
  initialApiSetupMethod,
  onDismiss,
  onConfigSaved,
  editingSlug = null,
  existingSlugs = new Set(),
}: UseOnboardingOptions): UseOnboardingReturn {
  // Main wizard state
  const { t } = useTranslation()

  const [state, setState] = useState<OnboardingState>({
    step: initialStep,
    loginStatus: 'idle',
    credentialStatus: 'idle',
    completionStatus: 'saving',
    apiSetupMethod: initialApiSetupMethod ?? null,
    isExistingUser: initialSetupNeeds?.needsBillingConfig ?? false,
    gitBashStatus: undefined,
    isRecheckingGitBash: false,
    isCheckingGitBash: true, // Start as true until check completes
  })

  // Check Git Bash on Windows at mount. If missing, redirect to git-bash step
  // regardless of the initial step (provider-select skips the welcome gate).
  useEffect(() => {
    const checkGitBash = async () => {
      try {
        const status = await window.electronAPI.checkGitBash()
        setState(s => ({
          ...s,
          gitBashStatus: status,
          isCheckingGitBash: false,
          // Redirect to git-bash step when missing on Windows
          ...(status.platform === 'win32' && !status.found ? { step: 'git-bash' as const } : {}),
        }))
      } catch (error) {
        console.error('[Onboarding] Failed to check Git Bash:', error)
        // Even on error, allow continuing (will skip git-bash step)
        setState(s => ({ ...s, isCheckingGitBash: false }))
      }
    }
    checkGitBash()
  }, [])

  // Save configuration using the new unified LLM connection API
  // Returns true on success, false on failure (sets errorMessage on failure)
  // `methodOverride` lets callers pass the method explicitly to avoid stale-closure issues
  // (e.g. when called from an async OAuth flow whose closure predates the state update).
  const handleSaveConfig = useCallback(async (
    credential?: string,
    options?: {
      baseUrl?: string
      connectionDefaultModel?: string
      models?: string[]
      piAuthProvider?: string
      modelSelectionMode?: 'automaticallySyncedFromProvider' | 'userDefined3Tier'
      customEndpoint?: CustomEndpointConfig
      iamCredentials?: { accessKeyId: string; secretAccessKey: string; sessionToken?: string }
      awsRegion?: string
      bedrockAuthMethod?: 'iam_credentials' | 'environment'
    },
    methodOverride?: ApiSetupMethod,
    connectionSlugOverride?: string,
    updateOnly?: boolean,
  ): Promise<boolean> => {
    const method = methodOverride ?? state.apiSetupMethod
    if (!method) {
      return false
    }

    setState(s => ({ ...s, completionStatus: 'saving' }))

    try {
      // Build connection setup from UI state
      const setup = apiSetupMethodToConnectionSetup(method, {
        credential,
        baseUrl: options?.baseUrl,
        connectionDefaultModel: options?.connectionDefaultModel,
        models: options?.models,
        piAuthProvider: options?.piAuthProvider,
        modelSelectionMode: options?.modelSelectionMode,
        customEndpoint: options?.customEndpoint,
        iamCredentials: options?.iamCredentials,
        awsRegion: options?.awsRegion,
        bedrockAuthMethod: options?.bedrockAuthMethod,
      }, connectionSlugOverride ?? editingSlug ?? state.importedConnectionSlug ?? null, existingSlugs)
      // Use new unified API
      const result = await window.electronAPI.setupLlmConnection(
        updateOnly ? { ...setup, updateOnly: true } : setup
      )

      if (result.success) {
        setState(s => ({ ...s, completionStatus: 'complete' }))
        // Notify caller immediately so UI can reflect billing/model changes
        onConfigSaved?.()
        return true
      } else {
        console.error('[Onboarding] Save failed:', result.error)
        setState(s => ({
          ...s,
          completionStatus: 'saving',
          errorMessage: result.error || 'Failed to save configuration',
        }))
        return false
      }
    } catch (error) {
      console.error('[Onboarding] handleSaveConfig error:', error)
      setState(s => ({
        ...s,
        errorMessage: error instanceof Error ? error.message : 'Failed to save configuration',
      }))
      return false
    }
  }, [state.apiSetupMethod, state.importedConnectionSlug, onConfigSaved, editingSlug, existingSlugs])

  // Continue to next step
  const handleContinue = useCallback(async () => {
    switch (state.step) {
      case 'local-config-scan':
      case 'provider-select':
        // Handled by handleSelectProvider (card click navigates directly)
        break

      case 'welcome':
        // On Windows, check if Git Bash is needed
        if (state.gitBashStatus?.platform === 'win32' && !state.gitBashStatus?.found) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else {
          setState(s => ({ ...s, step: 'provider-select' }))
        }
        break

      case 'git-bash':
        setState(s => ({ ...s, step: 'provider-select' }))
        break

      case 'local-model':
        // Handled by handleSubmitLocalModel
        break

      case 'credentials':
        // Handled by handleSubmitCredential
        break

      case 'complete':
        onComplete()
        break
    }
  }, [state.step, state.gitBashStatus, state.apiSetupMethod, onComplete])

  // Go back to previous step. If at the initial step, call onDismiss instead.
  const handleBack = useCallback(() => {
    if (state.step === initialStep && onDismiss) {
      onDismiss()
      return
    }
    switch (state.step) {
      case 'git-bash':
        if (onDismiss) {
          onDismiss()
        }
        break
      case 'provider-select':
        // If on Windows and Git Bash was needed, go back to git-bash step
        if (state.gitBashStatus?.platform === 'win32' && state.gitBashStatus?.found === false) {
          setState(s => ({ ...s, step: 'git-bash' }))
        } else if (onDismiss) {
          onDismiss()
        }
        break
      case 'credentials':
        setState(s => ({ ...s, step: s.credentialsOrigin ?? 'provider-select', credentialStatus: 'idle', errorMessage: undefined }))
        break
      case 'local-config-scan':
      case 'local-model':
        setState(s => ({ ...s, step: 'provider-select', credentialStatus: 'idle', errorMessage: undefined }))
        break
    }
  }, [state.step, state.gitBashStatus, initialStep, onDismiss])

  // Select API setup method (legacy — kept for direct edit flows)
  const handleSelectApiSetupMethod = useCallback((method: ApiSetupMethod) => {
    setState(s => ({ ...s, apiSetupMethod: method }))
  }, [])

  // Submit credential (API key + optional endpoint config)
  // Tests the connection first before saving to catch issues early
  const handleSubmitCredential = useCallback(async (data: ApiKeySubmitData) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // Bedrock (Pi+amazon-bedrock) — skip API key validation and connection test
      if (data.bedrockAuthMethod) {
        const saved = await handleSaveConfig(undefined, {
          baseUrl: data.baseUrl,
          connectionDefaultModel: data.connectionDefaultModel,
          models: data.models,
          piAuthProvider: data.piAuthProvider,
          modelSelectionMode: data.modelSelectionMode,
          iamCredentials: data.iamCredentials,
          awsRegion: data.awsRegion,
          bedrockAuthMethod: data.bedrockAuthMethod,
        })
        if (saved) {
          setState(s => ({ ...s, credentialStatus: 'success', step: 'complete' }))
        } else {
          setState(s => ({ ...s, credentialStatus: 'error' }))
        }
        return
      }

      // A configuration with only URL + key can be completed without exposing or retyping its key.
      const scanned = state.detectedApiKey
      if (!data.apiKey.trim() && scanned?.hasApiKey && scanned.issue === 'missing-model'
        && data.baseUrl?.replace(/\/+$/, '') === scanned.baseUrl
        && data.customEndpoint?.api === scanned.api && data.connectionDefaultModel?.trim()) {
        const imported = await window.electronAPI.importLocalApiKey(scanned.configId, {
          directory: scanDirectoryRef.current, model: data.connectionDefaultModel.trim(),
        })
        if (!imported.success || !imported.slug) {
          setState(s => ({ ...s, credentialStatus: 'error', errorMessage: t('onboarding.credentials.codexApiImportFailed') }))
          return
        }
        setState(s => ({ ...s, importedConnectionSlug: imported.slug }))
        onConfigSaved?.()
        const tested = await window.electronAPI.testLlmConnection(imported.slug)
        setState(s => tested.success
          ? { ...s, step: 'complete', credentialStatus: 'success', completionStatus: 'complete' }
          : { ...s, credentialStatus: 'error', errorMessage: t('onboarding.credentials.codexApiTestFailed') })
        return
      }

      // Empty on edit means reuse the server-stored key. Test the proposed settings
      // before persisting any changes, just as we do for a newly entered key.
      const connectionSlug = editingSlug || state.importedConnectionSlug
      if (!data.apiKey.trim() && !connectionSlug && !isLoopbackEndpoint(data.baseUrl)) {
        setState(s => ({ ...s, credentialStatus: 'error', errorMessage: 'Please enter a valid API key' }))
        return
      }

      // Validate connection by spawning a lightweight subprocess test.
      // Custom endpoint protocol routes through PiAgent at runtime, so test with Pi too.
      const testResult = await window.electronAPI.testLlmConnectionSetup({
        provider: 'pi',
        apiKey: data.apiKey,
        connectionSlug: connectionSlug || undefined,
        baseUrl: data.baseUrl,
        model: data.connectionDefaultModel || data.models?.[0],
        piAuthProvider: data.piAuthProvider,
        customEndpoint: data.customEndpoint,
      })

      if (!testResult.success) {
        setState(s => ({
          ...s,
          credentialStatus: 'error',
          errorMessage: testResult.error || 'Connection test failed',
        }))
        return
      }

      const saved = await handleSaveConfig(data.apiKey.trim() || undefined, {
        baseUrl: data.baseUrl ?? (connectionSlug ? '' : undefined),
        connectionDefaultModel: data.connectionDefaultModel,
        models: data.models,
        piAuthProvider: data.piAuthProvider,
        modelSelectionMode: data.modelSelectionMode,
        customEndpoint: data.customEndpoint,
      })

      if (saved) {
        setState(s => ({
          ...s,
          credentialStatus: 'success',
          step: 'complete',
        }))
      } else {
        // Save failed — error is already set by handleSaveConfig, stay on credentials step
        setState(s => ({ ...s, credentialStatus: 'error' }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Validation failed',
      }))
    }
  }, [handleSaveConfig, state.apiSetupMethod, state.detectedApiKey, onConfigSaved, state.importedConnectionSlug, editingSlug, t])

  // Save config, validate the connection, and update state accordingly.
  // Shared by all OAuth flows after tokens are captured.
  // `method` is passed explicitly to break the stale-closure chain — the OAuth
  // await crosses renders, so handleSaveConfig's closure may have an outdated
  // state.apiSetupMethod.
  const saveAndValidateConnection = useCallback(async (connectionSlug: string, method: ApiSetupMethod, credential?: string, updateOnly?: boolean): Promise<boolean> => {
    const saved = await handleSaveConfig(credential, undefined, method, connectionSlug, updateOnly)
    if (!saved) {
      setState(s => ({ ...s, credentialStatus: 'error' }))
      return false
    }
    const testResult = await window.electronAPI.testLlmConnection(connectionSlug)
    if (testResult.success) {
      setState(s => ({ ...s, credentialStatus: 'success', step: 'complete' }))
      return true
    } else {
      setState(s => ({ ...s, credentialStatus: 'error', errorMessage: testResult.error || 'Connection test failed' }))
      return false
    }
  }, [handleSaveConfig])

  // Copilot device code (displayed during device flow)
  const [copilotDeviceCode, setCopilotDeviceCode] = useState<{ userCode: string; verificationUri: string } | undefined>()

  // Start a PI OAuth flow (ChatGPT or Copilot).
  const handleStartOAuth = useCallback(async (methodOverride?: ApiSetupMethod, connectionSlugOverride?: string) => {
    const effectiveMethod = methodOverride ?? state.apiSetupMethod

    if (methodOverride && methodOverride !== state.apiSetupMethod) {
      setState(s => ({
        ...s,
        apiSetupMethod: methodOverride,
        step: 'credentials',
        credentialStatus: 'validating',
        errorMessage: undefined,
      }))
    } else {
      setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))
    }

    if (!effectiveMethod) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: 'Select an authentication method first.',
      }))
      return
    }

    try {
      // ChatGPT OAuth (single-step flow - opens browser, captures tokens automatically)
      if (effectiveMethod === 'pi_chatgpt_oauth') {
        const effectiveEditingSlug = connectionSlugOverride ?? editingSlug
        const isReauth = !!effectiveEditingSlug
        const connectionSlug = apiSetupMethodToConnectionSetup(effectiveMethod, {}, effectiveEditingSlug, existingSlugs).slug
        const result = await window.electronAPI.startChatGptOAuth(connectionSlug)

        if (result.success) {
          await saveAndValidateConnection(connectionSlug, effectiveMethod, undefined, isReauth)
        } else {
          setState(s => ({
            ...s,
            credentialStatus: 'error',
            errorMessage: result.error || 'ChatGPT authentication failed',
          }))
        }
        return
      }

      // Copilot OAuth (device flow — polls for token after user enters code on GitHub)
      if (effectiveMethod === 'pi_copilot_oauth') {
        const effectiveEditingSlug = connectionSlugOverride ?? editingSlug
        const isReauth = !!effectiveEditingSlug
        const connectionSlug = apiSetupMethodToConnectionSetup(effectiveMethod, {}, effectiveEditingSlug, existingSlugs).slug

        // Subscribe to device code event before starting the flow
        const cleanup = window.electronAPI.onCopilotDeviceCode((data) => {
          setCopilotDeviceCode(data)
        })

        try {
          const result = await window.electronAPI.startCopilotOAuth(connectionSlug)

          if (result.success) {
            await saveAndValidateConnection(connectionSlug, effectiveMethod, undefined, isReauth)
          } else {
            setState(s => ({
              ...s,
              credentialStatus: 'error',
              errorMessage: result.error || 'GitHub authentication failed',
            }))
          }
        } finally {
          cleanup()
          setCopilotDeviceCode(undefined)
        }
        return
      }

      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: 'This connection uses API keys, not OAuth.',
      }))
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'OAuth failed',
      }))
    }
  }, [state.apiSetupMethod, saveAndValidateConnection, editingSlug, existingSlugs])

  // Local files are read only after opening the scan page.
  const [detectedLogins, setDetectedLogins] = useState<DetectedLogin[]>([])
  const [localConfigScanStatus, setLocalConfigScanStatus] = useState<LocalConfigScanStatus>('idle')
  const [localConfigDirectory, setLocalConfigDirectory] = useState<string>()
  const [localConfigScanPartial, setLocalConfigScanPartial] = useState(false)
  const scanDirectoryRef = useRef<string>()
  const scanRequest = useRef(0)
  const runLocalConfigScan = useCallback(async (directory?: string) => {
    const request = ++scanRequest.current
    scanDirectoryRef.current = directory
    setLocalConfigDirectory(directory)
    setLocalConfigScanStatus('scanning')
    setLocalConfigScanPartial(false)
    setDetectedLogins([])
    setState(s => ({ ...s, errorMessage: undefined, credentialStatus: 'idle' }))
    try {
      const result = await window.electronAPI.scanLocalConfigs({ directory })
      if (request !== scanRequest.current) return
      setDetectedLogins(result.logins)
      setLocalConfigScanPartial(result.truncated || result.skippedFiles > 0)
      setLocalConfigScanStatus('complete')
    } catch {
      if (request === scanRequest.current) setLocalConfigScanStatus('error')
    }
  }, [])
  // Stable identity prevents the scan page's mount effect from rescanning on each directory change.
  const scanLocalLogins = useCallback(() => runLocalConfigScan(scanDirectoryRef.current), [runLocalConfigScan])
  const handleScanDefaultConfigs = useCallback(() => { void runLocalConfigScan() }, [runLocalConfigScan])
  const handleChooseConfigDirectory = useCallback(async () => {
    try {
      const directory = await window.electronAPI.openFolderDialog({ title: t('onboarding.localConfig.chooseDirectory') })
      if (directory) await runLocalConfigScan(directory)
    } catch {
      setState(s => ({ ...s, errorMessage: t('onboarding.localConfig.directoryFailed') }))
    }
  }, [runLocalConfigScan, t])

  // Imports never run from a normal provider login card.
  const importInFlight = useRef(false)
  const handleImportDetected = useCallback(async (detected: Extract<DetectedLogin, { authType: 'oauth' }>) => {
    if (importInFlight.current) return
    importInFlight.current = true
    const method: ApiSetupMethod = 'pi_chatgpt_oauth'
    setState(s => ({
      ...s,
      apiSetupMethod: method,
      step: 'local-config-scan',
      credentialStatus: 'validating',
      errorMessage: undefined,
    }))
    const importFailed = (detail?: string) => setState(s => ({
      ...s,
      credentialStatus: 'error',
      errorMessage: detail || t('onboarding.credentials.codexImportFailed'),
    }))
    try {
      const connectionSlug = BASE_SLUG_FOR_METHOD[method]
      const result = await window.electronAPI.importChatGptFromCli(connectionSlug, detected.configId, detected.sourcePath?.replace(/[\\/][^\\/]+$/, ''))
      if (result.success) {
        onConfigSaved?.()
        const tested = await window.electronAPI.testLlmConnection(result.slug ?? connectionSlug)
        if (tested.success) {
          setState(s => ({ ...s, step: 'complete', credentialStatus: 'success', completionStatus: 'complete' }))
        } else {
          importFailed()
        }
      } else {
        // Server-side failures carry actionable detail (e.g. "run codex login");
        // only log it and show the localized message in the UI.
        console.warn('[useOnboarding] Codex CLI import failed:', result.error)
        importFailed()
      }
    } catch (error) {
      console.warn('[useOnboarding] Codex CLI import failed:', error)
      importFailed()
    } finally {
      importInFlight.current = false
    }
  }, [onConfigSaved, t])

  const handleImportCodexApiKey = useCallback(async (detected: DetectedApiKeyConfig) => {
    if (importInFlight.current) return
    const issueMessage = detected.envKey && detected.issue === 'missing-api-key'
      ? t('onboarding.credentials.codexMissingEnvKey', { name: detected.envKey })
      : detected.issue === 'missing-model' && detected.hasApiKey ? t('onboarding.localConfig.completeModel')
      : detected.issue ? t(`onboarding.codexConfig.issue.${detected.issue}`) : undefined
    setState(s => ({
      ...s, apiSetupMethod: 'pi_api_key', step: detected.usable ? 'local-config-scan' : 'credentials', detectedApiKey: detected,
      credentialsOrigin: 'local-config-scan',
      importedConnectionSlug: undefined,
      credentialStatus: detected.usable ? 'validating' : 'error', errorMessage: issueMessage,
    }))
    if (!detected.usable) return
    importInFlight.current = true
    try {
      const result = await window.electronAPI.importLocalApiKey(detected.configId, { directory: scanDirectoryRef.current })
      if (!result.success || !result.slug) {
        setState(s => ({ ...s, credentialStatus: 'error', errorMessage: t('onboarding.credentials.codexApiImportFailed') }))
        return
      }
      setState(s => ({ ...s, importedConnectionSlug: result.slug }))
      onConfigSaved?.()
      if (result.modelRequired) {
        setState(s => ({ ...s, step: 'credentials', credentialStatus: 'error', errorMessage: t('onboarding.localConfig.modelDiscoveryUnavailable') }))
        return
      }
      const tested = await window.electronAPI.testLlmConnection(result.slug)
      setState(s => tested.success
        ? { ...s, credentialStatus: 'success', completionStatus: 'complete', step: 'complete' }
        : { ...s, step: 'credentials', credentialStatus: 'error', errorMessage: t('onboarding.credentials.codexApiTestFailed') })
    } catch {
      setState(s => ({ ...s, credentialStatus: 'error', errorMessage: t('onboarding.credentials.codexApiImportFailed') }))
    } finally {
      importInFlight.current = false
    }
  }, [onConfigSaved, t])

  const handleImportLocalConfig = useCallback((login: DetectedLogin) => {
    if (login.authType === 'api_key') void handleImportCodexApiKey(login)
    else if (login.usable) void handleImportDetected(login)
  }, [handleImportCodexApiKey, handleImportDetected])

  // Provider cards always retain their normal login/configuration behavior.
  const handleSelectProvider = useCallback((choice: ProviderChoice) => {
    setState(s => ({
      ...s, detectedApiKey: undefined, importedConnectionSlug: undefined,
      credentialsOrigin: undefined, credentialStatus: 'idle', errorMessage: undefined,
    }))
    if (choice === 'local-config') {
      setState(s => ({ ...s, step: 'local-config-scan', apiSetupMethod: null }))
      return
    }
    if (choice === 'local') {
      setState(s => ({ ...s, step: 'local-model', apiSetupMethod: 'anthropic_api_key' }))
      return
    }
    const methods: Record<Exclude<ProviderChoice, 'local' | 'local-config'>, ApiSetupMethod> = {
      chatgpt: 'pi_chatgpt_oauth', copilot: 'pi_copilot_oauth', api_key: 'pi_api_key',
    }
    const method = methods[choice]
    setState(s => ({ ...s, apiSetupMethod: method, step: 'credentials' }))
    if (choice === 'chatgpt' || choice === 'copilot') {
      setTimeout(() => handleStartOAuth(method), 0)
    }
  }, [handleStartOAuth])

  // Submit local model configuration (Ollama or any OpenAI-compatible local server)
  const handleSubmitLocalModel = useCallback(async (data: LocalModelSubmitData) => {
    setState(s => ({ ...s, credentialStatus: 'validating', errorMessage: undefined }))

    try {
      // apiSetupMethod was set to 'anthropic_api_key' when entering local-model step
      const saved = await handleSaveConfig(undefined, {
        baseUrl: data.baseUrl,
        connectionDefaultModel: data.model,
        models: data.models,
        customEndpoint: { api: 'openai-completions' },
      })

      if (saved) {
        setState(s => ({ ...s, credentialStatus: 'success', step: 'complete' }))
      } else {
        setState(s => ({ ...s, credentialStatus: 'error' }))
      }
    } catch (error) {
      setState(s => ({
        ...s,
        credentialStatus: 'error',
        errorMessage: error instanceof Error ? error.message : 'Failed to save configuration',
      }))
    }
  }, [handleSaveConfig])

  // Git Bash handlers (Windows only)
  const handleBrowseGitBash = useCallback(async () => {
    return window.electronAPI.browseForGitBash()
  }, [])

  const handleUseGitBashPath = useCallback(async (path: string) => {
    const result = await window.electronAPI.setGitBashPath(path)
    if (result.success) {
      // Update state to mark Git Bash as found and continue
      setState(s => ({
        ...s,
        gitBashStatus: { ...s.gitBashStatus!, found: true, path },
        step: 'provider-select',
      }))
    } else {
      setState(s => ({
        ...s,
        errorMessage: result.error || 'Invalid path',
      }))
    }
  }, [])

  const handleRecheckGitBash = useCallback(async () => {
    setState(s => ({ ...s, isRecheckingGitBash: true }))
    try {
      const status = await window.electronAPI.checkGitBash()
      setState(s => ({
        ...s,
        gitBashStatus: status,
        isRecheckingGitBash: false,
        // If found, automatically continue to next step
        step: status.found ? 'provider-select' : s.step,
      }))
    } catch (error) {
      console.error('[Onboarding] Failed to recheck Git Bash:', error)
      setState(s => ({ ...s, isRecheckingGitBash: false }))
    }
  }, [])

  const handleClearError = useCallback(() => {
    setState(s => ({ ...s, errorMessage: undefined }))
  }, [])

  // Skip setup — user chose "Setup later"
  const handleSkipSetup = useCallback(async () => {
    try {
      await window.electronAPI.deferSetup()
    } catch (error) {
      console.error('[Onboarding] Failed to defer setup:', error)
    }
    onComplete()
  }, [onComplete])

  // Finish onboarding
  const handleFinish = useCallback(() => {
    onComplete()
  }, [onComplete])

  // Cancel onboarding
  const handleCancel = useCallback(() => {
    setState(s => ({ ...s, step: 'welcome' }))
  }, [])

  // Jump directly to credentials step with a pre-set method (for editing existing connections)
  const jumpToCredentials = useCallback((method: ApiSetupMethod) => {
    setState(s => ({
      ...s,
      step: 'credentials' as const,
      detectedApiKey: undefined, importedConnectionSlug: undefined, credentialsOrigin: undefined,
      apiSetupMethod: method,
      credentialStatus: 'idle' as const,
      errorMessage: undefined,
    }))
  }, [])

  // Reset onboarding to initial state (used after logout or modal close)
  const reset = useCallback(() => {
    scanRequest.current++
    setDetectedLogins([])
    setLocalConfigScanStatus('idle')
    scanDirectoryRef.current = undefined
    setLocalConfigDirectory(undefined)
    setLocalConfigScanPartial(false)
    setState({
      step: initialStep,
      loginStatus: 'idle',
      credentialStatus: 'idle',
      completionStatus: 'saving',
      apiSetupMethod: initialApiSetupMethod ?? null,
      isExistingUser: false,
      errorMessage: undefined,
    })
  }, [initialStep, initialApiSetupMethod])

  return {
    state,
    handleContinue,
    handleBack,
    handleSelectProvider,
    handleSelectApiSetupMethod,
    handleSubmitCredential,
    handleSubmitLocalModel,
    handleStartOAuth,
    detectedLogins,
    scanLocalLogins,
    localConfigScanStatus,
    localConfigDirectory,
    localConfigScanPartial,
    handleChooseConfigDirectory,
    handleScanDefaultConfigs,
    handleImportLocalConfig,
    // Copilot device code
    copilotDeviceCode,
    // Git Bash (Windows)
    handleBrowseGitBash,
    handleUseGitBashPath,
    handleRecheckGitBash,
    handleClearError,
    handleSkipSetup,
    handleFinish,
    handleCancel,
    jumpToCredentials,
    reset,
  }
}
