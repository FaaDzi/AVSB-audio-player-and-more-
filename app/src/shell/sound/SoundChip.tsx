// The Sound chip (§68) on the player bar and Now Playing: what you're hearing your device as ("HD 600 · 100 %").
// Click switches to your plain device and back (the same loudness either way, so the compare is fair); the context
// menu opens Settings → Equalizer. Hidden while no aim is set.
import { useEffect, useState } from 'react'
import { Icon } from '../ui'
import { useShell } from '../context'
import { loadDatabase, type Database } from '../database/catalog'
import { setSound, useSound } from './soundState'

export function SoundChip({ big }: { big?: boolean }) {
  const sound = useSound()
  const { go } = useShell()
  const [db, setDb] = useState<Database | null>(null)
  useEffect(() => {
    if (sound.aim.kind === 'off' || db) return
    let live = true
    void loadDatabase().then((d) => live && setDb(d), () => {})
    return () => {
      live = false
    }
  }, [sound.aim.kind, db])
  if (sound.aim.kind === 'off') return null
  const name = sound.aim.kind === 'target' ? sound.aim.name : db?.catalog.byId.get(sound.aim.id)?.name ?? '…'
  if (sound.aim.kind === 'device' && !sound.aim.id) return null
  const label = `${name}${sound.strength < 100 ? ` · ${sound.strength} %` : ''}`
  return (
    <button
      type="button"
      className={`ms-snd-chip${sound.bypass ? ' bypass' : ''}${big ? ' big' : ''}`}
      aria-pressed={!sound.bypass}
      title={sound.bypass ? `Your device as it is. Click to hear ${name} again` : `Hearing ${name}. Click to compare with your device as it is (right-click for the Equalizer)`}
      onClick={() => setSound({ bypass: !sound.bypass })}
      onContextMenu={(e) => {
        e.preventDefault()
        go({ page: 'settings', section: 'equalizer' })
      }}
    >
      <Icon name={sound.bypass ? 'hearing_disabled' : 'graphic_eq'} size={18} />
      <span className="ms-ellipsis">{sound.bypass ? 'Your device' : label}</span>
    </button>
  )
}
