import { describe, expect, it } from 'bun:test'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { HANDLED_CHANNELS } from './projects'

describe('legacy project RPC surface', () => {
  it('registers only read operations', () => {
    expect([...HANDLED_CHANNELS]).toEqual([
      RPC_CHANNELS.projects.GET,
      RPC_CHANNELS.projects.GET_ONE,
      RPC_CHANNELS.projects.LIST_ASSETS,
    ])

    expect(HANDLED_CHANNELS).not.toContain(RPC_CHANNELS.projects.CREATE)
    expect(HANDLED_CHANNELS).not.toContain(RPC_CHANNELS.projects.UPDATE)
    expect(HANDLED_CHANNELS).not.toContain(RPC_CHANNELS.projects.DELETE)
    expect(HANDLED_CHANNELS).not.toContain(RPC_CHANNELS.projects.UPLOAD_ASSET)
    expect(HANDLED_CHANNELS).not.toContain(RPC_CHANNELS.projects.DELETE_ASSET)
  })
})
