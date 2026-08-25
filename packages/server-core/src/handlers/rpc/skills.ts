import { join, resolve } from 'path'
import { existsSync, readdirSync, statSync } from 'fs'
import { RPC_CHANNELS, type SkillFile } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import type {
  DeleteSkillRequest,
  InstallSkillRequest,
  ManageSkillRequest,
  ScanSkillSourceRequest,
  SkillUsageRange,
} from '@craft-agent/shared/skills'
import type { ExportOwnSkillLibraryRequest } from '@craft-agent/shared/personal-repository'

const SKILLS_UPDATE_ALL_TIMEOUT_MS = 10 * 60_000
import {
  annotateManagedSkills,
  loadAllSkills,
  SkillsCliService,
} from '@craft-agent/shared/skills'
import type { RpcServer } from '@craft-agent/server-core/transport'
import { computeSkillUsageStats } from '@craft-agent/server-core/services/skill-usage-stats'
import type { HandlerDeps } from '../handler-deps'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.skills.GET,
  RPC_CHANNELS.skills.GET_FILES,
  RPC_CHANNELS.skills.GET_USAGE_STATS,
  RPC_CHANNELS.skills.SCAN_SOURCE,
  RPC_CHANNELS.skills.INSTALL,
  RPC_CHANNELS.skills.CHECK_UPDATES,
  RPC_CHANNELS.skills.UPDATE,
  RPC_CHANNELS.skills.UPDATE_ALL_GLOBAL,
  RPC_CHANNELS.skills.UNINSTALL,
  RPC_CHANNELS.skills.DELETE,
  RPC_CHANNELS.skills.EXPORT_LIBRARY,
  RPC_CHANNELS.skills.OPEN_EDITOR,
  RPC_CHANNELS.skills.OPEN_FINDER,
] as const

