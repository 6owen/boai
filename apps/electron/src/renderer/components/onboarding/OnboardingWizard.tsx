import { cn } from "@/lib/utils"
import { WelcomeStep } from "./WelcomeStep"
import type { ApiSetupMethod } from "./APISetupStep"
import { ProviderSelectStep, type ProviderChoice } from "./ProviderSelectStep"
import { CredentialsStep, type CredentialStatus } from "./CredentialsStep"
import type { DetectedLogin } from '../../../shared/types'
import { LocalConfigScanStep, type LocalConfigScanStatus } from "./LocalConfigScanStep"
import { LocalModelStep, type LocalModelSubmitData } from "./LocalModelStep"
import { CompletionStep } from "./CompletionStep"
import { GitBashWarning, type GitBashStatus } from "./GitBashWarning"
import type { ApiKeySubmitData, ApiKeyInputProps } from "../apisetup"
import type { DetectedApiKeyConfig } from '@craft-agent/shared/auth'

export type OnboardingStep =
  | 'welcome'
  | 'git-bash'
  | 'provider-select'
  | 'local-model'
  | 'local-config-scan'
  | 'credentials'
  | 'complete'

export type LoginStatus = 'idle' | 'waiting' | 'success' | 'error'

export interface OnboardingState {
  step: OnboardingStep
  loginStatus: LoginStatus
  credentialStatus: CredentialStatus
  completionStatus: 'saving' | 'complete'
  apiSetupMethod: ApiSetupMethod | null
  isExistingUser: boolean
  errorMessage?: string
  credentialsOrigin?: 'local-config-scan'
  detectedApiKey?: DetectedApiKeyConfig
  importedConnectionSlug?: string
  gitBashStatus?: GitBashStatus
  isRecheckingGitBash?: boolean
  isCheckingGitBash?: boolean
}

interface OnboardingWizardProps {
  /** Current state of the wizard */
  state: OnboardingState

  // Event handlers
  onContinue: () => void
  onBack: () => void
  onSelectApiSetupMethod: (method: ApiSetupMethod) => void
  onSubmitCredential: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onFinish: () => void

  // Copilot device flow
  copilotDeviceCode?: { userCode: string; verificationUri: string }

  // Git Bash (Windows)
  onBrowseGitBash?: () => Promise<string | null>
  onUseGitBashPath?: (path: string) => void
  onRecheckGitBash?: () => void
  onClearError?: () => void

  // Provider select (new flow)
  onSelectProvider?: (choice: ProviderChoice) => void
  /** Called when user chooses "Setup later" on provider select */
  onSkipSetup?: () => void

  // Local configuration scan (secondary page only)
  detectedLogins?: DetectedLogin[]
  /** Scan only after entering the dedicated local configuration page. */
  onScanLocalLogins?: () => void
  localConfigScanStatus?: LocalConfigScanStatus
  localConfigDirectory?: string
  localConfigScanPartial?: boolean
  onChooseConfigDirectory?: () => void
  onScanDefaultConfigs?: () => void
  onImportLocalConfig?: (login: DetectedLogin) => void

  // Local model
  onSubmitLocalModel?: (data: LocalModelSubmitData) => void

  // Edit mode (pre-fill existing connection values)
  editInitialValues?: ApiKeyInputProps['initialValues']

  className?: string
}

/**
 * OnboardingWizard - Full-screen onboarding flow container
 *
 * Manages the step-by-step flow for setting up BoAI:
 * 1. Welcome
 * 2. Provider Select (ChatGPT / Copilot / API Key / Local)
 * 3. Credentials (API Key or OAuth) or Local Model
 * 4. Completion
 */
