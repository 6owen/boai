import { describe, expect, it } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import type {
  SkillInventory,
  SkillOperationRecord,
} from '@craft-agent/shared/skills'
import type { HandlerFn, RpcServer } from '../../transport/types'
import type { HandlerDeps } from '../handler-deps'
import { registerSkillsHandlers, type SkillsHandlerRuntime } from './skills'

function validSkill(root: string, slug: string): string {
  const directory = join(root, slug)
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'SKILL.md'), `---\nname: ${slug}\ndescription: test\n---\nBody\n`)
  return directory
}

function createHarness() {
  const root = mkdtempSync(join(tmpdir(), 'skills-rpc-'))
  const workspaceRoot = join(root, 'workspace')
  const projectRoot = join(root, 'project')
  const sourceDirectory = validSkill(join(root, 'fixtures'), 'demo')
  mkdirSync(workspaceRoot, { recursive: true })
  mkdirSync(projectRoot, { recursive: true })

  const inventory: SkillInventory = {
    placements: [{
      id: `workspace:${join(workspaceRoot, 'skills', 'demo')}`,
      slug: 'demo',
      source: 'workspace',
      path: join(workspaceRoot, 'skills', 'demo'),
      status: 'valid',
      diagnostics: [],
      effective: true,
      shadowed: false,
      conflict: false,
      ownership: 'external',
      contentHash: 'hash',
      skill: {
        slug: 'demo',
        source: 'workspace',
        path: join(workspaceRoot, 'skills', 'demo'),
        metadata: { name: 'Demo', description: 'test' },
        content: 'Body',
      },
    }],
    effectiveSkills: [],
    scannedAt: 1,
  }
  inventory.effectiveSkills = [inventory.placements[0]!.skill!]

  const handlers = new Map<string, HandlerFn>()
  const pushes: Array<{ channel: string; args: unknown[] }> = []
  const server: RpcServer = {
    handle: (channel, handler) => { handlers.set(channel, handler) },
    push: (channel, _target, ...args) => { pushes.push({ channel, args }) },
    invokeClient: async () => undefined,
    hasClientCapability: () => false,
    findClientsWithCapability: () => [],
  }
  const operation: SkillOperationRecord = {
    id: 'op-1', type: 'install', status: 'succeeded', slug: 'demo',
    target: { source: 'workspace', workspaceRoot },
    targetPath: join(workspaceRoot, 'skills', 'demo'),
    startedAt: 1, completedAt: 2, hadTarget: false,
  }
  const calls: string[] = []
  const runtime: SkillsHandlerRuntime = {
    globalSkillsRoot: join(root, 'global'),
    scanInventory: () => inventory,
    annotateInventory: value => value,
    adopt: () => operation,
    stopManaging: () => { calls.push('stopManaging'); return operation },
    updateMetadata: () => operation,
    previewDirectory: () => ({
      slug: 'demo', target: { source: 'workspace', workspaceRoot },
      targetPath: operation.targetPath, operationType: 'install', valid: true, diagnostics: [],
    }),
    previewNpx: async () => ({
      slug: 'demo', target: { source: 'workspace', workspaceRoot },
      targetPath: operation.targetPath, operationType: 'install', valid: true, diagnostics: [],
    }),
    installDirectory: request => { calls.push(`install:${request.target.source}`); return operation },
    installNpx: async request => { calls.push(`npx:${request.source}`); return operation },
    remove: request => { calls.push(`remove:${request.target.source}`); return operation },
    restore: () => operation,
    listOperations: () => [operation],
    invalidate: () => { calls.push('invalidate') },
  }
  const deps = {
    sessionManager: {}, oauthFlowStore: {},
    platform: { appRootPath: root, resourcesPath: root, isPackaged: false, appVersion: 'test', isDebugMode: true },
  } as HandlerDeps
  registerSkillsHandlers(server, deps, {
    getWorkspace: id => id === 'ws' ? { rootPath: workspaceRoot } : undefined,
    runtime,
  })
  return { handlers, pushes, calls, inventory, runtime, workspaceRoot, projectRoot, sourceDirectory }
}

describe('Skills Manager RPC', () => {
  it('returns every annotated placement instead of only effective skills', async () => {
    const { handlers, inventory } = createHarness()
    const result = await handlers.get(RPC_CHANNELS.skills.GET_INVENTORY)!({} as never, 'ws')
    expect(result).toEqual(inventory)
    expect(result.placements).toHaveLength(1)
  })

  it('resolves renderer targets on the server and broadcasts after a mutation', async () => {
    const { handlers, calls, pushes, sourceDirectory, workspaceRoot } = createHarness()
    await handlers.get(RPC_CHANNELS.skills.INSTALL_DIRECTORY)!({} as never, 'ws', {
      sourceDirectory,
      slug: 'demo',
      target: { source: 'workspace' },
    })
    expect(calls).toContain('install:workspace')
    expect(calls).toContain('invalidate')
    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.skills.INVENTORY_CHANGED,
      args: ['ws', expect.any(Object)],
    })
    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.skills.CHANGED,
      args: ['ws', expect.any(Array)],
    })
    expect(workspaceRoot).not.toBe(sourceDirectory)
  })

  it('only permits project writes when the project directory is the active server path', async () => {
    const { handlers, projectRoot, sourceDirectory, calls } = createHarness()
    await handlers.get(RPC_CHANNELS.skills.INSTALL_DIRECTORY)!({} as never, 'ws', {
      sourceDirectory,
      slug: 'demo',
      target: { source: 'project' },
      workingDirectory: projectRoot,
    })
    expect(calls).toContain('install:project')

    expect(() => handlers.get(RPC_CHANNELS.skills.INSTALL_DIRECTORY)!({} as never, 'ws', {
      sourceDirectory,
      slug: 'demo',
      target: { source: 'project' },
      workingDirectory: join(projectRoot, 'missing'),
    })).toThrow('Project directory')
  })

  it('adopts only a placement returned by the server inventory', async () => {
    const { handlers } = createHarness()
    expect(() => handlers.get(RPC_CHANNELS.skills.ADOPT)!({} as never, 'ws', {
      placementId: 'global:/untrusted/path',
    })).toThrow('Skill placement not found')
  })

  it('does not restore an operation owned by a different workspace', () => {
    const { handlers, runtime } = createHarness()
    const original = runtime.listOperations()[0]!
    runtime.listOperations = () => [{
      ...original,
      target: { source: 'workspace', workspaceRoot: '/another/workspace' },
    }]
    expect(() => handlers.get(RPC_CHANNELS.skills.RESTORE)!({} as never, 'ws', 'op-1'))
      .toThrow('not found in this workspace')
  })

  it('routes the legacy delete entry point through recoverable removal', async () => {
    const { handlers, calls, pushes } = createHarness()
    await handlers.get(RPC_CHANNELS.skills.DELETE)!({} as never, 'ws', 'demo')

    expect(calls).toContain('remove:workspace')
    expect(pushes).toContainEqual({
      channel: RPC_CHANNELS.skills.INVENTORY_CHANGED,
      args: ['ws', expect.any(Object)],
    })
  })
})
