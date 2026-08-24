import * as React from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  FileArchive,
  FolderOpen,
  Link2,
  LoaderCircle,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { isSkillInOwnCollection } from '@/hooks/useSkillCollections'
import type { LoadedSkill } from '../../../shared/types'
import type {
  SkillInstallSourceKind,
  SkillManagementScope,
  SkillSourceScanResult,
} from '@craft-agent/shared/skills'

interface InstallSkillPopoverContentProps {
  workspaceId: string
  workingDirectory?: string
  variant: 'local' | 'git'
  mode?: 'install' | 'import-own'
  favoriteKeys?: ReadonlySet<string>
  excludedOwnSkillKeys?: ReadonlySet<string>
  onAddToOwn?: (skill: Pick<LoadedSkill, 'slug' | 'source'>) => void
  onClose: () => void
  onBusyChange?: (busy: boolean) => void
}

type InstallStatus = 'installing' | 'installed' | 'failed'

const sourceTabs: Array<{
  kind: Exclude<SkillInstallSourceKind, 'git'>
  icon: React.ComponentType<{ className?: string }>
  labelKey: string
}> = [
  { kind: 'folder', icon: FolderOpen, labelKey: 'skillsManager.folder' },
  { kind: 'zip', icon: FileArchive, labelKey: 'skillsManager.zip' },
  { kind: 'url', icon: Link2, labelKey: 'skillsManager.url' },
]

function folderPathFromSelection(file: File, absolutePath: string): string {
  const relative = file.webkitRelativePath?.replace(/\\/g, '/')
  if (!relative) return absolutePath
  const topFolder = relative.split('/')[0]
  return `${absolutePath.slice(0, Math.max(0, absolutePath.length - relative.length))}${topFolder}`
}

