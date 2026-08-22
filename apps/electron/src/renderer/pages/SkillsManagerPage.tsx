import * as React from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileCode2,
  FolderOpen,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Star,
  Trash2,
  Undo2,
  WandSparkles,
} from 'lucide-react'
import { toast } from 'sonner'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { filterSkillPlacements, requiresOverwriteConfirmation, type SkillInventoryFilter } from '@/lib/skills-manager-model'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { EditPopover, getEditConfig } from '@/components/ui/EditPopover'
import type {
  SkillInstallPlan,
  SkillInventory,
  SkillOperationRecord,
  SkillPlacement,
  SkillRpcTarget,
} from '@craft-agent/shared/skills'

const FILTERS: Array<{ id: SkillInventoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'managed', label: 'Managed' },
  { id: 'external', label: 'External' },
  { id: 'invalid', label: 'Invalid' },
  { id: 'modified', label: 'Modified' },
  { id: 'conflict', label: 'Conflict' },
]

function originLabel(placement: SkillPlacement): string {
  const origin = placement.record?.origin
  if (!origin) return 'Unknown source'
  if (origin.type === 'git') return [origin.url, origin.ref, origin.commit].filter(Boolean).join(' · ')
  if (origin.type === 'registry') return [origin.package, origin.version].filter(Boolean).join('@')
  if (origin.type === 'local') return origin.path
  return origin.type === 'manual' ? 'Manually managed' : 'Unknown source'
}

function scopeTarget(placement?: SkillPlacement): SkillRpcTarget {
  if (placement?.source === 'global') return { source: 'global' }
  if (placement?.source === 'project') return { source: 'project' }
  return { source: 'workspace' }
}

