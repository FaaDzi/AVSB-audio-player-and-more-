// Spotify-style Rewind modal: listening minutes, top artist with avatar,
// top 5 songs, favorite audio gear & target curve, and social sharing.
import { useMemo } from 'react'
import { Dialog, Icon } from '../ui'
import { useShell } from '../context'
import { hiddenTrackIds, useLibrary } from '../library'
import { topArtists, topSongs, useListening, withoutSongs, type Listening } from '../stats'
import { getSetting } from '../settings/store'
import { getCachedArtistPhoto } from '../metadata'
import { getGear } from '../sound/gear'
import { getGearProfile } from '../sound/gearProfiles'

export function currentRewindPeriodKey(now = Date.now(), freq = '1 Week'): string {
  const d = new Date(now)
  if (freq === '1 Day') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }
  if (freq === '1 Month') {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  }
  if (freq === '1 Year') {
    return `${d.getFullYear()}`
  }
  // Default: '1 Week' - Monday-based ISO week
  const date = new Date(d.getTime())
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7))
  const week1 = new Date(date.getFullYear(), 0, 4)
  const weekNum = 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)
  return `${date.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}

export function isRewindDue(listening: Listening, now = Date.now()): boolean {
  if (Object.keys(listening.songs).length === 0) return false
  const freq = (getSetting('rewind_frequency') as string) || '1 Week'
  const key = currentRewindPeriodKey(now, freq)
  const lastViewed = localStorage.getItem('rewind_last_viewed')
  return lastViewed !== key
}

export function markRewindViewed(now = Date.now()) {
  const freq = (getSetting('rewind_frequency') as string) || '1 Week'
  const key = currentRewindPeriodKey(now, freq)
  localStorage.setItem('rewind_last_viewed', key)
}

export function RewindModal({ onClose }: { onClose: () => void }) {
  const { showToast, data } = useShell()
  const tracks = useLibrary()
  const all = useListening()
  const listening = useMemo(() => withoutSongs(all, hiddenTrackIds(data.tracks, tracks.hiddenFolders)), [all, data.tracks, tracks.hiddenFolders])
  const gear = getGear()
  const profile = getGearProfile(gear.active)

  const topArtistsList = useMemo(() => topArtists(listening, tracks, 5), [listening, tracks])
  const topSongsList = useMemo(() => topSongs(listening, tracks, 5), [listening, tracks])

  const totalMinutes = useMemo(() => {
    let sec = 0
    for (const [id, s] of Object.entries(listening.songs)) {
      const t = tracks.find((tr) => tr.id === id)
      sec += (s.plays || 0) * (t?.sec || 180)
    }
    return Math.max(1, Math.round(sec / 60))
  }, [listening, tracks])

  const topArtist = topArtistsList[0]
  const topArtistAvatar = topArtist ? getCachedArtistPhoto(topArtist.name) : null
  const activeGearName = gear.active || 'Pure Sound'
  const activeTargetName = profile.activeItemId
    ? profile.items.find((i) => i.id === profile.activeItemId)?.name ?? profile.activeItemId
    : 'Raw audio with no changes'

  const handleShare = async () => {
    const textLines = [
      '🎵 My Music Preferences Rewind 🎵',
      `⏱️ ${totalMinutes} minutes listened`,
      topArtist ? `👑 #1 Artist: ${topArtist.name} (${topArtist.plays} plays)` : '',
      '🔥 Top Songs:',
      ...topSongsList.map((s, i) => `${i + 1}. ${s.track.title} - ${s.track.artist}`),
      `🎧 Gear: ${activeGearName} (${activeTargetName})`,
    ].filter(Boolean)

    const text = textLines.join('\n')

    if (navigator.share) {
      try {
        await navigator.share({
          title: 'My Music Preferences Rewind',
          text,
        })
        return
      } catch {
        // User cancelled or share failed, fallback to copy
      }
    }

    try {
      await navigator.clipboard.writeText(text)
      showToast('Rewind recap copied to clipboard!')
    } catch {
      showToast('Could not copy recap')
    }
  }

  const handleClose = () => {
    markRewindViewed()
    onClose()
  }

  return (
    <Dialog title="Your Music Rewind" onClose={handleClose}>
      <div className="ms-rewind-modal-wrap" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Hero Card */}
        <div
          style={{
            background: 'linear-gradient(135deg, #7c3aed 0%, #db2777 50%, #f59e0b 100%)',
            borderRadius: 20,
            padding: '24px 20px',
            color: '#fff',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            boxShadow: '0 8px 32px rgba(124, 58, 237, 0.35)',
          }}
        >
          <span style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>
            Your Listening Recap
          </span>
          <h2 style={{ fontSize: 36, fontWeight: 900, margin: '6px 0 2px' }}>{totalMinutes}</h2>
          <span style={{ fontSize: 14, opacity: 0.95 }}>Minutes Listened</span>

          {topArtist && (
            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div
                style={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  overflow: 'hidden',
                  background: 'rgba(255, 255, 255, 0.2)',
                  border: '3px solid rgba(255, 255, 255, 0.8)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 8,
                }}
              >
                {topArtistAvatar ? (
                  <img src={topArtistAvatar} alt={topArtist.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <Icon name="person" size={36} />
                )}
              </div>
              <span style={{ fontSize: 12, opacity: 0.85 }}>#1 Top Artist</span>
              <b style={{ fontSize: 18, marginTop: 2 }}>{topArtist.name}</b>
              <small style={{ opacity: 0.85 }}>{topArtist.plays} plays</small>
            </div>
          )}
        </div>

        {/* Top 5 Songs */}
        <div>
          <b style={{ fontSize: 14, color: 'var(--text-strong)', display: 'block', marginBottom: 8 }}>
            Top 5 Songs
          </b>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {topSongsList.map((s, i) => (
              <div
                key={s.track.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '8px 12px',
                  borderRadius: 12,
                  background: 'rgba(255, 255, 255, 0.05)',
                }}
              >
                <b style={{ fontSize: 16, width: 20, color: i === 0 ? 'var(--accent)' : 'var(--text-dim)', textAlign: 'center' }}>
                  {i + 1}
                </b>
                <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.track.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.track.artist}
                  </div>
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{s.plays} plays</span>
              </div>
            ))}
          </div>
        </div>

        {/* Favorite Gear & Target */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'rgba(255, 255, 255, 0.04)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <span style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(255, 255, 255, 0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="headphones" size={20} />
          </span>
          <div style={{ flex: 1, textAlign: 'left' }}>
            <span style={{ fontSize: 11, color: 'var(--text-dim)', textTransform: 'uppercase' }}>Auditioned On</span>
            <div style={{ fontWeight: 600, fontSize: 14 }}>{activeGearName}</div>
            <small style={{ color: 'var(--text-dim)' }}>Target: {activeTargetName}</small>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button
            type="button"
            className="ms-btn primary"
            style={{ flex: 1, height: 44, borderRadius: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
            onClick={handleShare}
          >
            <Icon name="share" size={18} />
            <span>Share Rewind</span>
          </button>
          <button
            type="button"
            className="ms-btn tonal"
            style={{ height: 44, padding: '0 20px', borderRadius: 22 }}
            onClick={handleClose}
          >
            Done
          </button>
        </div>
      </div>
    </Dialog>
  )
}
