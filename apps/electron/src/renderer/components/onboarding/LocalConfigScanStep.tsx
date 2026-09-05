import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderSearch, Key, LoaderCircle, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { StepFormLayout, BackButton, ContinueButton } from './primitives'
import type { DetectedLogin } from '../../../shared/types'
import openaiIcon from '@/assets/provider-icons/openai.svg'

export type LocalConfigScanStatus = 'idle' | 'scanning' | 'complete' | 'error'

interface LocalConfigScanStepProps {
  detectedLogins: DetectedLogin[]
  status: LocalConfigScanStatus
  onScan: () => void
  onImport: (login: DetectedLogin) => void
  onBack: () => void
  isImporting?: boolean
  errorMessage?: string
  directory?: string
  partial?: boolean
  onChooseDirectory?: () => void
  onScanDefaults?: () => void
}

/** Scanning is read-only. Only clicking an individual result imports it. */
export function LocalConfigScanStep({
  detectedLogins, status, onScan, onImport, onBack, isImporting = false, errorMessage,
  directory, partial, onChooseDirectory, onScanDefaults,
}: LocalConfigScanStepProps) {
  const { t } = useTranslation()
  useEffect(() => { onScan() }, [onScan])
  const scanning = status === 'idle' || status === 'scanning'

  return (
    <StepFormLayout
      title={t('onboarding.providerSelect.scanLocalConfig')}
      description={t('onboarding.localConfig.description')}
      actions={
        <>
          <BackButton onClick={onBack} disabled={isImporting}>{t('common.back')}</BackButton>
          <ContinueButton onClick={onScan} disabled={scanning || isImporting}>
            {t('onboarding.localConfig.rescan')}
          </ContinueButton>
        </>
      }
    >
      <div className="space-y-3" aria-busy={scanning || isImporting}>
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <button onClick={onChooseDirectory} disabled={isImporting} className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs shadow-minimal hover:bg-foreground/5 disabled:opacity-50">
              <FolderSearch className="size-4" />{t('onboarding.localConfig.chooseDirectory')}
            </button>
            {directory && <button onClick={onScanDefaults} disabled={isImporting} className="px-2 py-2 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50">{t('onboarding.localConfig.defaultDirectories')}</button>}
          </div>
          <p className="break-all text-xs text-muted-foreground">{directory ?? t('onboarding.localConfig.defaultScope')}</p>
          <p className="text-xs text-muted-foreground">{t('onboarding.localConfig.supportedFiles')}</p>
        </div>
        {scanning ? (
          <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            {t('onboarding.localConfig.scanning')}
          </div>
        ) : status === 'error' ? (
          <p role="alert" className="py-8 text-center text-sm text-destructive">{t('onboarding.localConfig.scanFailed')}</p>
        ) : detectedLogins.length === 0 ? (
          <div role="status" className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <Search className="size-6" />
            <p>{t('onboarding.localConfig.empty')}</p>
          </div>
        ) : detectedLogins.map(login => {
          const isOAuth = login.authType === 'oauth'
          return (
            <button
              key={`${login.sourceId}:${login.configId}:${login.sourcePath ?? ''}`}
              onClick={() => onImport(login)}
              disabled={isImporting || (isOAuth && !login.usable)}
              className={cn(
                'flex w-full items-start gap-4 rounded-xl bg-foreground-2 p-4 text-left shadow-minimal transition-colors',
                'hover:bg-foreground/[0.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                'disabled:opacity-50 disabled:cursor-default',
              )}
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                {isOAuth ? <img src={openaiIcon} alt="" className="size-5" /> : <Key className="size-5" />}
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-sm font-medium">{t(isOAuth ? 'onboarding.providerSelect.codexChatGPT'
                  : login.sourceId === 'codex-api-key' ? 'onboarding.providerSelect.codexApiKey'
                  : login.sourceId === 'claude-code-api-key' ? 'onboarding.localConfig.claudeApiKey' : 'onboarding.localConfig.openaiApiKey')}</p>
                <p className="break-all text-xs text-muted-foreground">
                  {isOAuth ? login.accountEmail ?? t('onboarding.localConfig.unknownAccount') : login.providerName}
                </p>
                {!isOAuth && <p className="break-all text-xs text-muted-foreground">{[login.baseUrl, login.model].filter(Boolean).join(' · ')}</p>}
                <p className="break-all text-xs text-muted-foreground">{login.sourcePath ?? t('onboarding.localConfig.source')}</p>
                {!login.usable && <p className="pt-1 text-xs font-medium">
                  {t(isOAuth ? 'onboarding.localConfig.expired' : 'onboarding.providerSelect.completeConfig')}
                </p>}
              </div>
            </button>
          )
        })}
        {partial && <p role="status" className="text-xs text-muted-foreground">{t('onboarding.localConfig.partial')}</p>}
        {isImporting && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin" />{t('onboarding.localConfig.importing')}</p>}
        {errorMessage && <p role="alert" className="text-sm text-destructive">{errorMessage}</p>}
      </div>
    </StepFormLayout>
  )
}
