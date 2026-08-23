import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  CircleAlert,
  CircleArrowUp,
  CircleCheck,
  LoaderCircle,
  RefreshCw,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { LoadedSkill, SkillUpdateCheckResult } from '../../../shared/types'

interface UpdateSkillPopoverProps {
  workspaceId: string
  workingDirectory?: string
  skill?: LoadedSkill
  align?: 'start' | 'center' | 'end'
  onComplete?: () => void
}

type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'ready'; result: SkillUpdateCheckResult }
  | { status: 'updating'; result: SkillUpdateCheckResult }
  | { status: 'complete'; result: SkillUpdateCheckResult }
  | { status: 'error'; message: string; phase: 'checking' }
  | { status: 'error'; message: string; phase: 'updating'; result: SkillUpdateCheckResult }

const UPDATE_CHECK_CACHE_MS = 5 * 60_000

export function UpdateSkillPopover({
  workspaceId,
  workingDirectory,
  skill,
  align = 'end',
  onComplete,
}: UpdateSkillPopoverProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [state, setState] = React.useState<UpdateState>({ status: 'idle' })
  const lastSuccessfulCheckAtRef = React.useRef(0)

  const request = React.useMemo(() => {
    if (!skill?.management) return undefined
    return {
      slug: skill.slug,
      scope: skill.management.scope,
      workingDirectory,
    }
  }, [skill, workingDirectory])

  const runCheck = React.useCallback(async () => {
    setState({ status: 'checking' })
    try {
      const result = await window.electronAPI.checkSkillUpdates(workspaceId, request)
      lastSuccessfulCheckAtRef.current = Date.now()
      setState({ status: 'ready', result })
    } catch (error) {
      setState({
        status: 'error',
        phase: 'checking',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [request, workspaceId])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    const shouldCheck = state.status === 'idle' || (
      (state.status === 'ready' || state.status === 'complete')
      && Date.now() - lastSuccessfulCheckAtRef.current >= UPDATE_CHECK_CACHE_MS
    )

    if (nextOpen && shouldCheck) {
      void runCheck()
    }
  }, [runCheck, state.status])

  const handleUpdate = React.useCallback(async () => {
    if (
      state.status !== 'ready'
      && !(state.status === 'error' && state.phase === 'updating')
    ) return
    if (state.result.updates.length === 0) return
    const result = state.result
    setState({ status: 'updating', result })

    try {
      if (skill?.management) {
        await window.electronAPI.updateSkill(workspaceId, {
          slug: skill.slug,
          scope: skill.management.scope,
          workingDirectory,
        })
        toast.success(t('skillsManager.updated', { name: skill.metadata.name }))
      } else {
        await window.electronAPI.updateAllGlobalSkills(workspaceId, workingDirectory)
        toast.success(t('skillsManager.updatedAllGlobal'))
      }
      lastSuccessfulCheckAtRef.current = Date.now()
      setState({ status: 'complete', result })
      onComplete?.()
    } catch (error) {
      setState({
        status: 'error',
        phase: 'updating',
        result,
        message: error instanceof Error ? error.message : String(error),
      })
      toast.error(t('skillsManager.updateFailed'))
    }
  }, [onComplete, skill, state, t, workspaceId, workingDirectory])

  const handleIgnoreError = React.useCallback(() => {
    lastSuccessfulCheckAtRef.current = 0
    setState({ status: 'idle' })
    setOpen(false)
  }, [])

  const result = 'result' in state ? state.result : null
  const updateCount = result?.updates.length ?? 0
  const isBusy = state.status === 'checking' || state.status === 'updating'

  const icon = state.status === 'checking' || state.status === 'updating'
    ? <LoaderCircle className="h-4 w-4 animate-spin" />
    : state.status === 'ready' && updateCount > 0
      ? <CircleArrowUp className="h-4 w-4" />
      : state.status === 'complete' || (state.status === 'ready' && updateCount === 0)
        ? <CircleCheck className="h-4 w-4" />
        : state.status === 'error'
          ? <CircleAlert className="h-4 w-4" />
          : <RefreshCw className="h-4 w-4" />

  const tooltip = skill
    ? t('skillsManager.update')
    : t('skillsManager.updateAllGlobal')

  const title = state.status === 'checking'
    ? t('skillsManager.checkingUpdates')
    : state.status === 'updating'
      ? t('skillsManager.updatingConfirmed', { count: updateCount })
      : state.status === 'complete'
        ? (skill
            ? t('skillsManager.updated', { name: skill.metadata.name })
            : t('skillsManager.updatedAllGlobal'))
        : state.status === 'error'
          ? (state.phase === 'checking'
              ? t('skillsManager.checkFailed')
              : t('skillsManager.updateFailed'))
          : updateCount > 0
            ? t('skillsManager.updatesAvailable', { count: updateCount })
            : t('skillsManager.noUpdates')

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <HeaderIconButton
          icon={icon}
          aria-label={tooltip}
          title={tooltip}
          data-update-state={state.status}
          className={cn(
            state.status === 'ready' && updateCount > 0 && 'text-foreground',
            state.status === 'error' && 'text-destructive',
          )}
        />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        sideOffset={8}
        className="w-[320px] overflow-hidden p-0"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex items-start gap-2.5 px-3 py-3">
          <div className={cn(
            'mt-0.5 shrink-0 text-muted-foreground',
            state.status === 'ready' && updateCount > 0 && 'text-foreground',
            state.status === 'complete' && 'text-success',
            state.status === 'error' && 'text-destructive',
          )}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium leading-5">{title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {state.status === 'checking'
                ? t('skillsManager.checkingUpdatesDescription')
                : state.status === 'ready' && updateCount > 0
                  ? t('skillsManager.updatesAvailableDescription')
                  : state.status === 'ready'
                    ? t('skillsManager.noUpdatesDescription', { count: result?.checkedCount ?? 0 })
                    : state.status === 'updating'
                      ? (skill
                          ? t('skillsManager.updating', { name: skill.metadata.name })
                          : t('skillsManager.updatingAllGlobal'))
                      : state.status === 'complete'
                        ? t('skillsManager.noUpdatesDescription', { count: result?.checkedCount ?? updateCount })
                        : state.status === 'error'
                          ? state.message
                          : null}
            </div>
          </div>
        </div>

        {result && updateCount > 0 && (
          <div className="max-h-52 overflow-y-auto border-t border-border/50 px-2 py-1.5">
            {result.updates.map((update) => {
              const label = skill?.slug === update.slug ? skill.metadata.name : update.slug
              return (
                <div
                  key={`${update.scope}:${update.slug}`}
                  className="flex items-center gap-2 rounded-[6px] px-2 py-1.5 text-xs"
                >
                  {state.status === 'updating'
                    ? <LoaderCircle className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                    : state.status === 'complete'
                      ? <Check className="h-3.5 w-3.5 shrink-0 text-success" />
                      : <CircleArrowUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{label}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {update.scope === 'global'
                      ? t('skillsManager.scopeGlobal')
                      : t('skillsManager.scopeProject')}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {result && result.skippedCount > 0 && (
          <div className="border-t border-border/50 px-3 py-2 text-[11px] text-muted-foreground">
            {t('skillsManager.checkIncomplete', { count: result.skippedCount })}
          </div>
        )}

        {(state.status === 'ready' || state.status === 'complete') && (
          <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
            {state.status === 'ready' && updateCount > 0 && (
              <Button
                size="sm"
                className="h-7 gap-1.5"
                onClick={() => void handleUpdate()}
              >
                <CircleArrowUp className="h-3.5 w-3.5" />
                {t('skillsManager.confirmUpdates', { count: updateCount })}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 text-muted-foreground hover:text-foreground"
              onClick={() => void runCheck()}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('skillsManager.checkAgain')}
            </Button>
          </div>
        )}

        {state.status === 'error' && (
          <div className="flex items-center gap-2 border-t border-border/50 px-3 py-2">
            <Button
              size="sm"
              className="h-7 gap-1.5"
              onClick={() => void (state.phase === 'updating' ? handleUpdate() : runCheck())}
              disabled={isBusy}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {t('common.retry')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-muted-foreground hover:text-foreground"
              onClick={handleIgnoreError}
            >
              {t('common.ignore')}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
