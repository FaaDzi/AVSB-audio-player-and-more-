// Quick switch (§69) on the player bar and between Lyrics and Up next in Now Playing:
// shows the devices saved in Settings → My gear ("Listening on" = your saved devices;
// "Hearing" = your device as it is, plus any devices starred/saved to test in Settings).
// Adding or editing devices happens in Settings → My gear so the player stays clean.
import { useEffect, useState } from 'react'
import { Icon, Menu, type MenuItem } from '../ui'
import { useShell } from '../context'
import { loadDatabase, type Database } from '../database/catalog'
import { hearDevice, setActive, useGear } from './gear'
import { setSound, useSound } from './soundState'
import { gearName, isPhoneSpeaker } from './phoneSpeaker'

let cachedDb: Database | null = null

function useCatalogDb(loadImmediately = false) {
  const [db, setDb] = useState<Database | null>(cachedDb)
  useEffect(() => {
    if (!loadImmediately || db) return
    void loadDatabase().then((loaded) => {
      cachedDb = loaded
      setDb(loaded)
    }, () => {})
  }, [loadImmediately, db])
  return db
}

export function GearSwitch() {
  const gear = useGear()
  const sound = useSound()
  const { go, setNowPlaying } = useShell()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const db = useCatalogDb(Boolean(menu) || gear.owned.length > 0 || gear.starred.length > 0)
  // the phone speaker isn't in the catalog: its own name, not "…" (§101)
  const name = (id: string) => db?.catalog.byId.get(id)?.name ?? (isPhoneSpeaker(id) ? gearName(id) : '…')
  const hearing = sound.aim.kind === 'device' && !sound.bypass ? sound.aim.id : null
  const plain = sound.aim.kind === 'off' || sound.bypass

  const openGearSettings = () => {
    setNowPlaying(false)
    go({ page: 'settings', section: 'gear' })
  }

  const items: MenuItem[] = []
  if (gear.owned.length === 0 && gear.starred.length === 0) {
    items.push(
      { label: 'No devices saved in Settings yet', heading: true },
      { label: 'Set up your gear in Settings…', icon: 'settings', onSelect: openGearSettings },
    )
  } else {
    if (gear.owned.length > 0) {
      items.push({ label: 'Your device (listening on)', heading: true })
      for (const d of gear.owned) {
        items.push({
          label: name(d.id),
          checked: d.id === gear.active,
          onSelect: () => setActive(d.id),
        })
      }
    }
    items.push(
      { label: 'Device to test (hearing)', heading: true },
      {
        label: 'Your device as it is',
        checked: plain,
        onSelect: () => setSound({ aim: { kind: 'off' }, bypass: false }),
      },
      ...gear.starred.map((id) => ({
        label: name(id),
        checked: hearing === id,
        onSelect: () => hearDevice(id),
      })),
    )
  }

  return (
    <>
      <button
        type="button"
        className={`ms-iconbtn ms-gear-switch${!plain ? ' active' : ''}`}
        aria-label="Switch your gear"
        title="Quick check & switch saved devices"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          setMenu({ x: r.left, y: r.top })
        }}
      >
        <Icon name="headphones" size={22} />
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={items}
        />
      )}
    </>
  )
}

