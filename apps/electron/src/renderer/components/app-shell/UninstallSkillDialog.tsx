import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PackageMinus } from 'lucide-react'
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
import type { LoadedSkill } from '../../../shared/types'

interface UninstallSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workingDirectory?: string
  skill: LoadedSkill
  onComplete?: () => void
}

export function UninstallSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  workingDirectory,
  skill,
  onComplete,
}: UninstallSkillDialogProps) {
  const { t } = useTranslation()
  const [uninstalling, setUninstalling] = React.useState(false)
  const scope = skill.management?.scope
  const scopeLabel = scope === 'project'
    ? t('skillsManager.scopeProject')
    : t('skillsManager.scopeGlobal')

  const handleUninstall = async () => {
    if (!scope) return
    setUninstalling(true)
    try {
      await window.electronAPI.uninstallSkill(workspaceId, {
        slug: skill.slug,
        scope,
        workingDirectory,
      })
      toast.success(t('skillsManager.uninstalled', { name: skill.metadata.name }))
      onOpenChange(false)
      onComplete?.()
    } catch (error) {
      toast.error(t('skillsManager.uninstallFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setUninstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !uninstalling && onOpenChange(nextOpen)}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackageMinus className="h-4 w-4" />
            {t('skillsManager.uninstallTitle')}
          </DialogTitle>
          <DialogDescription>
            {t('skillsManager.uninstallDescription', {
              name: skill.metadata.name,
              scope: scopeLabel,
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={uninstalling}>
            {t('common.cancel')}
          </Button>
          <Button variant="destructive" onClick={() => void handleUninstall()} disabled={uninstalling || !scope}>
            {uninstalling ? t('skillsManager.uninstalling') : t('skillsManager.uninstall')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
