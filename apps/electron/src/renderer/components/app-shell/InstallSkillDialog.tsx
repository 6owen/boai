import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { PackagePlus } from 'lucide-react'
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
import { Input } from '@/components/ui/input'
import type { SkillManagementScope } from '@craft-agent/shared/skills'

interface InstallSkillDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workingDirectory?: string
}

export function InstallSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  workingDirectory,
}: InstallSkillDialogProps) {
  const { t } = useTranslation()
  const [source, setSource] = React.useState('')
  const [slug, setSlug] = React.useState('')
  const [scope, setScope] = React.useState<SkillManagementScope>('global')
  const [installing, setInstalling] = React.useState(false)

  React.useEffect(() => {
    if (!open) return
    setSource('')
    setSlug('')
    setScope('global')
  }, [open])

  const canInstall = source.trim().length > 0
    && slug.trim().length > 0
    && (scope === 'global' || !!workingDirectory)

  const handleInstall = async () => {
    if (!canInstall) return
    setInstalling(true)
    try {
      await window.electronAPI.installSkill(workspaceId, {
        source: source.trim(),
        slug: slug.trim(),
        scope,
        workingDirectory,
      })
      toast.success(t('skillsManager.installed', { name: slug.trim() }))
      onOpenChange(false)
    } catch (error) {
      toast.error(t('skillsManager.installFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setInstalling(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !installing && onOpenChange(nextOpen)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4" />
            {t('skillsManager.installTitle')}
          </DialogTitle>
          <DialogDescription>{t('skillsManager.installDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              {t('skillsManager.sourceLabel')}
            </div>
            <Input
              autoFocus
              value={source}
              onChange={(event) => setSource(event.target.value)}
              placeholder={t('skillsManager.sourcePlaceholder')}
              disabled={installing}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              {t('skillsManager.slugLabel')}
            </div>
            <Input
              value={slug}
              onChange={(event) => setSlug(event.target.value)}
              placeholder={t('skillsManager.slugPlaceholder')}
              disabled={installing}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canInstall) {
                  event.preventDefault()
                  void handleInstall()
                }
              }}
            />
          </div>

          <div>
            <div className="mb-1.5 text-xs text-muted-foreground">
              {t('skillsManager.scopeLabel')}
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={scope === 'global' ? 'default' : 'outline'}
                onClick={() => setScope('global')}
                disabled={installing}
              >
                {t('skillsManager.scopeGlobal')}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={scope === 'project' ? 'default' : 'outline'}
                onClick={() => setScope('project')}
                disabled={installing || !workingDirectory}
              >
                {t('skillsManager.scopeProject')}
              </Button>
            </div>
            {!workingDirectory && (
              <p className="mt-1.5 text-xs text-muted-foreground">
                {t('skillsManager.projectUnavailable')}
              </p>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={installing}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void handleInstall()} disabled={!canInstall || installing}>
            {installing ? t('skillsManager.installing') : t('skillsManager.install')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
