// §104 C: the earbuds' calibration, full screen so it's easy to follow: flashing corner brackets (the usual
// "calibrating" frame), one instruction at a time, a bar that fills while a position is held, and a ding when saved.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'
import { earbudsTracker } from '../../headtrack/driver'
import type { LookStep } from '../../headtrack/budsMath'
import { playDing } from '../../audio/ding'

const SAY: Record<LookStep, { icon: string; title: string; hint: string }> = {
  ahead: { icon: 'center_focus_strong', title: 'Look straight ahead', hint: 'At your screen, as you normally sit. Hold still.' },
  up: { icon: 'arrow_upward', title: 'Now look up', hint: 'Tilt your head up and hold it there.' },
  down: { icon: 'arrow_downward', title: 'Now look down', hint: 'Tilt your head down and hold it there.' },
  done: { icon: 'check_circle', title: 'Calibration complete', hint: 'Saved for these earbuds. You only do this once.' },
  failed: { icon: 'replay', title: "Didn't catch that", hint: 'Move a bit further and hold each position for a second.' },
}

export function EarbudsCalibration({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<LookStep>('ahead')
  const [hold, setHold] = useState(0)
  const [run, setRun] = useState(0)
  const name = earbudsTracker()?.earbuds?.name ?? 'your earbuds'

  useEffect(() => {
    const t = earbudsTracker()
    if (!t) return onClose()
    setStep('ahead')
    setHold(0)
    let last = 0
    void t.calibrate((p) => {
      // ~50 updates a second from the earbuds: the screen needs far fewer
      const now = performance.now()
      if (p.step !== step || now - last > 60) {
        last = now
        setStep(p.step)
        setHold(p.hold)
      }
    }).then((r) => {
      setStep(r === 'saved' ? 'done' : 'failed')
      if (r === 'saved') playDing()
    })
    return () => t.cancelCalibration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  const say = SAY[step]
  const finished = step === 'done' || step === 'failed'
  return createPortal(
    <div className="ms-cal" role="dialog" aria-label={`Calibrating ${name}`}>
      <p className="ms-cal-who">Calibrating {name}</p>
      <div className={`ms-cal-frame ${step}`}>
        <i /><i /><i /><i />
        <Icon name={say.icon} size={64} />
      </div>
      <h2>{say.title}</h2>
      <p>{say.hint}</p>
      {!finished && <div className="ms-cal-hold" aria-hidden="true"><b style={{ width: `${Math.round(hold * 100)}%` }} /></div>}
      {!finished && <ol className="ms-cal-steps">{(['ahead', 'up', 'down'] as const).map((s) => <li key={s} className={s === step ? 'on' : ['ahead', 'up', 'down'].indexOf(s) < ['ahead', 'up', 'down'].indexOf(step) ? 'done' : ''} />)}</ol>}
      <div className="ms-cal-actions">
        {step === 'failed' && <button type="button" className="ms-btn primary" onClick={() => setRun((r) => r + 1)}>Try again</button>}
        <button type="button" className={`ms-btn ${step === 'done' ? 'primary' : 'text'}`} onClick={onClose}>{step === 'done' ? 'Done' : 'Cancel'}</button>
      </div>
    </div>,
    document.querySelector('.ms-window') ?? document.body,
  )
}
