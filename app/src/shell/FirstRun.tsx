import { useState } from 'react'
import { Icon } from './ui'
import { host } from './host'
import { Capacitor } from '@capacitor/core'
import { addFolder, scan } from './localLibrary'
import { setSetting } from './settings/store'

/** The first run: one music folder, then the Library fills in as it's read. More folders are added in Settings. */
export function FirstRun() {
  const [subfolders, setSubfolders] = useState(true)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const bridge = host()

  const use = async (folder: string | null) => {
    if (!folder) return
    setBusy(true)
    setError('')
    try {
      await addFolder(folder, subfolders)
    } catch (e) {
      setError(`That folder couldn't be added (${String(e)})`)
      setBusy(false)
    }
  }

  // Android reads the phone's media index: one button, which also asks for Music and audio access
  if (Capacitor.getPlatform() === 'android') {
    const find = () => {
      setBusy(true)
      setError('')
      // a device with no music at all (a tablet that only streams from the PC) still gets in once this scan ends;
      // before, this screen came back after an empty scan and the app never opened
      scan().then(() => setSetting('library.emptyok', true), (e: unknown) => {
        setError(/DENIED/.test(String(e)) ? 'Music and audio access is needed to list your songs' : `Couldn't read your songs (${String(e)})`)
        setBusy(false)
      })
    }
    return (
      <div className="ms-firstrun">
        <div className="ms-firstrun-card">
          <span className="ms-firstrun-tile"><Icon name="library_music" fill size={56} /></span>
          <small style={{ fontWeight: 700, letterSpacing: '1.2px', color: 'var(--accent)' }}>AVSB</small>
          <h1>Find the music on this phone</h1>
          <p>Songs are played where they are. Nothing is copied or uploaded.</p>
          <button type="button" className="ms-btn primary big" disabled={busy} onClick={find}>
            <Icon name="search" size={22} /> {busy ? 'Reading…' : 'Find music'}
          </button>
          {error && <p className="ms-firstrun-error">{error}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="ms-firstrun">
      <div className="ms-firstrun-card">
        <span className="ms-firstrun-tile"><Icon name="library_music" fill size={56} /></span>
        <small style={{ fontWeight: 700, letterSpacing: '1.2px', color: 'var(--accent)' }}>AVSB</small>
        <h1>Choose your music folder</h1>
        <p>Songs are read where they are. Nothing is copied or uploaded.</p>
        {bridge ? (
          <button type="button" className="ms-btn primary big" disabled={busy} onClick={() => { void bridge.chooseFolder().then(use) }}>
            <Icon name="folder_open" size={22} /> {busy ? 'Reading…' : 'Choose folder'}
          </button>
        ) : (
          // the dev server has no folder picker: type the path
          <form className="ms-firstrun-path" onSubmit={(e) => { e.preventDefault(); void use(typed.trim()) }}>
            <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="D:\Music" aria-label="Music folder" />
            <button type="submit" className="ms-btn primary" disabled={busy || !typed.trim()}>Add</button>
          </form>
        )}
        <label className="ms-firstrun-switch">
          <Icon name="account_tree" />
          <span className="grow">Include subfolders</span>
          <input type="checkbox" role="switch" className="ms-switch" checked={subfolders} onChange={(e) => setSubfolders(e.target.checked)} />
        </label>
        {error && <p className="ms-firstrun-error">{error}</p>}
      </div>
    </div>
  )
}
