import { describe, expect, it } from 'vitest'
import approved from '../fixtures/theme/approved-computed-styles.json'

const requiredRoles = [
  'canvas',
  'panel',
  'sidebar',
  'elevated',
  'textPrimary',
  'textSecondary',
  'textTertiary',
  'border',
  'borderStrong',
] as const

describe('approved theme baseline', () => {
  it.each(['light', 'dark'] as const)('defines every semantic role for %s', theme => {
    expect(Object.keys(approved[theme])).toEqual(expect.arrayContaining(requiredRoles))
  })
})
