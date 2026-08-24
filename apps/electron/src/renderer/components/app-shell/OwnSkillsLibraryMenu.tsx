import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  HardDriveDownload,
  LoaderCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { HeaderIconButton } from '@/components/ui/HeaderIconButton'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import type { LoadedSkill } from '../../../shared/types'
import { InstallSkillPopoverContent } from './InstallSkillDialog'

interface OwnSkillsLibraryMenuProps {
  workspaceId: string
  workingDirectory?: string
  favoriteKeys: ReadonlySet<string>
  excludedOwnSkillKeys: ReadonlySet<string>
  onAddToOwn: (skill: Pick<LoadedSkill, 'slug' | 'source'>) => void
}

export function OwnSkillsLibraryMenu({
  workspaceId,
  workingDirectory,
  favoriteKeys,
  excludedOwnSkillKeys,
  onAddToOwn,
}: OwnSkillsLibraryMenuProps) {
  const { t } = useTranslation()
  const [open, setOpen] = React.useState(false)
  const [panel, setPanel] = React.useState<'import' | null>(null)
  const [importing, setImporting] = React.useState(false)
  const [exporting, setExporting] = React.useState(false)
  const busy = importing || exporting

  const close = React.useCallback(() => {
    setOpen(false)
    setPanel(null)
  }, [])

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen && busy) return
      setOpen(nextOpen)
      if (!nextOpen) setPanel(null)
    },
    [busy],
  )

  const handleExport = React.useCallback(async () => {
    if (exporting) return

    const targetDirectory = await window.electronAPI.openFolderDialog({
      title: t('skillsLibrary.chooseExportDirectory'),
      buttonLabel: t('skillsLibrary.exportButton'),
    })
    if (!targetDirectory) return

    setExporting(true)
    const toastId = toast.loading(t('skillsLibrary.exporting'))
    try {
      const result = await window.electronAPI.exportOwnSkillLibrary(
        workspaceId,
        {
          targetDirectory,
          favoriteKeys: [...favoriteKeys],
          excludedKeys: [...excludedOwnSkillKeys],
          workingDirectory,
        },
      )
      const count = result.localSkills.length + result.vendorSkills.length
      toast.success(t('skillsLibrary.exported', { count }), {
        id: toastId,
        description: t('skillsLibrary.exportedDescription', {
          local: result.localSkills.length,
          vendor: result.vendorSkills.length,
          sources: result.sources.length,
        }),
        action: {
          label: t('skillsLibrary.showInFinder'),
          onClick: () => window.electronAPI.showInFolder(result.archivePath),
        },
      })
      if (result.snapshots.length > 0) {
        toast.warning(
          t('skillsLibrary.snapshotWarning', {
            count: result.snapshots.length,
          }),
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      toast.error(t('skillsLibrary.exportFailed'), {
        id: toastId,
        description: message,
      })
    } finally {
      setExporting(false)
    }
  }, [
    excludedOwnSkillKeys,
    exporting,
    favoriteKeys,
    t,
    workspaceId,
    workingDirectory,
  ])

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <HeaderIconButton
          icon={
            exporting ? (
              <LoaderCircle className="h-4 w-4 animate-spin" />
            ) : (
              <HardDriveDownload className="h-4 w-4" />
            )
          }
          tooltip={t('skillsLibrary.menu')}
          aria-label={t('skillsLibrary.menu')}
          disabled={busy}
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
        onOpenAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault()
        }}
      >
        {panel === 'import' ? (
          <InstallSkillPopoverContent
            workspaceId={workspaceId}
            workingDirectory={workingDirectory}
            variant="local"
            mode="import-own"
            favoriteKeys={favoriteKeys}
            excludedOwnSkillKeys={excludedOwnSkillKeys}
            onAddToOwn={onAddToOwn}
            onClose={close}
            onBusyChange={setImporting}
          />
        ) : (
          <div
            className="p-1.5"
            role="menu"
            aria-label={t('skillsLibrary.menu')}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => setPanel('import')}
              className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ArrowDownToLine className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('skillsLibrary.importDirectory')}</span>
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                void handleExport()
              }}
              className="flex h-9 w-full items-center gap-2.5 rounded-[6px] px-2.5 text-left text-sm text-foreground transition-colors hover:bg-foreground/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ArrowUpFromLine className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span>{t('skillsLibrary.exportDirectory')}</span>
            </button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