export function InstallSkillPopoverContent({
  workspaceId,
  workingDirectory,
  variant,
  mode = 'install',
  favoriteKeys = new Set(),
  excludedOwnSkillKeys = new Set(),
  onAddToOwn,
  onClose,
  onBusyChange,
}: InstallSkillPopoverContentProps) {
  const { t } = useTranslation()
  const [kind, setKind] = React.useState<SkillInstallSourceKind>(variant === 'git' ? 'git' : 'folder')
  const [source, setSource] = React.useState('')
  const [scanResult, setScanResult] = React.useState<SkillSourceScanResult | null>(null)
  const [existingSkills, setExistingSkills] = React.useState<Map<string, LoadedSkill>>(new Map())
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [scope, setScope] = React.useState<SkillManagementScope>('global')
  const [scanning, setScanning] = React.useState(false)
  const [statuses, setStatuses] = React.useState<Record<string, InstallStatus>>({})
  const folderInputRef = React.useRef<HTMLInputElement>(null)
  const zipInputRef = React.useRef<HTMLInputElement>(null)
  const sourceInputRef = React.useRef<HTMLInputElement>(null)
  const installing = Object.values(statuses).some(status => status === 'installing')
  const busy = scanning || installing

  React.useEffect(() => {
    onBusyChange?.(busy)
    return () => onBusyChange?.(false)
  }, [busy, onBusyChange])

  React.useEffect(() => {
    if (kind !== 'url' && kind !== 'git') return
    const frame = window.requestAnimationFrame(() => sourceInputRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [kind])

  const scan = React.useCallback(async (nextSource = source, nextKind = kind) => {
    const trimmed = nextSource.trim()
    if (!trimmed) return
    setScanning(true)
    setScanResult(null)
    setStatuses({})
    try {
      const [result, loadedSkills] = await Promise.all([
        window.electronAPI.scanSkillSource(workspaceId, { source: trimmed, kind: nextKind }),
        mode === 'import-own'
          ? window.electronAPI.getSkills(workspaceId, workingDirectory)
          : Promise.resolve([] as LoadedSkill[]),
      ])
      const bySlug = new Map<string, LoadedSkill>()
      for (const skill of loadedSkills) {
        const current = bySlug.get(skill.slug)
        if (!current || isSkillInOwnCollection(skill, favoriteKeys, excludedOwnSkillKeys)) {
          bySlug.set(skill.slug, skill)
        }
      }
      setSource(trimmed)
      setScanResult(result)
      setExistingSkills(bySlug)
      setSelected(new Set(result.candidates
        .filter(candidate => {
          const installed = bySlug.get(candidate.slug)
          return !installed || !isSkillInOwnCollection(installed, favoriteKeys, excludedOwnSkillKeys)
        })
        .map(candidate => candidate.slug)))
    } catch (error) {
      toast.error(t('skillsManager.scanFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setScanning(false)
    }
  }, [excludedOwnSkillKeys, favoriteKeys, kind, mode, source, t, workspaceId, workingDirectory])

  const selectFiles = React.useCallback((files: FileList | null, selectedKind: 'folder' | 'zip') => {
    const file = files?.[0]
    if (!file) return
    const absolutePath = window.electronAPI.getFilePath(file)
    if (!absolutePath) {
      toast.error(t('skillsManager.localPathUnavailable'))
      return
    }
    const nextSource = selectedKind === 'folder' ? folderPathFromSelection(file, absolutePath) : absolutePath
    setSource(nextSource)
    void scan(nextSource, selectedKind)
  }, [scan, t])

  const toggleCandidate = (slug: string) => {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
  }

  const installSelected = async () => {
    if (!scanResult || selected.size === 0) return
    let failed = 0
    for (const candidate of scanResult.candidates.filter(item => selected.has(item.slug))) {
      setStatuses(current => ({ ...current, [candidate.slug]: 'installing' }))
      try {
        const existing = existingSkills.get(candidate.slug)
        if (mode === 'import-own' && existing) {
          onAddToOwn?.(existing)
        } else {
          await window.electronAPI.installSkill(workspaceId, {
            source: candidate.installSource ?? scanResult.installSource,
            slug: candidate.slug,
            scope: mode === 'import-own' ? 'global' : scope,
            workingDirectory,
          })
          if (mode === 'import-own') onAddToOwn?.({ slug: candidate.slug, source: 'global' })
        }
        setStatuses(current => ({ ...current, [candidate.slug]: 'installed' }))
      } catch {
        failed += 1
        setStatuses(current => ({ ...current, [candidate.slug]: 'failed' }))
      }
    }
    if (failed === 0) {
      toast.success(t(mode === 'import-own' ? 'skillsLibrary.importedCount' : 'skillsManager.installedCount', {
        count: selected.size,
      }))
      onClose()
    } else {
      toast.error(t(mode === 'import-own' ? 'skillsLibrary.importPartialFailed' : 'skillsManager.installPartialFailed', {
        count: failed,
      }))
    }
  }

  const changeKind = (nextKind: SkillInstallSourceKind) => {
    setKind(nextKind)
    setSource('')
    setScanResult(null)
    setExistingSkills(new Map())
    setSelected(new Set())
    setStatuses({})
  }

  const isUrlMode = kind === 'url' || kind === 'git'
  const selectableSlugs = scanResult?.candidates
    .filter(candidate => {
      const installed = existingSkills.get(candidate.slug)
      return mode !== 'import-own'
        || !installed
        || !isSkillInOwnCollection(installed, favoriteKeys, excludedOwnSkillKeys)
    })
    .map(candidate => candidate.slug) ?? []
  const allSelectableSelected = selectableSlugs.length > 0
    && selectableSlugs.every(slug => selected.has(slug))

  return (
    <div className="flex h-full min-h-0 flex-col">
      {variant === 'local' && (
        <div className="shrink-0 border-b border-border/50 p-2">
          <div className="grid grid-cols-3 rounded-[7px] bg-foreground-2 p-0.5 shadow-minimal" role="tablist">
            {sourceTabs.map(tab => {
              const Icon = tab.icon
              const active = kind === tab.kind
              return (
                <button
                  key={tab.kind}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => changeKind(tab.kind)}
                  className={cn(
                    'flex h-7 min-w-0 items-center justify-center gap-1.5 rounded-[5px] px-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    active
                      ? 'bg-background font-medium text-foreground shadow-minimal'
                      : 'text-muted-foreground hover:bg-foreground/[0.025] hover:text-foreground',
                  )}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{t(tab.labelKey)}</span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex min-h-full flex-col">
          {isUrlMode ? (
            <div className="shrink-0 space-y-1.5 border-b border-border/50 p-3">
              <label htmlFor="skill-install-source" className="block select-none text-xs font-medium text-muted-foreground">
                {variant === 'git' ? t('skillsManager.gitUrl') : t('skillsManager.url')}
              </label>
              <div className="flex gap-2">
                <div className="min-w-0 flex-1 rounded-lg bg-foreground-2 shadow-minimal transition-colors has-[:focus]:bg-background">
                  <Input
                    ref={sourceInputRef}
                    id="skill-install-source"
                    value={source}
                    onChange={event => {
                      setSource(event.target.value)
                      setScanResult(null)
                      setStatuses({})
                    }}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && source.trim() && !busy) void scan()
                    }}
                    placeholder={variant === 'git' ? 'https://github.com/user/repo' : t('skillsManager.urlPlaceholder')}
                    disabled={busy}
                    className="h-9 border-0 bg-transparent py-2 text-sm shadow-none focus-visible:ring-0"
                  />
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 shrink-0 gap-1.5 px-3"
                  onClick={() => void scan()}
                  disabled={!source.trim() || busy}
                >
                  {scanning ? <LoaderCircle className="animate-spin" /> : <Search />}
                  {t('skillsManager.scan')}
                </Button>
              </div>
            </div>
          ) : (
            <div className={cn('flex min-h-0 p-3', scanResult ? 'shrink-0' : 'flex-1')}>
              <input
                ref={folderInputRef}
                type="file"
                className="hidden"
                onChange={event => selectFiles(event.target.files, 'folder')}
                {...({ webkitdirectory: '' } as React.InputHTMLAttributes<HTMLInputElement>)}
              />
              <input
                ref={zipInputRef}
                type="file"
                accept=".zip,application/zip"
                className="hidden"
                onChange={event => selectFiles(event.target.files, 'zip')}
              />
              <button
                type="button"
                onClick={() => (kind === 'folder' ? folderInputRef : zipInputRef).current?.click()}
                onDragOver={event => event.preventDefault()}
                onDrop={event => {
                  event.preventDefault()
                  selectFiles(event.dataTransfer.files, kind as 'folder' | 'zip')
                }}
                disabled={busy}
                className={cn(
                  'flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border/80 bg-foreground/[0.012] px-4 text-muted-foreground transition-colors hover:border-foreground/25 hover:bg-foreground/[0.025] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60',
                  scanResult ? 'min-h-28' : 'min-h-44 flex-1',
                )}
              >
                {scanning
                  ? <LoaderCircle className="h-7 w-7 animate-spin" />
                  : kind === 'folder'
                    ? <FolderOpen className="h-7 w-7" />
                    : <FileArchive className="h-7 w-7" />}
                <span className="max-w-full truncate text-sm">
                  {source || (kind === 'folder' ? t('skillsManager.folderDropHint') : t('skillsManager.zipDropHint'))}
                </span>
              </button>
            </div>
          )}

          {isUrlMode && !scanResult && (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-foreground-2 text-muted-foreground shadow-minimal">
                <Search className="h-5 w-5" />
              </div>
              <div className="text-sm font-medium">{t('skillsManager.availableSkills')}</div>
              <div className="mt-1 max-w-64 text-xs leading-5 text-muted-foreground">
                {t('skillsManager.scanHint')}
              </div>
            </div>
          )}

          {scanResult && (
            <div className="mx-3 mb-3 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/60">
              <div className="flex shrink-0 items-center justify-between border-b border-border/50 px-3 py-2 text-xs text-muted-foreground">
                <div>
                  <span>{t('skillsManager.foundSkills', { count: scanResult.candidates.length })}</span>
                  {scanResult.library && (
                    <span className="mt-0.5 block text-[11px] text-muted-foreground/80">
                      {t('skillsLibrary.vendorCount', { count: scanResult.library.vendorCount })}
                      {' · '}
                      {t('skillsLibrary.sourceCount', { count: scanResult.library.sourceCount })}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="rounded-[5px] px-1.5 py-0.5 transition-colors hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  disabled={selectableSlugs.length === 0}
                  onClick={() => setSelected(allSelectableSelected
                    ? new Set()
                    : new Set(selectableSlugs))}
                >
                  {allSelectableSelected
                    ? t('skillsManager.selectNone')
                    : t('skillsManager.selectAll')}
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {scanResult.candidates.map(candidate => {
                  const checked = selected.has(candidate.slug)
                  const status = statuses[candidate.slug]
                  const installed = existingSkills.get(candidate.slug)
                  const alreadyInOwn = mode === 'import-own'
                    && installed
                    && isSkillInOwnCollection(installed, favoriteKeys, excludedOwnSkillKeys)
                  return (
                    <button
                      key={candidate.slug}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleCandidate(candidate.slug)}
                      disabled={installing || alreadyInOwn}
                      className="flex w-full items-start gap-2.5 rounded-[7px] px-2 py-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none"
                    >
                      <span className={cn(
                        'mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[4px] border',
                        checked ? 'border-foreground bg-foreground text-background' : 'border-border',
                      )}>
                        {checked && <Check className="h-2.5 w-2.5" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{candidate.slug}</span>
                        {candidate.description && (
                          <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-muted-foreground">
                            {candidate.description}
                          </span>
                        )}
                        {candidate.libraryKind && (
                          <span className="mt-1 block truncate text-[11px] leading-4 text-muted-foreground/80">
                            {t(`skillsLibrary.kind.${candidate.libraryKind}`)}
                            {candidate.sourceId ? ` · ${candidate.sourceId}` : ''}
                          </span>
                        )}
                      </span>
                      {status === 'installing' && <LoaderCircle className="mt-0.5 h-3.5 w-3.5 animate-spin" />}
                      {status === 'installed' && <Check className="mt-0.5 h-3.5 w-3.5 text-success" />}
                      {status === 'failed' && <span className="text-xs text-destructive">{t('common.failed')}</span>}
                      {!status && alreadyInOwn && (
                        <span className="shrink-0 text-xs text-muted-foreground">{t('skillsLibrary.alreadyInOwn')}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {scanResult && (
        <div className="flex shrink-0 items-end justify-between gap-3 border-t border-border/50 p-3">
          {mode === 'install' && <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{t('skillsManager.scopeLabel')}</div>
            <div className="flex rounded-[7px] bg-foreground-2 p-0.5 shadow-minimal">
              <button
                type="button"
                aria-pressed={scope === 'global'}
                onClick={() => setScope('global')}
                className={cn(
                  'h-7 rounded-[5px] px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                  scope === 'global' ? 'bg-background font-medium shadow-minimal' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('skillsManager.scopeGlobal')}
              </button>
              <button
                type="button"
                aria-pressed={scope === 'project'}
                onClick={() => setScope('project')}
                disabled={!workingDirectory}
                title={!workingDirectory ? t('skillsManager.projectUnavailable') : undefined}
                className={cn(
                  'h-7 rounded-[5px] px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40',
                  scope === 'project' ? 'bg-background font-medium shadow-minimal' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t('skillsManager.scopeProject')}
              </button>
            </div>
          </div>}
          {mode === 'import-own' && <div />}
          <Button
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => void installSelected()}
            disabled={selected.size === 0 || installing}
          >
            {installing && <LoaderCircle className="animate-spin" />}
            {t(mode === 'import-own' ? 'skillsLibrary.importSelected' : 'skillsManager.installSelected', {
              count: selected.size,
            })}
          </Button>
        </div>
      )}
    </div>
  )
}
