import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import approved from '../fixtures/theme/approved-computed-styles.json'

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8')
const fixture = read('tests/visual/theme-fixture.html')
const runner = read('tests/visual/theme-screenshot-runner.cjs')

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

  it('injects the production token and recipe owners into the Electron fixture', () => {
    expect(runner).toContain("src/styles/theme/tokens.css")
    expect(runner).toContain("src/styles/theme/recipes.css")
    expect(runner).toMatch(/insertCSS\(productionCss\)/)
    expect(fixture).not.toMatch(/--(?:canvas|panel|sidebar|elevated|hover|active|accent-soft):/)
  })

  it('renders representative production recipe selectors and semantic states', () => {
    for (const selector of [
      'sto-card',
      'sto-control',
      'sto-navigation-item',
      'sto-segment-item',
      'sto-overlay',
      'sto-feedback',
    ]) {
      expect(fixture).toContain(selector)
    }
    expect(fixture).toContain('aria-disabled="true"')
    expect(fixture).toContain('aria-busy="true"')
    expect(fixture).toContain('aria-invalid="true"')
  })
})
