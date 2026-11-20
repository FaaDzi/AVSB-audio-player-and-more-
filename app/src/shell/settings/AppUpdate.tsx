// §97: the update on Settings → App. The check runs at every start; a found update puts a dot on the App row (red for
// a stable release, blue for a preview) and a Download row here. Pulling this page down from its top checks again.
import { useEffect, useRef, useState } from 'react'
import { Icon } from '../ui'
import { useShell } from '../context'
import { checkNow, getUpdate, useFoundUpdate } from '../updates'
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

  // pull this page down from its very top to ask GitHub again (at most every 10 s)
  useEffect(() => {
    const page = here.current?.closest('.ms-settings-body')
    if (!page) return
    let start: number | null = null
    let last = 0
    const down = (e: Event) => {
      const t = (e as TouchEvent).touches
      start = page.scrollTop <= 0 && t.length === 1 ? t[0].clientY : null
    }
    const up = (e: Event) => {
      if (start === null) return
      const pulled = (e as TouchEvent).changedTouches[0].clientY - start
      start = null
      if (pulled < 120 || Date.now() - last < 10000) return
      last = Date.now()
      showToast('Checking for a new version…')
      void checkNow().then((u) => showToast(u ? `AVSB ${u.version} is out` : `AVSB ${version} is the newest`))
    }
    page.addEventListener('touchstart', down, { passive: true })
    page.addEventListener('touchend', up, { passive: true })
    return () => {
      page.removeEventListener('touchstart', down)
      page.removeEventListener('touchend', up)
    }
  }, [showToast])

  return (
    <div ref={here}>
      {found && (
        <div className="ms-set-group" style={{ marginBottom: 8 }}>
          <button
            type="button"
            className="ms-set-row clickable"
            disabled={share !== null}
            onClick={() => {
              setShare(0)
              void getUpdate(found, setShare).then((error) => {
                setShare(null)
                if (error) showToast(error)
              })
            }}
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
