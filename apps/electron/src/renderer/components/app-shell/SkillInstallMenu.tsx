import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { FolderPlus, GitBranch, Plus } from 'lucide-react'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { InstallSkillPopoverContent } from './InstallSkillDialog'

interface SkillInstallMenuProps {
  workspaceId: string
  workingDirectory?: string
}

export function SkillInstallMenu({ workspaceId, workingDirectory }: SkillInstallMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [panel, setPanel] = React.useState<'local' | 'git' | null>(null)
  const [busy, setBusy] = React.useState(false)

  const close = React.useCallback(() => {
    setOpen(false)
    setPanel(null)
  }, [])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && busy) return
    setOpen(nextOpen)
    if (!nextOpen) setPanel(null)
  }, [busy])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <HeaderIconButton
          icon={<Plus className="h-4 w-4" />}
          tooltip={t('skillsManager.addSkill')}
          aria-label={t('skillsManager.addSkill')}
          data-tutorial="install-skill-button"
        />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        collisionPadding={12}
        className={cn(
          'overflow-hidden rounded-[8px] bg-background p-0 text-foreground shadow-modal-small',
          panel
            ? 'h-[460px] w-[360px] max-h-[calc(100vh-24px)] max-w-[calc(100vw-24px)]'
            : 'w-[240px]',
        )}
        onOpenAutoFocus={event => event.preventDefault()}
        onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
        onInteractOutside={event => { if (busy) event.preventDefault() }}
      >
        {panel ? (
          <InstallSkillPopoverContent
            key={panel}
            workspaceId={workspaceId}
            workingDirectory={workingDirectory}
            variant={panel}
            onClose={close}
            onBusyChange={setBusy}
          />
        ) : (
          <div className="p-1.5" role="menu" aria-label={t('skillsManager.addSkill')}>
            <button
              type="button"
              role="menuitem"
              onClick={() => setPanel('local')}
              className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <FolderPlus className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('skillsManager.localSourceMenu')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => setPanel('git')}
              className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <GitBranch className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('skillsManager.gitSourceMenu')}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
