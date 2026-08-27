import { describe, expect, it } from 'bun:test'
import { createEntityRowInteractionHandlers } from '../entity-panel-interactions'

function mouseEvent(overrides: Partial<{
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
}> = {}) {
  return {
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  }
}

describe('createEntityRowInteractionHandlers', () => {
  it('does not select or activate a deferred row before a drag starts', () => {
    const calls: string[] = []
    const handlers = createEntityRowInteractionHandlers({
      deferUntilClick: true,
      onSelection: () => calls.push('select'),
      onActivate: () => calls.push('activate'),
    })

    handlers.onMouseDown?.(mouseEvent() as never)

    expect(calls).toEqual([])
  })

  it('selects and activates a deferred row on a completed click', () => {
    const calls: string[] = []
    const handlers = createEntityRowInteractionHandlers({
      deferUntilClick: true,
      onSelection: () => calls.push('select'),
      onActivate: () => calls.push('activate'),
    })

    handlers.onMouseDown?.(mouseEvent() as never)
    handlers.onClick?.(mouseEvent() as never)

    expect(calls).toEqual(['select', 'activate'])
  })

  it('preserves immediate activation for non-draggable lists', () => {
    const calls: string[] = []
    const handlers = createEntityRowInteractionHandlers({
      deferUntilClick: false,
      onSelection: () => calls.push('select'),
      onActivate: () => calls.push('activate'),
    })

    handlers.onMouseDown?.(mouseEvent() as never)

    expect(calls).toEqual(['select', 'activate'])
  })

  it('keeps modifier-click selection without opening the item', () => {
    const calls: string[] = []
    const handlers = createEntityRowInteractionHandlers({
      deferUntilClick: true,
      onSelection: () => calls.push('select'),
      onActivate: () => calls.push('activate'),
    })

    handlers.onClick?.(mouseEvent({ metaKey: true }) as never)

    expect(calls).toEqual(['select'])
  })

  it('keeps right-click selection on mouse down for the context menu', () => {
    const calls: string[] = []
    const handlers = createEntityRowInteractionHandlers({
      deferUntilClick: true,
      onSelection: () => calls.push('select'),
      onActivate: () => calls.push('activate'),
    })

    handlers.onMouseDown?.(mouseEvent({ button: 2 }) as never)

    expect(calls).toEqual(['select'])
  })
})