function InstallSkillDialog({
  open,
  onOpenChange,
  workspaceId,
  workingDirectory,
  placement,
  localFilesAllowed,
  onComplete,
}: {
  open: boolean
  onOpenChange(open: boolean): void
  workspaceId: string
  workingDirectory?: string
  placement?: SkillPlacement
  localFilesAllowed: boolean
  onComplete(): void
}) {
  const existingOrigin = placement?.record?.origin
  const initialMode = existingOrigin?.type === 'local' && localFilesAllowed ? 'local' : 'npx'
  const [mode, setMode] = useState<'npx' | 'local'>(initialMode)
  const [source, setSource] = useState(
    existingOrigin?.type === 'git' ? existingOrigin.url
      : existingOrigin?.type === 'registry' ? existingOrigin.package
        : existingOrigin?.type === 'local' ? existingOrigin.path
          : '',
  )
  const [slug, setSlug] = useState(placement?.slug ?? '')
  const [target, setTarget] = useState<SkillRpcTarget>(scopeTarget(placement))
  const [plan, setPlan] = useState<SkillInstallPlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [acceptOverwrite, setAcceptOverwrite] = useState(false)

  useEffect(() => {
    if (!open) return
    const origin = placement?.record?.origin
    setMode(origin?.type === 'local' && localFilesAllowed ? 'local' : 'npx')
    setSource(
      origin?.type === 'git' ? origin.url
        : origin?.type === 'registry' ? origin.package
          : origin?.type === 'local' ? origin.path
            : '',
    )
    setSlug(placement?.slug ?? '')
    setTarget(scopeTarget(placement))
    setPlan(null)
    setAcceptOverwrite(false)
  }, [localFilesAllowed, open, placement])

  const requestBase = { slug: slug.trim(), target, workingDirectory }

  const pickDirectory = async () => {
    const picked = await window.electronAPI.openFolderDialog()
    if (!picked) return
    setSource(picked)
    if (!slug) setSlug(picked.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '')
    setPlan(null)
  }

  const preview = async () => {
    if (!source.trim() || !slug.trim()) return
    setBusy(true)
    try {
      const result = mode === 'npx'
        ? await window.electronAPI.previewSkillFromNpx(workspaceId, {
            ...requestBase,
            source: source.trim(),
          })
        : await window.electronAPI.previewSkillDirectory(workspaceId, {
            ...requestBase,
            sourceDirectory: source.trim(),
            origin: { type: 'local', path: source.trim() },
          })
      setPlan(result)
      setAcceptOverwrite(false)
    } catch (error) {
      toast.error('Could not prepare Skill', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const install = async () => {
    if (!plan?.valid) return
    setBusy(true)
    try {
      if (mode === 'npx') {
        await window.electronAPI.installSkillFromNpx(workspaceId, {
          ...requestBase,
          source: source.trim(),
          overwrite: plan.operationType === 'update',
        })
      } else {
        await window.electronAPI.installSkillDirectory(workspaceId, {
          ...requestBase,
          sourceDirectory: source.trim(),
          origin: { type: 'local', path: source.trim() },
          overwrite: plan.operationType === 'update',
        })
      }
      toast.success(plan.operationType === 'update' ? 'Skill updated' : 'Skill installed')
      onOpenChange(false)
      onComplete()
    } catch (error) {
      toast.error('Skill operation failed', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{placement ? `Update ${placement.slug}` : 'Install a Skill'}</DialogTitle>
          <DialogDescription>
            The source is acquired in an isolated staging directory, validated, then atomically moved into place.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button size="sm" variant={mode === 'npx' ? 'default' : 'outline'} onClick={() => { setMode('npx'); setPlan(null) }}>
              npx skills / Git
            </Button>
            <Button size="sm" disabled={!localFilesAllowed} title={localFilesAllowed ? undefined : 'Local directories are unavailable for a remote workspace'} variant={mode === 'local' ? 'default' : 'outline'} onClick={() => { setMode('local'); setPlan(null) }}>
              Local directory
            </Button>
          </div>

          <label className="block space-y-1.5 text-sm">
            <span className="font-medium">{mode === 'npx' ? 'Git, registry, or skills.sh source' : 'Skill directory'}</span>
            <div className="flex gap-2">
              <Input value={source} onChange={event => { setSource(event.target.value); setPlan(null) }} placeholder={mode === 'npx' ? 'owner/repository or URL' : '/path/to/skill'} />
              {mode === 'local' && <Button variant="outline" onClick={pickDirectory}>Choose…</Button>}
            </div>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Skill slug</span>
              <Input value={slug} onChange={event => { setSlug(event.target.value); setPlan(null) }} placeholder="my-skill" />
            </label>
            <label className="space-y-1.5 text-sm">
              <span className="font-medium">Scope</span>
              <select
                className="h-9 w-full rounded-md border border-foreground/15 bg-background px-3 text-sm"
                value={target.source}
                onChange={event => { setTarget({ source: event.target.value as SkillRpcTarget['source'] }); setPlan(null) }}
              >
                <option value="workspace">Workspace</option>
                <option value="global">Global (~/.agents/skills)</option>
                <option value="project" disabled={!workingDirectory}>Current project</option>
              </select>
            </label>
          </div>

          {mode === 'npx' && source && slug && (
            <div className="rounded-md bg-foreground/[0.04] p-3 font-mono text-xs break-all">
              npx --yes skills add {source} --skill {slug} --agent universal --yes --copy
              <div className="mt-1 font-sans text-muted-foreground">Executed only inside app staging; the selected scope is committed by the transaction layer.</div>
            </div>
          )}

          {plan && (
            <div className="rounded-lg border border-foreground/10 p-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium capitalize">{plan.operationType} preview</span>
                <span className={plan.valid ? 'text-emerald-600' : 'text-destructive'}>{plan.valid ? 'Validated' : 'Invalid'}</span>
              </div>
              <div className="text-xs text-muted-foreground break-all">Target: {plan.targetPath}</div>
              {plan.diagnostics.map((item, index) => (
                <div key={`${item.path}-${index}`} className="text-xs text-destructive">{item.path}: {item.message}</div>
              ))}
              {plan.diff && (
                <div className="max-h-56 overflow-y-auto rounded-md bg-foreground/[0.03] p-2 space-y-1">
                  {plan.diff.files.map(file => (
                    <div key={file.path} className="grid grid-cols-[70px_1fr] gap-2 text-xs font-mono">
                      <span className={file.status === 'modified' ? 'text-amber-600' : file.status === 'added' ? 'text-emerald-600' : file.status === 'removed' ? 'text-destructive' : 'text-muted-foreground'}>{file.status}</span>
                      <span className="truncate">{file.path}</span>
                    </div>
                  ))}
                </div>
              )}
              {plan.localModified && (
                <label className="flex items-start gap-2 rounded-md bg-amber-500/10 p-3 text-xs text-amber-900">
                  <input type="checkbox" className="mt-0.5" checked={acceptOverwrite} onChange={event => setAcceptOverwrite(event.target.checked)} />
                  <span>
                    Local content changed after the managed baseline{plan.threeWayConflict ? ' and upstream changed too' : ''}. I reviewed the Diff and want to overwrite it. To preserve it, cancel or install under a different slug.
                  </span>
                </label>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="outline" disabled={busy || !source.trim() || !slug.trim()} onClick={preview}>
            {busy ? 'Preparing…' : 'Preview'}
          </Button>
          <Button disabled={busy || !plan?.valid || (requiresOverwriteConfirmation(plan) && !acceptOverwrite)} onClick={install}>
            Confirm {plan?.operationType ?? 'install'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function SkillsManagerPage({ workspaceId, workingDirectory }: { workspaceId: string; workingDirectory?: string }) {
  const { onOpenFile } = useAppShellContext()
  const activeWorkspace = useActiveWorkspace()
  const localFilesAllowed = !activeWorkspace?.remoteServer
  const [inventory, setInventory] = useState<SkillInventory | null>(null)
  const [operations, setOperations] = useState<SkillOperationRecord[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<SkillInventoryFilter>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [updatePlacement, setUpdatePlacement] = useState<SkillPlacement | undefined>()
  const [tagsDraft, setTagsDraft] = useState('')

  const load = useCallback(async () => {
    if (!workspaceId) return
    setLoading(true)
    setError(null)
    try {
      const [nextInventory, nextOperations] = await Promise.all([
        window.electronAPI.getSkillInventory(workspaceId, workingDirectory),
        window.electronAPI.listSkillOperations(workspaceId, workingDirectory),
      ])
      setInventory(nextInventory)
      setOperations(nextOperations.slice().reverse())
      setSelectedId(current => current && nextInventory.placements.some(item => item.id === current)
        ? current
        : nextInventory.placements[0]?.id ?? null)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [workspaceId, workingDirectory])

  useEffect(() => { void load() }, [load])
  useEffect(() => window.electronAPI.onSkillInventoryChanged((changedWorkspaceId, nextInventory) => {
    if (changedWorkspaceId !== workspaceId) return
    setInventory(nextInventory)
    void window.electronAPI.listSkillOperations(workspaceId, workingDirectory).then(items => setOperations(items.slice().reverse()))
  }), [workingDirectory, workspaceId])

  const placements = useMemo(() => {
    return filterSkillPlacements(inventory?.placements ?? [], filter, query)
  }, [filter, inventory, query])
  const selected = placements.find(item => item.id === selectedId) ?? placements[0]

  useEffect(() => {
    setTagsDraft(selected?.record?.tags?.join(', ') ?? '')
  }, [selected?.id, selected?.record?.tags])

  const adopt = async (placement: SkillPlacement, editOrigin = false) => {
    try {
      let origin = placement.record?.origin
      if (editOrigin || !origin) {
        const current = origin?.type === 'git' ? origin.url : origin?.type === 'local' ? origin.path : ''
        const value = window.prompt('Optional Git URL or local source path', current)
        if (value === null) return
        origin = value.trim()
          ? (/^(https?:\/\/|git@|[\w.-]+\/[\w.-]+$)/.test(value.trim())
              ? { type: 'git' as const, url: value.trim() }
              : { type: 'local' as const, path: value.trim() })
          : { type: 'unknown' as const }
      }
      await window.electronAPI.adoptSkill(workspaceId, { placementId: placement.id, workingDirectory, origin })
      toast.success(`${placement.slug} is now managed`)
    } catch (actionError) {
      toast.error('Could not manage Skill', { description: actionError instanceof Error ? actionError.message : String(actionError) })
    }
  }

  const updatePersonalMetadata = async (placement: SkillPlacement, favorite = placement.record?.favorite) => {
    try {
      await window.electronAPI.updateSkillMetadata(workspaceId, {
        placementId: placement.id,
        workingDirectory,
        favorite,
        tags: tagsDraft.split(',').map(tag => tag.trim()).filter(Boolean),
      })
      toast.success('Personal Skill metadata saved')
    } catch (actionError) {
      toast.error('Could not save Skill metadata', { description: actionError instanceof Error ? actionError.message : String(actionError) })
    }
  }

  const adoptVisible = async () => {
    const external = placements.filter(item => item.ownership === 'external' && item.status === 'valid')
    for (const placement of external) {
      await window.electronAPI.adoptSkill(workspaceId, {
        placementId: placement.id, workingDirectory, origin: { type: 'unknown' },
      })
    }
    toast.success(`${external.length} Skill${external.length === 1 ? '' : 's'} managed`)
  }

  const exportOperations = async () => {
    await navigator.clipboard.writeText(`${JSON.stringify(operations.slice().reverse(), null, 2)}\n`)
    toast.success('Operation log copied as JSON')
  }

  const stopManaging = async (placement: SkillPlacement) => {
    if (!placement.recordId) return
    try {
      await window.electronAPI.stopManagingSkill(workspaceId, placement.recordId, workingDirectory)
      toast.success('Skill content was kept; management metadata was removed')
    } catch (actionError) {
      toast.error('Could not stop managing Skill', { description: actionError instanceof Error ? actionError.message : String(actionError) })
    }
  }

  const remove = async (placement: SkillPlacement) => {
    if (!window.confirm(`Remove ${placement.slug}? A restorable snapshot will be retained.`)) return
    try {
      await window.electronAPI.removeManagedSkill(workspaceId, { placementId: placement.id, workingDirectory })
      toast.success('Skill moved to the backup area')
    } catch (actionError) {
      toast.error('Could not remove Skill', { description: actionError instanceof Error ? actionError.message : String(actionError) })
    }
  }

  const restore = async (operation: SkillOperationRecord) => {
    try {
      await window.electronAPI.restoreSkillOperation(workspaceId, operation.id, workingDirectory)
      toast.success(`${operation.slug} restored`)
    } catch (actionError) {
      toast.error('Could not restore Skill', { description: actionError instanceof Error ? actionError.message : String(actionError) })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PanelHeader
        title="Skills Manager"
        badge={<span className="rounded-full bg-foreground/5 px-2 py-0.5 text-xs text-muted-foreground">{inventory?.placements.length ?? 0} placements</span>}
        actions={(
          <div className="flex items-center gap-1">
            {placements.some(item => item.ownership === 'external' && item.status === 'valid') && <Button variant="outline" size="sm" onClick={() => void adoptVisible()}>Manage visible</Button>}
            <Button variant="ghost" size="sm" title="Copy operation log as JSON" onClick={() => void exportOperations()}>Export log</Button>
            <Button variant="ghost" size="icon" title="Refresh" onClick={() => void window.electronAPI.refreshSkillInventory(workspaceId, workingDirectory)}><RefreshCw /></Button>
            <Button size="sm" onClick={() => { setUpdatePlacement(undefined); setInstallOpen(true) }}><Plus /> Install</Button>
          </div>
        )}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(280px,38%)_1fr] border-t border-foreground/10">
        <aside className="flex min-h-0 flex-col border-r border-foreground/10">
          <div className="space-y-3 border-b border-foreground/10 p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search name, source, scope, status…" className="pl-9" />
            </div>
            <div className="flex flex-wrap gap-1">
              {FILTERS.map(item => (
                <button key={item.id} onClick={() => setFilter(item.id)} className={cn('rounded-full px-2.5 py-1 text-xs transition-colors', filter === item.id ? 'bg-foreground text-background' : 'bg-foreground/5 text-muted-foreground hover:bg-foreground/10')}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading && <div className="p-4 text-sm text-muted-foreground">Scanning three Skill scopes…</div>}
            {error && <div className="m-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
            {!loading && !error && placements.length === 0 && <div className="p-4 text-sm text-muted-foreground">No matching Skill placements.</div>}
            {placements.map(item => (
              <button key={item.id} onClick={() => setSelectedId(item.id)} className={cn('mb-1 w-full rounded-lg border p-3 text-left transition-colors', selected?.id === item.id ? 'border-foreground/20 bg-foreground/[0.06]' : 'border-transparent hover:bg-foreground/[0.03]')}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{item.skill?.metadata.name ?? (item.slug || 'Unreadable directory')}</div>
                    <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.skill?.metadata.description ?? item.diagnostics[0]?.message}</div>
                  </div>
                  {item.status === 'invalid' ? <AlertTriangle className="size-4 shrink-0 text-destructive" /> : item.effective ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : null}
                </div>
                <div className="mt-2 flex flex-wrap gap-1 text-[10px]">
                  <span className="rounded bg-foreground/5 px-1.5 py-0.5 capitalize">{item.source}</span>
                  <span className="rounded bg-foreground/5 px-1.5 py-0.5 capitalize">{item.ownership}</span>
                  {item.shadowed && <span className="rounded bg-amber-500/10 px-1.5 py-0.5 text-amber-700">shadowed</span>}
                  {item.conflict && <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive">conflict</span>}
                  {item.modified && <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-700">modified</span>}
                </div>
              </button>
            ))}
          </div>
        </aside>

        <main className="min-h-0 overflow-y-auto">
          {!selected ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Select a Skill placement.</div>
          ) : (
            <div className="mx-auto max-w-3xl space-y-5 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="truncate text-2xl font-semibold">{selected.skill?.metadata.name ?? (selected.slug || 'Invalid Skill')}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{selected.skill?.metadata.description ?? 'This directory is not a valid Skill.'}</p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-2">
                  {localFilesAllowed && <Button size="sm" variant="outline" onClick={() => window.electronAPI.showInFolder(selected.path)}><FolderOpen /> Reveal</Button>}
                  {localFilesAllowed && selected.status === 'valid' && <Button size="sm" variant="outline" onClick={() => onOpenFile(`${selected.path}/SKILL.md`)}><FileCode2 /> Edit</Button>}
                  {localFilesAllowed && selected.status === 'valid' && (
                    <EditPopover
                      trigger={<Button size="sm" variant="outline"><WandSparkles /> AI edit</Button>}
                      {...getEditConfig('skill-instructions', selected.path)}
                      secondaryAction={{ label: 'Edit SKILL.md', filePath: `${selected.path}/SKILL.md` }}
                    />
                  )}
                  {selected.ownership === 'external' && selected.status === 'valid' && <Button size="sm" onClick={() => void adopt(selected)}><ShieldCheck /> Manage</Button>}
                  {selected.ownership === 'managed' && <Button size="sm" variant={selected.record?.favorite ? 'default' : 'outline'} title="Favorite" onClick={() => void updatePersonalMetadata(selected, !selected.record?.favorite)}><Star className={selected.record?.favorite ? 'fill-current' : ''} /></Button>}
                  {selected.ownership === 'managed' && <Button size="sm" variant="outline" onClick={() => { setUpdatePlacement(selected); setInstallOpen(true) }}><ExternalLink /> Check / update</Button>}
                </div>
              </div>

              <section className="rounded-xl border border-foreground/10">
                <div className="border-b border-foreground/10 px-4 py-3 text-sm font-medium">Placement and provenance</div>
                <dl className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-3 p-4 text-sm">
                  <dt className="text-muted-foreground">Scope</dt><dd className="capitalize">{selected.source}{selected.effective ? ' · effective' : selected.shadowed ? ' · shadowed' : ''}</dd>
                  <dt className="text-muted-foreground">Ownership</dt><dd className="capitalize">{selected.ownership}{selected.modified ? ' · locally modified' : ''}</dd>
                  <dt className="text-muted-foreground">Source</dt><dd className="flex items-start gap-2 break-all"><span className="flex-1">{originLabel(selected)}</span>{selected.ownership === 'managed' && <button className="shrink-0 text-xs underline" onClick={() => void adopt(selected, true)}>Edit</button>}</dd>
                  <dt className="text-muted-foreground">Location</dt><dd className="break-all font-mono text-xs">{selected.path}</dd>
                  <dt className="text-muted-foreground">Content hash</dt><dd className="break-all font-mono text-xs">{selected.contentHash ?? 'Unavailable'}</dd>
                  {selected.record && <><dt className="text-muted-foreground">Managed since</dt><dd>{new Date(selected.record.managedAt).toLocaleString()}</dd></>}
                  {selected.record && <><dt className="text-muted-foreground">Tags</dt><dd className="flex gap-2"><Input className="h-8" value={tagsDraft} onChange={event => setTagsDraft(event.target.value)} placeholder="work, writing, review" /><Button size="sm" variant="outline" onClick={() => void updatePersonalMetadata(selected)}>Save</Button></dd></>}
                </dl>
              </section>

              {(selected.diagnostics.length > 0 || selected.conflict || selected.shadowed) && (
                <section className="rounded-xl border border-foreground/10">
                  <div className="border-b border-foreground/10 px-4 py-3 text-sm font-medium">Status and validation</div>
                  <div className="space-y-2 p-4 text-sm">
                    {selected.shadowed && <div className="rounded-md bg-amber-500/10 p-3 text-amber-800">A higher-priority placement is active: {selected.shadowedBy}</div>}
                    {selected.conflict && <div className="rounded-md bg-destructive/10 p-3 text-destructive">Same slug exists with different content in another scope.</div>}
                    {selected.diagnostics.map((item, index) => <div key={index} className="rounded-md bg-destructive/10 p-3"><div className="font-medium text-destructive">{item.path}: {item.message}</div>{item.suggestion && <div className="mt-1 text-xs text-muted-foreground">{item.suggestion}</div>}</div>)}
                  </div>
                </section>
              )}

              {selected.skill && (
                <section className="rounded-xl border border-foreground/10">
                  <div className="border-b border-foreground/10 px-4 py-3 text-sm font-medium">Instructions</div>
                  <pre className="max-h-72 overflow-auto whitespace-pre-wrap p-4 font-mono text-xs leading-5">{selected.skill.content}</pre>
                </section>
              )}

              {selected.ownership === 'managed' && (
                <section className="flex flex-wrap justify-between gap-3 rounded-xl border border-foreground/10 p-4">
                  <div><div className="text-sm font-medium">Management actions</div><div className="text-xs text-muted-foreground">Removing creates a backup. Stopping management keeps every file in place.</div></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => void stopManaging(selected)}>Stop managing</Button>
                    <Button size="sm" variant="destructive" onClick={() => void remove(selected)}><Trash2 /> Remove safely</Button>
                  </div>
                </section>
              )}

              <section className="rounded-xl border border-foreground/10">
                <div className="flex items-center gap-2 border-b border-foreground/10 px-4 py-3 text-sm font-medium"><Clock3 className="size-4" /> Recent operations</div>
                <div className="divide-y divide-foreground/10">
                  {operations.length === 0 && <div className="p-4 text-sm text-muted-foreground">No managed operations yet.</div>}
                  {operations.slice(0, 20).map(operation => (
                    <div key={operation.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                      <div className="min-w-0"><div className="font-medium capitalize">{operation.type} · {operation.slug}</div><div className="truncate text-xs text-muted-foreground">{new Date(operation.completedAt).toLocaleString()} · {operation.status}{operation.error ? ` · ${operation.error}` : ''}</div></div>
                      {operation.status === 'succeeded' && operation.type !== 'restore' && <Button size="sm" variant="ghost" onClick={() => void restore(operation)}><Undo2 /> Restore</Button>}
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </main>
      </div>

      <InstallSkillDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        workspaceId={workspaceId}
        workingDirectory={workingDirectory}
        placement={updatePlacement}
        localFilesAllowed={localFilesAllowed}
        onComplete={() => void load()}
      />
    </div>
  )
}
