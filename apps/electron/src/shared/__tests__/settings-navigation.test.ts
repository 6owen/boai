import { describe, expect, test } from 'bun:test'

import { SETTINGS_ITEMS } from '../menu-schema'
import { isValidSettingsSubpage } from '../settings-registry'

describe('settings navigation', () => {
  test('does not expose settings pages hidden from normal navigation', () => {
    expect(SETTINGS_ITEMS.map((item) => item.id)).not.toContain('workspace')
    expect(SETTINGS_ITEMS.map((item) => item.id)).not.toContain('server')
    expect(SETTINGS_ITEMS.map((item) => item.id)).not.toContain('labels')
  })

  test('keeps hidden settings routes valid for backwards compatibility', () => {
    expect(isValidSettingsSubpage('workspace')).toBe(true)
    expect(isValidSettingsSubpage('server')).toBe(true)
    expect(isValidSettingsSubpage('labels')).toBe(true)
  })
})
