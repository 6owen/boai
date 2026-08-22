import { describe, expect, mock, test } from 'bun:test'
import type { RpcClient } from '@craft-agent/server-core/transport'
import { buildClientApi, type ChannelMap } from '../build-api'

describe('buildClientApi', () => {
  test('uses the channel-specific timeout for long-running requests', async () => {
    const invoke = mock(async () => 'default')
    const invokeWithTimeout = mock(async () => 'long')
    const client = {
      invoke,
      invokeWithTimeout,
      on: () => () => {},
      handleCapability: () => {},
    } as RpcClient
    const channelMap = {
      checkUpdates: { type: 'invoke', channel: 'skills:checkUpdates', timeoutMs: 180_000 },
    } satisfies ChannelMap

    const api = buildClientApi(client, channelMap) as any
    const result = await api.checkUpdates('workspace-id')

    expect(result).toBe('long')
    expect(invokeWithTimeout).toHaveBeenCalledWith(180_000, 'skills:checkUpdates', 'workspace-id')
    expect(invoke).not.toHaveBeenCalled()
  })
})
