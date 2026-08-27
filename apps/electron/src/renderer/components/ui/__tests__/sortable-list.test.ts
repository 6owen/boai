import { describe, expect, it } from 'bun:test'
import {
  SmartKeyboardSensor,
  SortableDragOverlayPortal,
} from '../sortable-list'

function createKeyboardEvent(target: unknown, code = 'Space') {
  let defaultPrevented = false

  return {
    event: {
      target,
      nativeEvent: { code },
      preventDefault: () => {
        defaultPrevented = true
      },
    },
    wasDefaultPrevented: () => defaultPrevented,
  }
}

describe('SmartKeyboardSensor', () => {
  it('does not activate sorting for Space pressed in a data-no-dnd input', () => {
    const row = { dataset: {}, parentElement: null }
    const form = { dataset: { noDnd: 'true' }, parentElement: row }
    const input = { dataset: {}, parentElement: form }
    const { event, wasDefaultPrevented } = createKeyboardEvent(input)
    const activator = SmartKeyboardSensor.activators[0]

    const activated = activator.handler(
      event as never,
      {},
      { active: { activatorNode: { current: null } } } as never,
    )

    expect(activated).toBe(false)
    expect(wasDefaultPrevented()).toBe(false)
  })

  it('keeps keyboard sorting available from the sortable row itself', () => {
    const row = { dataset: {}, parentElement: null }
    const { event, wasDefaultPrevented } = createKeyboardEvent(row)
    const activator = SmartKeyboardSensor.activators[0]

    const activated = activator.handler(
      event as never,
      {},
      { active: { activatorNode: { current: null } } } as never,
    )

    expect(activated).toBe(true)
    expect(wasDefaultPrevented()).toBe(true)
  })
})

describe('SortableDragOverlayPortal', () => {
  it('renders the fixed drag overlay at the document body coordinate root', () => {
    const originalDocument = globalThis.document
    const body = { nodeType: 1 }
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { body },
    })

    try {
      const portal = SortableDragOverlayPortal({ children: 'overlay' })

      expect(portal).not.toBeNull()
      expect((portal as unknown as { containerInfo: unknown }).containerInfo).toBe(body)
    } finally {
      if (originalDocument) {
        Object.defineProperty(globalThis, 'document', {
          configurable: true,
          value: originalDocument,
        })
      } else {
        Reflect.deleteProperty(globalThis, 'document')
      }
    }
  })
})