export function registerSkillsHandlers(
  server: RpcServer,
  deps: HandlerDeps,
  skillsCli = new SkillsCliService(),
): void {
  const resolveProjectRoot = (workingDirectory?: string): string | undefined => {
    if (!workingDirectory) return undefined
    if (!existsSync(workingDirectory) || !statSync(workingDirectory).isDirectory()) {
      throw new Error('The selected project directory is not available')
    }

    const requestedRoot = resolve(workingDirectory)
    return requestedRoot
  }

  const refreshAndBroadcastSkills = async (
    workspaceId: string,
    workspaceRoot: string,
    projectRoot?: string,
  ): Promise<void> => {
    const { invalidateSkillsCache, loadAllSkills } = await import('@craft-agent/shared/skills')
    invalidateSkillsCache()
    const skills = annotateManagedSkills(loadAllSkills(workspaceRoot, projectRoot), projectRoot)
    server.push(RPC_CHANNELS.skills.CHANGED, { to: 'workspace', workspaceId }, workspaceId, skills)
  }

  // Get all skills for a workspace (and optionally project-level skills from workingDirectory)
  server.handle(RPC_CHANNELS.skills.GET, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    deps.platform.logger?.info(`SKILLS_GET: Loading skills for workspace: ${workspaceId}${workingDirectory ? `, workingDirectory: ${workingDirectory}` : ''}`)
    const workspace = getWorkspaceByNameOrId(workspaceId)
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
    return annotateManagedSkills(skills, effectiveWorkingDir)
  })

  // Get files in a skill directory
  server.handle(RPC_CHANNELS.skills.GET_FILES, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
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

  // Combine native BoAI activations with best-effort local Agent histories.
  server.handle(RPC_CHANNELS.skills.GET_USAGE_STATS, async (
    _ctx,
    workspaceId: string,
    range: SkillUsageRange,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (range !== '7d' && range !== '30d' && range !== 'all') {
      throw new Error('Invalid Skill usage range')
    }

    if (deps.platform.getSkillUsageStats) {
      return deps.platform.getSkillUsageStats(workspace.rootPath, range)
    }
    return computeSkillUsageStats(workspace.rootPath, range)
  })

  // Discover every valid SKILL.md before the user chooses what to install.
  server.handle(RPC_CHANNELS.skills.SCAN_SOURCE, async (_ctx, workspaceId: string, request: ScanSkillSourceRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    return skillsCli.scan(request, workspace.rootPath)
  })

  // Install a global skill or install into an explicitly selected project directory.
  server.handle(RPC_CHANNELS.skills.INSTALL, async (_ctx, workspaceId: string, request: InstallSkillRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const viewProjectRoot = resolveProjectRoot(request.workingDirectory)
    const projectRoot = request.scope === 'project' ? viewProjectRoot : undefined
    if (request.scope === 'project' && !projectRoot) {
      throw new Error('Select a project before installing a project skill')
    }

    const result = await skillsCli.install({
      source: request.source,
      slug: request.slug,
      scope: request.scope,
      projectRoot,
      cwd: projectRoot ?? workspace.rootPath,
    })

    await refreshAndBroadcastSkills(workspaceId, workspace.rootPath, viewProjectRoot)
    deps.platform.logger?.info(`Installed ${request.scope} skill: ${request.slug}`)
    return result
  })

  // Read-only update check. Omitting request checks every tracked global skill.
  server.handle(RPC_CHANNELS.skills.CHECK_UPDATES, async (_ctx, workspaceId: string, request?: ManageSkillRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    if (!request) {
      return skillsCli.checkUpdates({ scope: 'global' })
    }

    const viewProjectRoot = resolveProjectRoot(request.workingDirectory)
    const projectRoot = request.scope === 'project' ? viewProjectRoot : undefined
    if (request.scope === 'project' && !projectRoot) {
      throw new Error('Select a project before checking project skill updates')
    }

    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const currentSkills = annotateManagedSkills(
      loadAllSkills(workspace.rootPath, viewProjectRoot),
      viewProjectRoot,
    )
    const skill = currentSkills.find(item =>
      item.slug === request.slug
      && item.source === request.scope
      && item.management?.canUpdate,
    )
    if (!skill) throw new Error('This skill is not updateable through the skills CLI')

    return skillsCli.checkUpdates({
      scope: request.scope,
      slugs: [request.slug],
      projectRoot,
    })
  })

  // Update one skill only when its matching CLI lock file confirms provenance.
  server.handle(RPC_CHANNELS.skills.UPDATE, async (_ctx, workspaceId: string, request: ManageSkillRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const viewProjectRoot = resolveProjectRoot(request.workingDirectory)
    const projectRoot = request.scope === 'project' ? viewProjectRoot : undefined
    if (request.scope === 'project' && !projectRoot) {
      throw new Error('Select a project before updating a project skill')
    }

    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const currentSkills = annotateManagedSkills(
      loadAllSkills(workspace.rootPath, viewProjectRoot),
      viewProjectRoot,
    )
    const skill = currentSkills.find(item =>
      item.slug === request.slug
      && item.source === request.scope
      && item.management?.canUpdate,
    )
    if (!skill) throw new Error('This skill is not updateable through the skills CLI')

    const result = await skillsCli.update({
      slug: request.slug,
      scope: request.scope,
      projectRoot,
      cwd: projectRoot ?? workspace.rootPath,
    })

    await refreshAndBroadcastSkills(workspaceId, workspace.rootPath, viewProjectRoot)
    deps.platform.logger?.info(`Updated ${request.scope} skill: ${request.slug}`)
    return result
  })

  // Update every global skill tracked by the skills CLI, then refresh the current view.
  server.handle(RPC_CHANNELS.skills.UPDATE_ALL_GLOBAL, async (_ctx, workspaceId: string, workingDirectory?: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    // The active project is only needed to rebuild the current list after the
    // global operation. A stale or client-local path must not block the update.
    const viewProjectRoot = workingDirectory && existsSync(workingDirectory)
      ? workingDirectory
      : undefined
    const result = await skillsCli.updateAllGlobal(workspace.rootPath)

    await refreshAndBroadcastSkills(workspaceId, workspace.rootPath, viewProjectRoot)
    deps.platform.logger?.info('Updated all global skills')
    return result
  }, { timeoutMs: SKILLS_UPDATE_ALL_TIMEOUT_MS })

  // Uninstall only skills whose exact scope is tracked by the skills CLI.
  server.handle(RPC_CHANNELS.skills.UNINSTALL, async (_ctx, workspaceId: string, request: ManageSkillRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const viewProjectRoot = resolveProjectRoot(request.workingDirectory)
    const projectRoot = request.scope === 'project' ? viewProjectRoot : undefined
    if (request.scope === 'project' && !projectRoot) {
      throw new Error('Select a project before uninstalling a project skill')
    }

    const { loadAllSkills } = await import('@craft-agent/shared/skills')
    const currentSkills = annotateManagedSkills(
      loadAllSkills(workspace.rootPath, viewProjectRoot),
      viewProjectRoot,
    )
    const skill = currentSkills.find(item =>
      item.slug === request.slug
      && item.source === request.scope
      && item.management?.manager === 'skills-cli',
    )
    if (!skill) throw new Error('This skill is not managed by the skills CLI')

    const result = await skillsCli.uninstall({
      slug: request.slug,
      scope: request.scope,
      projectRoot,
      cwd: projectRoot ?? workspace.rootPath,
    })

    await refreshAndBroadcastSkills(workspaceId, workspace.rootPath, viewProjectRoot)
    deps.platform.logger?.info(`Uninstalled ${request.scope} skill: ${request.slug}`)
    return result
  })

  // Permanently delete one unmanaged skill from its exact loaded source.
  server.handle(RPC_CHANNELS.skills.DELETE, async (_ctx, workspaceId: string, request: DeleteSkillRequest) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')

    const projectRoot = resolveProjectRoot(request.workingDirectory)
    if (request.source === 'project' && !projectRoot) {
      throw new Error('Select a project before deleting a project skill')
    }

    const { deleteSkillBySource, loadAllSkills } = await import('@craft-agent/shared/skills')
    const skill = annotateManagedSkills(
      loadAllSkills(workspace.rootPath, projectRoot),
      projectRoot,
    ).find(item => item.slug === request.slug && item.source === request.source)
    if (!skill) throw new Error('Skill not found in the selected location')
    if (skill.management) throw new Error('Managed skills must be removed through uninstall')

    const deleted = deleteSkillBySource(
      workspace.rootPath,
      request.slug,
      request.source,
      projectRoot,
    )
    if (!deleted) throw new Error('Failed to delete skill')

    await refreshAndBroadcastSkills(workspaceId, workspace.rootPath, projectRoot)
    deps.platform.logger?.info(`Deleted ${request.source} skill: ${request.slug}`)
  })

  // Export the current Own collection as a portable, Git-friendly directory.
  server.handle(RPC_CHANNELS.skills.EXPORT_LIBRARY, async (
    _ctx,
    workspaceId: string,
    request: ExportOwnSkillLibraryRequest,
  ) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) {
      throw new Error('Exporting a local Skill Library is not available for remote workspaces')
    }

    const projectRoot = resolveProjectRoot(request.workingDirectory)
    const favoriteKeys = new Set(request.favoriteKeys)
    const excludedKeys = new Set(request.excludedKeys ?? [])
    const currentSkills = annotateManagedSkills(
      loadAllSkills(workspace.rootPath, projectRoot),
      projectRoot,
    )
    const ownSkills = currentSkills.filter(skill =>
      skill.source === 'workspace'
        ? !excludedKeys.has(`${skill.source}:${skill.slug}`)
        : favoriteKeys.has(`${skill.source}:${skill.slug}`))

    const { exportOwnSkillLibrary } = await import('@craft-agent/shared/personal-repository')
    const result = exportOwnSkillLibrary({
      targetDirectory: request.targetDirectory,
      libraryName: `${workspace.name} Skills`,
      skills: ownSkills,
    })
    deps.platform.logger?.info(
      `Exported Own Skill Library: ${result.localSkills.length} local, `
      + `${result.vendorSkills.length} vendor, ${result.sources.length} sources`,
    )
    return result
  })

  // Open skill SKILL.md in editor
  server.handle(RPC_CHANNELS.skills.OPEN_EDITOR, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Open in editor is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillFile = join(skillsDir, skillSlug, 'SKILL.md')
    await deps.platform.openPath?.(skillFile)
  })

  // Open skill folder in Finder/Explorer
  server.handle(RPC_CHANNELS.skills.OPEN_FINDER, async (_ctx, workspaceId: string, skillSlug: string) => {
    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) throw new Error('Workspace not found')
    if (workspace.remoteServer) throw new Error('Show in Finder is not available for remote workspaces')

    const { getWorkspaceSkillsPath } = await import('@craft-agent/shared/workspaces')

    const skillsDir = getWorkspaceSkillsPath(workspace.rootPath)
    const skillDir = join(skillsDir, skillSlug)
    await deps.platform.showItemInFolder?.(skillDir)
  })
}
