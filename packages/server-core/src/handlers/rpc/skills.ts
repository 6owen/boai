import { join } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { CONFIG_DIR, getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import {
  GLOBAL_AGENT_SKILLS_DIR,
  SkillCatalogStore,
  SkillInventoryWatcher,
  SkillOperationService,
  invalidateSkillsCache,
  scanSkillInventory,
  type InstallSkillFromDirectoryRequest,
  type InstallSkillFromNpxRequest,
  type RemoveSkillRequest,
  type SkillAdoptRequest,
  type SkillInstallDirectoryRequest,
  type SkillInstallNpxRequest,
  type SkillInstallPlan,
  type SkillInventory,
  type SkillInventoryRoots,
  type SkillMetadataUpdateRequest,
  type SkillOperationRecord,
  type SkillOrigin,
  type SkillPlacement,
  type SkillRemoveManagedRequest,
  type SkillRpcTarget,
  type SkillTarget,
} from '@craft-agent/shared/skills'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_INVENTORY,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.ADOPT,
  RPC_CHANNELS.skills.STOP_MANAGING,
  RPC_CHANNELS.skills.UPDATE_METADATA,
  RPC_CHANNELS.skills.PREVIEW_DIRECTORY,
  RPC_CHANNELS.skills.PREVIEW_NPX,
  RPC_CHANNELS.skills.INSTALL_DIRECTORY,
  RPC_CHANNELS.skills.INSTALL_NPX,
  RPC_CHANNELS.skills.REMOVE_MANAGED,
  RPC_CHANNELS.skills.RESTORE,
  RPC_CHANNELS.skills.LIST_OPERATIONS,
  RPC_CHANNELS.skills.REFRESH,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export interface SkillsHandlerRuntime {
  globalSkillsRoot: string
  scanInventory(roots: SkillInventoryRoots): SkillInventory
  annotateInventory(inventory: SkillInventory): SkillInventory
  adopt(placement: SkillPlacement, target: SkillTarget, origin?: SkillOrigin): SkillOperationRecord
  stopManaging(placement: SkillPlacement, target: SkillTarget): SkillOperationRecord
  updateMetadata(placement: SkillPlacement, target: SkillTarget, updates: { favorite?: boolean; tags?: string[] }): SkillOperationRecord
  previewDirectory(request: InstallSkillFromDirectoryRequest): SkillInstallPlan
  previewNpx(request: InstallSkillFromNpxRequest): Promise<SkillInstallPlan>
  installDirectory(request: InstallSkillFromDirectoryRequest): SkillOperationRecord
  installNpx(request: InstallSkillFromNpxRequest): Promise<SkillOperationRecord>
  remove(request: RemoveSkillRequest): SkillOperationRecord
  restore(operationId: string): SkillOperationRecord
  listOperations(): SkillOperationRecord[]
  invalidate(): void
  watchInventory?(
    roots: SkillInventoryRoots,
    onChange: () => void,
  ): { updateRoots(roots: SkillInventoryRoots): void; dispose(): void }
}

interface SkillsHandlerOptions {
  getWorkspace?: (workspaceId: string) => { rootPath: string; remoteServer?: unknown } | null | undefined
  runtime?: SkillsHandlerRuntime
}

function createDefaultRuntime(): SkillsHandlerRuntime {
  const dataRoot = join(CONFIG_DIR, 'skill-manager')
  const catalog = new SkillCatalogStore(dataRoot)
  const operations = new SkillOperationService(dataRoot, catalog)
  return {
    globalSkillsRoot: GLOBAL_AGENT_SKILLS_DIR,
    scanInventory: scanSkillInventory,
    annotateInventory: inventory => catalog.annotate(inventory),
    adopt: (placement, target, origin) => operations.adopt(placement, target, origin),
    stopManaging: (placement, target) => operations.stopManaging(placement, target),
    updateMetadata: (placement, target, updates) => operations.updateMetadata(placement, target, updates),
    previewDirectory: request => operations.previewFromDirectory(request),
    previewNpx: request => operations.previewFromNpx(request),
    installDirectory: request => operations.installFromDirectory(request),
    installNpx: request => operations.installFromNpx(request),
    remove: request => operations.remove(request),
    restore: operationId => operations.restore(operationId),
    listOperations: () => operations.listOperations(),
    invalidate: invalidateSkillsCache,
    watchInventory: (roots, onChange) => new SkillInventoryWatcher(roots, onChange),
  }
}

export function registerSkillsHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  options: SkillsHandlerOptions = {},
): void {
  const getWorkspace = options.getWorkspace ?? getWorkspaceByNameOrId
  const runtime = options.runtime ?? createDefaultRuntime()
  const watchers = new Map<string, {
    signature: string
    watcher: { updateRoots(roots: SkillInventoryRoots): void; dispose(): void }
  }>()

  function resolveWorkspace(workspaceId: string) {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return workspace
  }

  function resolveWorkingDirectory(workingDirectory?: string): string | undefined {
    if (!workingDirectory) return undefined
    if (!existsSync(workingDirectory) || !statSync(workingDirectory).isDirectory()) {
      throw new Error(`Project directory does not exist on this server: ${workingDirectory}`)
    }
    return workingDirectory
  }

  function rootsFor(workspaceRoot: string, workingDirectory?: string): SkillInventoryRoots {
    return {
      globalSkillsRoot: runtime.globalSkillsRoot,
      workspaceRoot,
      projectRoot: resolveWorkingDirectory(workingDirectory),
    }
  }

  function inventoryFor(workspaceRoot: string, workingDirectory?: string): SkillInventory {
    return runtime.annotateInventory(runtime.scanInventory(rootsFor(workspaceRoot, workingDirectory)))
  }

  function ensureWatcher(workspaceId: string, workspaceRoot: string, workingDirectory?: string): void {
    if (!runtime.watchInventory) return
    const roots = rootsFor(workspaceRoot, workingDirectory)
    const signature = JSON.stringify(roots)
    const existing = watchers.get(workspaceId)
    if (existing?.signature === signature) return
    if (existing) {
      existing.watcher.updateRoots(roots)
      existing.signature = signature
      return
    }
    const watcher = runtime.watchInventory(roots, () => {
      try {
        broadcastInventory(workspaceId, workspaceRoot, workingDirectory)
      } catch (error) {
        deps.platform.logger?.error(`SKILLS_WATCH: Failed to refresh ${workspaceId}`, error)
      }
    })
    watchers.set(workspaceId, { signature, watcher })
  }

  function resolveTarget(
    target: SkillRpcTarget,
    workspaceRoot: string,
    workingDirectory?: string,
  ): SkillTarget {
    if (target.source === 'global') {
      return { source: 'global', globalSkillsRoot: runtime.globalSkillsRoot }
    }
    if (target.source === 'workspace') return { source: 'workspace', workspaceRoot }
    const projectRoot = resolveWorkingDirectory(workingDirectory)
    if (!projectRoot) throw new Error('Project directory is required for a project Skill')
    return { source: 'project', projectRoot }
  }

  function targetForPlacement(
    placement: SkillPlacement,
    workspaceRoot: string,
    workingDirectory?: string,
  ): SkillTarget {
    return resolveTarget({ source: placement.source }, workspaceRoot, workingDirectory)
  }

  function operationInScope(operation: SkillOperationRecord, workspaceRoot: string, workingDirectory?: string): boolean {
    if (operation.target.source === 'global') return true
    if (operation.target.source === 'workspace') return operation.target.workspaceRoot === workspaceRoot
    return !!workingDirectory && operation.target.projectRoot === workingDirectory
  }

  function broadcastInventory(workspaceId: string, workspaceRoot: string, workingDirectory?: string): SkillInventory {
    ensureWatcher(workspaceId, workspaceRoot, workingDirectory)
    runtime.invalidate()
    const inventory = inventoryFor(workspaceRoot, workingDirectory)
    const target = { to: 'workspace' as const, workspaceId }
    server.push(RPC_CHANNELS.skills.INVENTORY_CHANGED, target, workspaceId, inventory)
    server.push(RPC_CHANNELS.skills.CHANGED, target, workspaceId, inventory.effectiveSkills)
    return inventory
  }

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET: Workspace not found: ${workspaceId}`)
      return []
    }
    // Validate workingDirectory exists on this server — a thin client may pass
    // its local path which doesn't exist on the remote server's filesystem.
    const effectiveWorkingDir = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const skills = loadAllSkills(workspace.rootPath, effectiveWorkingDir)
    deps.platform.logger?.info(`SKILLS_GET: Loaded ${skills.length} skills from ${workspace.rootPath}`)
    return skills
  })

  server.handle(RPC_CHANNELS.skills.GET_INVENTORY, (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = resolveWorkspace(workspaceId)
    ensureWatcher(workspaceId, workspace.rootPath, workingDirectory)
    return inventoryFor(workspace.rootPath, workingDirectory)
  })

  server.handle(RPC_CHANNELS.skills.ADOPT, (_ctx, workspaceId: string, request: SkillAdoptRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    const inventory = inventoryFor(workspace.rootPath, request.workingDirectory)
    const placement = inventory.placements.find(item => item.id === request.placementId)
    if (!placement) throw new Error(`Skill placement not found: ${request.placementId}`)
    const operation = runtime.adopt(
      placement,
      targetForPlacement(placement, workspace.rootPath, request.workingDirectory),
      request.origin,
    )
    broadcastInventory(workspaceId, workspace.rootPath, request.workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.STOP_MANAGING, (_ctx, workspaceId: string, recordId: string, workingDirectory?: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const placement = inventoryFor(workspace.rootPath, workingDirectory).placements
      .find(item => item.recordId === recordId)
    if (!placement) throw new Error(`Managed Skill not found: ${recordId}`)
    runtime.stopManaging(placement, targetForPlacement(placement, workspace.rootPath, workingDirectory))
    broadcastInventory(workspaceId, workspace.rootPath, workingDirectory)
  })

  server.handle(RPC_CHANNELS.skills.UPDATE_METADATA, (_ctx, workspaceId: string, request: SkillMetadataUpdateRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    const placement = inventoryFor(workspace.rootPath, request.workingDirectory).placements
      .find(item => item.id === request.placementId && item.ownership === 'managed')
    if (!placement) throw new Error(`Managed Skill placement not found: ${request.placementId}`)
    const operation = runtime.updateMetadata(
      placement,
      targetForPlacement(placement, workspace.rootPath, request.workingDirectory),
      { favorite: request.favorite, tags: request.tags },
    )
    broadcastInventory(workspaceId, workspace.rootPath, request.workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.PREVIEW_DIRECTORY, (_ctx, workspaceId: string, request: SkillInstallDirectoryRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    return runtime.previewDirectory({
      sourceDirectory: request.sourceDirectory,
      slug: request.slug,
      target: resolveTarget(request.target, workspace.rootPath, request.workingDirectory),
      origin: request.origin ?? { type: 'local', path: request.sourceDirectory },
      overwrite: request.overwrite,
    })
  })

  server.handle(RPC_CHANNELS.skills.INSTALL_DIRECTORY, (_ctx, workspaceId: string, request: SkillInstallDirectoryRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    const operation = runtime.installDirectory({
      sourceDirectory: request.sourceDirectory,
      slug: request.slug,
      target: resolveTarget(request.target, workspace.rootPath, request.workingDirectory),
      origin: request.origin ?? { type: 'local', path: request.sourceDirectory },
      overwrite: request.overwrite,
    })
    broadcastInventory(workspaceId, workspace.rootPath, request.workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.PREVIEW_NPX, async (_ctx, workspaceId: string, request: SkillInstallNpxRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    return runtime.previewNpx({
      source: request.source,
      slug: request.slug,
      target: resolveTarget(request.target, workspace.rootPath, request.workingDirectory),
      overwrite: request.overwrite,
    })
  })

  server.handle(RPC_CHANNELS.skills.INSTALL_NPX, async (_ctx, workspaceId: string, request: SkillInstallNpxRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    const operation = await runtime.installNpx({
      source: request.source,
      slug: request.slug,
      target: resolveTarget(request.target, workspace.rootPath, request.workingDirectory),
      overwrite: request.overwrite,
    })
    broadcastInventory(workspaceId, workspace.rootPath, request.workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.REMOVE_MANAGED, (_ctx, workspaceId: string, request: SkillRemoveManagedRequest) => {
    const workspace = resolveWorkspace(workspaceId)
    const inventory = inventoryFor(workspace.rootPath, request.workingDirectory)
    const placement = inventory.placements.find(item => item.id === request.placementId)
    if (!placement || placement.ownership !== 'managed') {
      throw new Error(`Managed Skill placement not found: ${request.placementId}`)
    }
    const operation = runtime.remove({
      slug: placement.slug,
      target: targetForPlacement(placement, workspace.rootPath, request.workingDirectory),
    })
    broadcastInventory(workspaceId, workspace.rootPath, request.workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.RESTORE, (_ctx, workspaceId: string, operationId: string, workingDirectory?: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const original = runtime.listOperations().find(operation => operation.id === operationId)
    if (!original || !operationInScope(original, workspace.rootPath, workingDirectory)) {
      throw new Error(`Restorable Skill operation not found in this workspace: ${operationId}`)
    }
    const operation = runtime.restore(operationId)
    broadcastInventory(workspaceId, workspace.rootPath, workingDirectory)
    return operation
  })

  server.handle(RPC_CHANNELS.skills.LIST_OPERATIONS, (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return runtime.listOperations().filter(operation => operationInScope(operation, workspace.rootPath, workingDirectory))
  })

  server.handle(RPC_CHANNELS.skills.REFRESH, (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = resolveWorkspace(workspaceId)
    return broadcastInventory(workspaceId, workspace.rootPath, workingDirectory)
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) {
      deps.platform.logger?.error(`SKILLS_GET_FILES: Workspace not found: ${workspaceId}`)
      return []
    }

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)

    function scanDirectory(dirPath: string): SkillFile[] {
      try {
        const entries = readdirSync(dirPath, { withFileTypes: true })
        return entries
          .filter(entry => !entry.name.startsWith('.')) // Skip hidden files
          .map(entry => {
            const fullPath = join(dirPath, entry.name)
            if (entry.isDirectory()) {
              return {
                name: entry.name,
                type: 'directory' as const,
                children: scanDirectory(fullPath),
              }
            } else {
              const stats = statSync(fullPath)
              return {
                name: entry.name,
                type: 'file' as const,
                size: stats.size,
              }
            }
          })
          .sort((a, b) => {
            // Directories first, then files
            if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
            return a.name.localeCompare(b.name)
          })
      } catch (err) {
        deps.platform.logger?.error(`SKILLS_GET_FILES: Error scanning ${dirPath}:`, err)
        return []
      }
    }

    return scanDirectory(skillDir)
  })

  // Legacy delete entry point. Keep it recoverable by routing through the
  // operation service instead of permanently deleting the directory.
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = resolveWorkspace(workspaceId)
    runtime.remove({
      slug: skillSlug,
      target: { source: 'workspace', workspaceRoot: workspace.rootPath },
    })
    broadcastInventory(workspaceId, workspace.rootPath)
    deps.platform.logger?.info(`Safely removed skill: ${skillSlug}`)
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspace(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })
}
