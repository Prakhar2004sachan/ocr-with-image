import { describe, expect, it } from 'vitest'
import { supportsFigureExports, versionAtLeast } from './version'

describe('versionAtLeast', () => {
  it('compares dotted versions', () => {
    expect(versionAtLeast('1.1.0', '1.1.0')).toBe(true)
    expect(versionAtLeast('1.2.0', '1.1.0')).toBe(true)
    expect(versionAtLeast('2.0.0', '1.9.9')).toBe(true)
    expect(versionAtLeast('1.0.0', '1.1.0')).toBe(false)
    expect(versionAtLeast('1.10.0', '1.9.0')).toBe(true)
  })

  it('handles prefixes, suffixes and missing values', () => {
    expect(versionAtLeast('v1.1.0', '1.1.0')).toBe(true)
    expect(versionAtLeast('1.1.0-beta.2', '1.1.0')).toBe(true)
    expect(versionAtLeast(undefined, '1.1.0')).toBe(false)
    expect(versionAtLeast('', '0.0.1')).toBe(false)
  })

  it('detects figure export support', () => {
    expect(supportsFigureExports('1.1.0')).toBe(true)
    expect(supportsFigureExports('1.0.0')).toBe(false)
    expect(supportsFigureExports(undefined)).toBe(false)
  })
})
