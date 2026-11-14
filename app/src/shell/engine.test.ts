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
