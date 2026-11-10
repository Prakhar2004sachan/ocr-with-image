import { describe, expect, it } from 'vitest'
import {
  acceleratorName,
  deviceHint,
  deviceOptions,
  engineLabel,
  localPlatformLabel,
  pasteShortcut,
  platformKind,
  platformName,
  startCommand,
  stopCommand,
} from './platform'
import type { EngineFacts, Health } from './types'

const macSystem = { platform: 'Darwin', platform_label: 'macOS' }
const windowsSystem = { platform: 'Windows', platform_label: 'Windows' }
const linuxSystem = { platform: 'Linux', platform_label: 'Linux' }

function facts(overrides: Partial<EngineFacts> = {}): EngineFacts {
  return {
    active: 'llama_cpp',
    llama_cpp: { ready: true, binary: '/x', version: '1', status: 'ready', label: 'llama.cpp · Metal' },
    transformers: {
      weights: {
        ready: true,
        dir: '/models',
        files: [],
        missing: [],
        message: 'ready',
        download_command: null,
        shards: [],
      },
      device: 'auto',
      python: '3.12',
      torch: 'torch 2.0',
      mps_available: false,
      cuda_available: false,
    },
    ...overrides,
  }
}

describe('platform detection', () => {
  it('classifies backend platform labels', () => {
    expect(platformKind(macSystem)).toBe('mac')
    expect(platformKind(windowsSystem)).toBe('windows')
    expect(platformKind(linuxSystem)).toBe('linux')
    expect(platformKind({ platform: 'FreeBSD', platform_label: '' })).toBe('other')
    expect(platformKind(null)).toBe('other')
  })

  it('returns friendly names', () => {
    expect(platformName(macSystem)).toBe('macOS')
    expect(platformName(windowsSystem)).toBe('Windows')
    expect(platformName(linuxSystem)).toBe('Linux')
    expect(platformName({ platform: 'FreeBSD', platform_label: 'FreeBSD' })).toBe('FreeBSD')
  })

  it('uses the backend accelerator and a safe fallback', () => {
    expect(
      acceleratorName({ system: { ...macSystem, accelerator: 'Metal' } } as unknown as Health),
    ).toBe('Metal')
    expect(acceleratorName({ system: macSystem } as unknown as Health)).toBe('Metal')
    expect(acceleratorName({ system: windowsSystem } as unknown as Health)).toBe('GPU')
  })

  it('prefers the backend engine label', () => {
    expect(
      engineLabel({
        system: { ...macSystem, engine_label: 'llama.cpp · CUDA' },
        engine: { backend: 'fallback' },
      } as unknown as Health),
    ).toBe('llama.cpp · CUDA')
    expect(
      engineLabel({ system: macSystem, engine: { backend: 'llama.cpp' } } as unknown as Health),
    ).toBe('llama.cpp')
  })

  it('uses the right paste and launcher commands', () => {
    expect(pasteShortcut(macSystem)).toBe('⌘V')
    expect(pasteShortcut(windowsSystem)).toBe('Ctrl+V')
    expect(startCommand(macSystem)).toBe('python3 scripts/start.py')
    expect(startCommand(windowsSystem)).toBe('scripts\\start.cmd')
    expect(stopCommand(linuxSystem)).toBe('python3 scripts/stop.py')
  })

  it('detects the local browser platform', () => {
    expect(['macOS', 'Windows', 'Linux', 'this device']).toContain(localPlatformLabel())
  })
})

describe('device options', () => {
  it('never offers an unavailable accelerator', () => {
    expect(deviceOptions(facts()).map((option) => option.value)).toEqual(['auto', 'cpu'])
    const cuda = facts()
    cuda.transformers.cuda_available = true
    expect(deviceOptions(cuda).map((option) => option.value)).toEqual(['auto', 'cuda', 'cpu'])
    const mps = facts()
    mps.transformers.mps_available = true
    expect(deviceOptions(mps).map((option) => option.value)).toEqual(['auto', 'mps', 'cpu'])
  })

  it('keeps a saved but unsupported preference visible', () => {
    const options = deviceOptions(facts(), 'cuda')
    expect(options.map((option) => option.value)).toEqual(['auto', 'cuda', 'cpu'])
  })

  it('describes the selected device', () => {
    expect(deviceHint('cpu')).toContain('every machine')
    expect(deviceHint('cuda')).toContain('CUDA')
    expect(deviceHint('mps')).toContain('Metal')
    expect(deviceHint('auto')).toContain('CPU')
  })
})
