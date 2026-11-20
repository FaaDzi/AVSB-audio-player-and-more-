// §97: the update on Settings → App. The check runs at every start; a found update puts a dot on the App row (red for
// a stable release, blue for a preview) and a Download row here. Pulling this page down from its top checks again.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'
import { useShell } from '../context'
import { checkNow, getUpdate, useFoundUpdate, type Update } from '../updates'
import { version } from '../../../package.json'

const dotColor = (preview: boolean) => (preview ? '#7cc4ff' : '#ff5c5c')

export function UpdateDot() {
  const found = useFoundUpdate()
  if (!found) return null
  return <span className="ms-update-dot" style={{ background: dotColor(found.preview) }} aria-label={`AVSB ${found.version} is out`} />
}

export function AppUpdateRow() {
  const { showToast } = useShell()
  const found = useFoundUpdate()
  const [share, setShare] = useState<number | null>(null)
  const here = useRef<HTMLDivElement>(null)
  // §100: the pull's answer, in a card that drops in at the top (the bottom toast came out white in the dark theme)
  const [pop, setPop] = useState<{ checking: true } | { checking: false; found: Update | null } | null>(null)
  useEffect(() => {
    if (!pop || pop.checking) return
    const id = window.setTimeout(() => setPop(null), pop.found ? 8000 : 3500)
    return () => window.clearTimeout(id)
  }, [pop])

  // pull this page down from its very top to ask GitHub again (ignored only while a check is still running)
  useEffect(() => {
    const page = here.current?.closest('.ms-settings-body')
    if (!page) return
    let start: number | null = null
    let busy = false
    const down = (e: Event) => {
      const t = (e as TouchEvent).touches
      start = page.scrollTop <= 0 && t.length === 1 ? t[0].clientY : null
    }
    const up = (e: Event) => {
      if (start === null) return
      const pulled = (e as TouchEvent).changedTouches[0].clientY - start
      start = null
      if (pulled < 120 || busy) return
      busy = true
      setPop({ checking: true })
      void checkNow().then((u) => { busy = false; setPop({ checking: false, found: u }) })
    }
    page.addEventListener('touchstart', down, { passive: true })
    page.addEventListener('touchend', up, { passive: true })
    return () => {
      page.removeEventListener('touchstart', down)
      page.removeEventListener('touchend', up)
    }
  }, [])

  const download = (u: Update) => {
    setShare(0)
    void getUpdate(u, setShare).then((error) => {
      setShare(null)
      if (error) showToast(error)
    })
  }

  return (
    <div ref={here}>
      {pop && createPortal(
        <div className="ms-update-pop" role="status">
          {pop.checking ? <span className="ms-spinner" /> : <Icon name={pop.found ? 'system_update' : 'check_circle'} />}
          <span className="grow">
            {pop.checking ? 'Checking for updates…' : pop.found ? `New update found: AVSB ${pop.found.version}` : `AVSB ${version} is the latest version`}
          </span>
          {!pop.checking && pop.found && (
            <button type="button" className="ms-btn tonal small" onClick={() => { const u = pop.found; setPop(null); if (u) download(u) }}>Download</button>
          )}
        </div>,
        document.querySelector('.ms-window') ?? document.body,
      )}
      {found && (
        <div className="ms-set-group" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className="ms-set-row clickable"
            disabled={share !== null}
            onClick={() => download(found)}
          >
            <Icon name="system_update" />
            <span className="grow ms-set-text">
              {share !== null ? `Downloading ${Math.round(share * 100)}%` : `Download AVSB ${found.version}`}
              <small>{found.preview ? 'Preview' : 'Stable'} · you have {version}</small>
            </span>
            <span className="ms-update-dot" style={{ background: dotColor(found.preview) }} />
          </button>
        </div>
      )}
    </div>
  )
}
