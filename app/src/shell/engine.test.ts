import { describe, expect, it, vi } from 'vitest'
import { audioUrl } from './engine'
import type { Track } from './library'
import { setSetting } from './settings/store'

describe('audioUrl', () => {
  it('asks for low data only for songs streamed from the PC', () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
    setSetting('lowdata', true)
    try {
      expect(audioUrl({ path: 'D:/Music/a.flac' } as Track)).not.toContain('lowdata')
      expect(audioUrl({ path: 'pc:abc' } as Track)).toContain('&lowdata=1')
    } finally {
      setSetting('lowdata', false)
      vi.unstubAllGlobals()
    }
  })
})

describe('Auto Low Data and the link check (§115 E)', () => {
  it('a passed check turns Auto off; a weak one leaves it on', async () => {
    const { isAdaptiveLowDataActive, linkCheckPasses, noteLinkCheck, setAdaptiveLowData } = await import('./engine')
    expect(linkCheckPasses(8, 149)).toBe(true)
    expect(linkCheckPasses(7.9, 20)).toBe(false)
    expect(linkCheckPasses(50, 200)).toBe(false)
    setAdaptiveLowData(true)
    expect(noteLinkCheck(3, 40)).toBe(false)
    expect(isAdaptiveLowDataActive()).toBe(true)
    expect(noteLinkCheck(25, 40)).toBe(true)
    expect(isAdaptiveLowDataActive()).toBe(false)
  })
})