export function OnboardingWizard({
  state,
  onContinue,
  onBack,
  onSelectApiSetupMethod,
  onSubmitCredential,
  onStartOAuth,
  onFinish,
  // Copilot device flow
  copilotDeviceCode,
  // Git Bash (Windows)
  onBrowseGitBash,
  onUseGitBashPath,
  onRecheckGitBash,
  onClearError,
  // Provider select (new flow)
  onSelectProvider,
  onSkipSetup,
  // Local login detection
  detectedLogins,
  onScanLocalLogins,
  localConfigScanStatus,
  localConfigDirectory,
  localConfigScanPartial,
  onChooseConfigDirectory,
  onScanDefaultConfigs,
  onImportLocalConfig,
  // Local model
  onSubmitLocalModel,
  // Edit mode
  editInitialValues,
  className
}: OnboardingWizardProps) {
  const renderStep = () => {
    switch (state.step) {
      case 'welcome':
        return (
          <WelcomeStep
            isExistingUser={state.isExistingUser}
            onContinue={onContinue}
            isLoading={state.isCheckingGitBash}
          />
        )

      case 'git-bash':
        return (
          <GitBashWarning
            status={state.gitBashStatus!}
            onBrowse={onBrowseGitBash!}
            onUsePath={onUseGitBashPath!}
            onRecheck={onRecheckGitBash!}
            onBack={onBack}
            isRechecking={state.isRecheckingGitBash}
            errorMessage={state.errorMessage}
            onClearError={onClearError}
          />
        )

      case 'provider-select':
        return (
          <ProviderSelectStep
            onSelect={onSelectProvider!}
            onSkip={onSkipSetup}
          />
        )

      case 'local-config-scan':
        return (
          <LocalConfigScanStep
            detectedLogins={detectedLogins ?? []}
            directory={localConfigDirectory}
            partial={localConfigScanPartial}
            onChooseDirectory={onChooseConfigDirectory}
            onScanDefaults={onScanDefaultConfigs}
            status={localConfigScanStatus ?? 'idle'}
            onScan={onScanLocalLogins!}
            onImport={onImportLocalConfig!}
            onBack={onBack}
            isImporting={state.credentialStatus === 'validating'}
            errorMessage={state.errorMessage}
          />
        )

      case 'local-model':
        return (
          <LocalModelStep
            onSubmit={onSubmitLocalModel!}
            onBack={onBack}
            status={state.credentialStatus === 'validating' ? 'validating' : state.credentialStatus === 'error' ? 'error' : 'idle'}
            errorMessage={state.errorMessage}
          />
        )

      case 'credentials':
        return (
          <CredentialsStep
            apiSetupMethod={state.apiSetupMethod!}
            status={state.credentialStatus}
            errorMessage={state.errorMessage}
            onSubmit={onSubmitCredential}
            onStartOAuth={onStartOAuth}
            onBack={onBack}
            editInitialValues={editInitialValues ?? (state.detectedApiKey ? {
              connectionSlug: state.importedConnectionSlug,
              modelSelectionMode: 'automaticallySyncedFromProvider',
              baseUrl: state.detectedApiKey.baseUrl,
              connectionDefaultModel: state.detectedApiKey.model,
              models: state.detectedApiKey.model ? [state.detectedApiKey.model] : undefined,
              activePreset: 'custom',
              customApi: state.detectedApiKey.api,
            } : undefined)}
            copilotDeviceCode={copilotDeviceCode}
          />
        )

      case 'complete':
        return (
          <CompletionStep
            status={state.completionStatus}
            onFinish={onFinish}
          />
        )

      default:
        return null
    }
  }

  return (
    <div
      className={cn(
        "bg-foreground-2 overflow-y-auto",
        !className?.includes('h-full') && "h-dvh",
        className
      )}
    >
      {/* Draggable title bar region for transparent window (macOS) */}
      <div className="titlebar-drag-region fixed top-0 left-0 right-0 h-[50px] z-titlebar" />

      {/* Main content — min-h-full + flex center means: center when content fits,
          natural flow + scroll when content is taller than the viewport (mobile). */}
      <main className="flex min-h-full items-center justify-center p-4 sm:p-8">
        {renderStep()}
      </main>
    </div>
  )
}
