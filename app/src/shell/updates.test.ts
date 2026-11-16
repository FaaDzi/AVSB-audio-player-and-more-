import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('localStorage', { getItem: () => null, setItem() {} })
const { isNewer, pickUpdate } = await import('./updates')

const rel = (tag: string, prerelease = false, draft = false) => ({
  tag_name: tag, prerelease, draft, html_url: `https://x/${tag}`,
  assets: [{ name: `AVSB-${tag}-android.apk`, browser_download_url: `https://x/${tag}.apk` }, { name: `AVSB-${tag}-windows.zip`, browser_download_url: `https://x/${tag}.zip` }],
})

describe('update check (plan §83)', () => {
  it('orders versions, previews below their release', () => {
    expect(isNewer('v1.1.2', '1.1.0')).toBe(true)
    expect(isNewer('v1.1.0', '1.1.0')).toBe(false)
    expect(isNewer('v1.2', '1.1.9')).toBe(true)
    expect(isNewer('v1.2.0', '1.2.0-preview.31')).toBe(true)
    expect(isNewer('v1.2.0-preview.31', '1.2.0-preview.4')).toBe(true)
    expect(isNewer('v1.2.0-preview.31', '1.1.2')).toBe(true)
    expect(isNewer('nightly', '1.1.0')).toBe(false)
  })
  it('Stable takes the newest full release and this platform\'s file; Preview may take a pre-release', () => {
    const list = [rel('v1.1.0'), rel('v1.3.0-preview.2', true), rel('v1.2.0'), rel('v9.0.0', false, true)]
    expect(pickUpdate(list, '1.1.0', false, true)).toEqual({ version: '1.2.0', url: 'https://x/v1.2.0.apk' })
    expect(pickUpdate(list, '1.1.0', false, false)?.url).toBe('https://x/v1.2.0.zip')
    expect(pickUpdate(list, '1.1.0', true, true)?.version).toBe('1.3.0-preview.2')
    expect(pickUpdate(list, '1.2.0', false, true)).toBeNull()
    expect(pickUpdate([{ ...rel('v1.2.0'), assets: [] }], '1.1.0', false, true)?.url).toBe('https://x/v1.2.0')
  })
})
