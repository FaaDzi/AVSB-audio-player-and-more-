import { useEffect, useState } from 'react'
import { Icon } from '../ui'
import { useShell } from '../context'
import { phoneLink, type PhoneLinkStatus } from '../linkClient'
import { host } from '../host'
import { getSetting, setSetting, useSettings } from './store'

interface SpeedResult {
  latencyMs: number
  speedMbps: number
  tier: 'excellent' | 'good' | 'fair' | 'very_low' | 'offline'
  path: string
}

export function DataNetworkSection() {
  const { showToast } = useShell()
  useSettings()
  const offlineMode = Boolean(getSetting('offline_mode')) || (typeof navigator !== 'undefined' && !navigator.onLine)
  const autoWeak = getSetting('auto_lowdata_on_weak') !== false

  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<SpeedResult | null>(null)
  const [airplaneActive, setAirplaneActive] = useState(false)

  // Listen to browser / Android offline events to auto-detect airplane / network cut
  useEffect(() => {
    const handleOffline = () => {
      setAirplaneActive(true)
      if (!getSetting('offline_mode')) {
        setSetting('offline_mode', true)
        showToast('Airplane mode / network offline detected. Offline Mode turned ON.')
      }
    }
    const handleOnline = () => {
      setAirplaneActive(false)
    }

    window.addEventListener('offline', handleOffline)
    window.addEventListener('online', handleOnline)

    // Check Android native airplane mode if available
    phoneLink?.isAirplaneMode?.().then((r) => {
      if (r?.airplaneMode) {
        setAirplaneActive(true)
        if (!getSetting('offline_mode')) {
          setSetting('offline_mode', true)
        }
      }
    }).catch(() => {})

    return () => {
      window.removeEventListener('offline', handleOffline)
      window.removeEventListener('online', handleOnline)
    }
  }, [showToast])

  const runConnectionTest = async () => {
    if (offlineMode || airplaneActive) {
      showToast("You're in offline mode, please turn on connection")
      return
    }

    setTesting(true)
    const t0 = performance.now()

    try {
      if (phoneLink) {
        let res: PhoneLinkStatus & { speedMbps?: number | null; latencyMs?: number | null; airplaneMode?: boolean }
        if (typeof phoneLink.testSpeed === 'function') {
          res = await phoneLink.testSpeed()
        } else if (typeof phoneLink.ping === 'function') {
          res = await phoneLink.ping()
        } else {
          res = await phoneLink.status()
        }

        if (res.airplaneMode) {
          setAirplaneActive(true)
          setSetting('offline_mode', true)
          showToast("You're in offline mode, please turn on connection")
          setTesting(false)
          return
        }

        if (!res.connected) {
          showToast('PC is currently disconnected or asleep')
          setResult({ latencyMs: 0, speedMbps: 0, tier: 'offline', path: '' })
          setTesting(false)
          return
        }

        const latency = res.latencyMs ?? Math.max(1, Math.round(performance.now() - t0))
        const speed = typeof res.speedMbps === 'number' ? res.speedMbps : 0
        const path =
          res.transport === 'lan-http'
            ? 'Direct Wi-Fi (HTTP)'
            : res.transport === 'iroh-direct'
              ? 'Direct P2P (QUIC)'
              : res.transport === 'iroh-relayed'
                ? 'Relayed (QUIC)'
                : res.path === 'direct'
                  ? 'Direct Wi-Fi'
                  : 'Relayed'

        let tier: SpeedResult['tier'] = 'good'
        if (speed <= 0) tier = 'very_low'
        else if (latency < 80 && speed >= 15) tier = 'excellent'
        else if (latency < 180 && speed >= 5) tier = 'good'
        else if (latency < 300 && speed >= 1.5) tier = 'fair'
        else tier = 'very_low'

        const r: SpeedResult = { latencyMs: latency, speedMbps: speed, tier, path }
        setResult(r)

        if (tier === 'very_low') {
          if (autoWeak) {
            setSetting('stream_quality', 'Low Data (~128 kbps)')
            showToast(`Measured throughput low (${speed} Mbps). Switched to Low Data Mode for smooth playback.`)
          } else {
            showToast(`Measured throughput low (${speed} Mbps). Consider enabling Low Data Mode.`)
          }
        } else {
          showToast(`Connection test: ${tier.toUpperCase()} (${speed} Mbps · ${latency} ms via ${path})`)
        }
      } else {
        // Desktop / Browser environment test: measure actual IPC / local host responsiveness rather than fabricating Mbps
        const link = host()?.link
        const status = link ? await link.status() : null
        const res = await fetch('/shell-host/library', { cache: 'no-store' }).catch(() => null)
        const bytes = res ? (await res.arrayBuffer()).byteLength : 0
        const latency = Math.max(1, Math.round(performance.now() - t0))
        const speed = bytes > 0 ? Math.round(((bytes * 8) / (latency / 1000) / 1_000_000) * 10) / 10 : 0
        const r: SpeedResult = {
          latencyMs: latency,
          speedMbps: speed,
          tier: latency < 200 ? 'excellent' : 'good',
          path: status?.lanPort ? `LAN Port ${status.lanPort}` : status?.online ? 'Streaming Host Online' : 'Local Host',
        }
        setResult(r)
        showToast(`Local host check: ${latency} ms (${r.path})`)
      }
    } catch (e) {
      showToast(`Connection test failed: ${String((e as Error)?.message ?? e)}`)
    } finally {
      setTesting(false)
    }
  }

  const tierBadge = () => {
    if (offlineMode || airplaneActive) {
      return (
        <span className="ms-status-pill offline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)', fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#888' }} />
          Offline Mode Active
        </span>
      )
    }
    if (!result) {
      return (
        <span className="ms-status-pill ready" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)', fontSize: 13 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50' }} />
          Ready to Test
        </span>
      )
    }
    switch (result.tier) {
      case 'excellent':
        return (
          <span className="ms-status-pill excellent" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(76,175,80,0.15)', color: '#4caf50', fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50' }} />
            🟢 Excellent ({result.path} · {result.speedMbps} Mbps · {result.latencyMs} ms)
          </span>
        )
      case 'good':
        return (
          <span className="ms-status-pill good" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(76,175,80,0.15)', color: '#4caf50', fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#4caf50' }} />
            🟢 Good ({result.path} · {result.speedMbps} Mbps · {result.latencyMs} ms)
          </span>
        )
      case 'fair':
        return (
          <span className="ms-status-pill fair" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,193,7,0.15)', color: '#ffb300', fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ffb300' }} />
            🟡 Fair ({result.path} · {result.speedMbps} Mbps · {result.latencyMs} ms)
          </span>
        )
      case 'very_low':
        return (
          <span className="ms-status-pill low" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(244,67,54,0.15)', color: '#f44336', fontSize: 13, fontWeight: 600 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f44336' }} />
            🔴 Very Low ({result.path} · {result.speedMbps} Mbps · {result.latencyMs} ms)
          </span>
        )
      default:
        return (
          <span className="ms-status-pill offline" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, background: 'rgba(255,255,255,0.08)', color: 'var(--text-dim)', fontSize: 13 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#888' }} />
            ⚪ PC Disconnected / Sleeping
          </span>
        )
    }
  }

  return (
    <div className="ms-set-card" style={{ marginTop: 12, padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon name="speed" size={22} />
          <div>
            <b style={{ fontSize: 14 }}>Connection Speed & Signal Test</b>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              Check link throughput and PC connection stability
            </div>
          </div>
        </div>
        {tierBadge()}
      </div>

      {offlineMode && (
        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(255, 152, 0, 0.1)', color: '#ffa726', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="info" size={16} />
          <span>Offline mode is active. Streaming quality settings are locked to local-only playback.</span>
        </div>
      )}

      <button
        type="button"
        className="ms-btn tonal"
        disabled={testing}
        onClick={runConnectionTest}
        style={{ width: '100%', height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 600 }}
      >
        <span className={testing ? 'rotating' : ''} style={{ display: 'inline-flex' }}>
          <Icon name={testing ? 'sync' : 'network_check'} size={18} />
        </span>
        {testing ? 'Testing connection…' : 'Test Connection'}
      </button>
    </div>
  )
}
