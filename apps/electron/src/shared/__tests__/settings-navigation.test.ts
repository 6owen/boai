import { describe, expect, test } from 'bun:test'

import { SETTINGS_ITEMS } from '../menu-schema'
import { isValidSettingsSubpage } from '../settings-registry'

describe('settings navigation', () => {
  test('does not expose workspace management or remote server settings', () => {
    expect(SETTINGS_ITEMS.map((item) => item.id)).not.toContain('workspace')
    expect(SETTINGS_ITEMS.map((item) => item.id)).not.toContain('server')
  })

  test('keeps hidden settings routes valid for backwards compatibility', () => {
    expect(isValidSettingsSubpage('workspace')).toBe(true)
    expect(isValidSettingsSubpage('server')).toBe(true)
  })
})
