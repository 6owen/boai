import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, RefreshCw } from 'lucide-react'
import { Spinner } from '@craft-agent/ui'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { LoadedSkill, SkillUpdateCheckResult } from '../../../shared/types'

interface UpdateSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workingDirectory?: string
  skill?: LoadedSkill
  onBusyChange?: (busy: boolean) => void
  onComplete?: () => void
}

type CheckState =
  | { status: 'checking' }
  | { status: 'ready'; result: SkillUpdateCheckResult }
  | { status: 'error'; message: string }

export function UpdateSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  workingDirectory,
  skill,
  onBusyChange,
  onComplete,
}: UpdateSkillDialogProps) {
  const { t } = useTranslation()
  const [checkState, setCheckState] = React.useState<CheckState>({ status: 'checking' })
  const [updating, setUpdating] = React.useState(false)

  const runCheck = React.useCallback(async () => {
    setCheckState({ status: 'checking' })
    try {
      const result = await window.electronAPI.checkSkillUpdates(
        workspaceId,
        skill?.management ? {
          slug: skill.slug,
          scope: skill.management.scope,
          workingDirectory,
        } : undefined,
      )
      setCheckState({ status: 'ready', result })
    } catch (error) {
      setCheckState({
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }, [skill, workspaceId, workingDirectory])

  React.useEffect(() => {
    if (!open) return
    setUpdating(false)
    void runCheck()
  }, [open, runCheck])

  const busy = checkState.status === 'checking' || updating
  React.useEffect(() => {
    onBusyChange?.(open && busy)
  }, [busy, onBusyChange, open])

  const handleUpdate = async () => {
    if (checkState.status !== 'ready' || checkState.result.updates.length === 0) return
    setUpdating(true)
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
      onOpenChange(false)
      onComplete?.()
    } catch (error) {
      toast.error(t('skillsManager.updateFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setUpdating(false)
    }
  }

  const result = checkState.status === 'ready' ? checkState.result : null
  const updateCount = result?.updates.length ?? 0

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !updating && onOpenChange(nextOpen)}>
      <DialogContent showCloseButton={!updating} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {checkState.status === 'checking'
              ? <Spinner />
              : updateCount === 0 && checkState.status === 'ready'
                ? <CheckCircle2 className="h-4 w-4 text-success" />
                : <RefreshCw className="h-4 w-4" />}
            {checkState.status === 'checking'
              ? t('skillsManager.checkingUpdates')
              : checkState.status === 'error'
                ? t('skillsManager.checkFailed')
                : updateCount > 0
                  ? t('skillsManager.updatesAvailable', { count: updateCount })
                  : t('skillsManager.noUpdates')}
          </DialogTitle>
          <DialogDescription>
            {checkState.status === 'checking'
              ? t('skillsManager.checkingUpdatesDescription')
              : checkState.status === 'error'
                ? checkState.message
                : updateCount > 0
                  ? t('skillsManager.updatesAvailableDescription')
                  : t('skillsManager.noUpdatesDescription', { count: result?.checkedCount ?? 0 })}
          </DialogDescription>
        </DialogHeader>

        {result && updateCount > 0 && (
          <div className="max-h-56 overflow-y-auto rounded-md border border-border/50 bg-foreground/[0.02] p-2">
            {result.updates.map(update => (
              <div key={`${update.scope}:${update.slug}`} className="px-2 py-1.5 text-sm">
                {skill?.slug === update.slug ? skill.metadata.name : update.slug}
              </div>
            ))}
          </div>
        )}

        {result && result.skippedCount > 0 && (
          <p className="text-xs text-muted-foreground">
            {t('skillsManager.checkIncomplete', { count: result.skippedCount })}
          </p>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {checkState.status === 'error' ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>{t('common.cancel')}</Button>
              <Button onClick={() => void runCheck()}>{t('common.retry')}</Button>
            </>
          ) : updateCount > 0 ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button onClick={() => void handleUpdate()} disabled={busy}>
                {updating && <Spinner />}
                {updating
                  ? t('skillsManager.updatingConfirmed', { count: updateCount })
                  : t('skillsManager.confirmUpdates', { count: updateCount })}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              {busy ? t('common.checking') : t('common.done')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
