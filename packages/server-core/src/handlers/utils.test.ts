import { describe, expect, it } from 'bun:test'
import { resolveBackendRuntimePaths } from '../../../shared/src/agent/backend/internal/runtime-resolver'
import type { PlatformServices } from '../runtime/platform'
import { buildBackendHostRuntimeContext } from './utils'

describe('buildBackendHostRuntimeContext', () => {
  it('preserves Electron Node mode for packaged subprocesses', () => {
    const platform = {
      appRootPath: '/Applications/BoAI.app/Contents/Resources/app',
      resourcesPath: '/Applications/BoAI.app/Contents/Resources',
      isPackaged: true,
      isElectron: true,
    } as PlatformServices

    const context = buildBackendHostRuntimeContext(platform)

    expect(context).toEqual({
      appRootPath: platform.appRootPath,
      resourcesPath: platform.resourcesPath,
      isPackaged: true,
      isElectron: true,
    })
    expect(resolveBackendRuntimePaths(context).useElectronNode).toBe(true)
  })
})
