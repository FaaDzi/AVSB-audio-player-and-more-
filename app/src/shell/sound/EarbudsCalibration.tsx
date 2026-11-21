// §104 C: the head-sensor calibration, full screen so it's easy to follow: flashing corner brackets (the usual
// "calibrating" frame), one instruction at a time, a bar that fills while a position is held, a ding as each step
// passes and a chime at the end. The finished screen goes away by itself after 3 s, or on any tap.
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '../ui'
import { earbudsTracker } from '../../headtrack/driver'
import { LOOK_STEPS, type LookStep } from '../../headtrack/budsMath'
import { playDing } from '../../audio/ding'

const SAY: Record<LookStep, { icon: string; title: string; hint: string }> = {
  ahead: { icon: 'center_focus_strong', title: 'Look straight ahead', hint: 'At your screen, as you normally sit. Hold still.' },
  up: { icon: 'arrow_upward', title: 'Now look up', hint: 'Tilt your head up and hold it there.' },
  down: { icon: 'arrow_downward', title: 'Now look down', hint: 'Tilt your head down and hold it there.' },
  nod: { icon: 'swap_vert', title: 'Nod slowly', hint: 'Up and down, slowly, for about 3 seconds.' },
  left: { icon: 'arrow_back', title: 'Turn your head left', hint: 'Turn, don’t tilt. Hold it there.' },
  right: { icon: 'arrow_forward', title: 'Now turn right', hint: 'All the way past the front to the right. Hold it there.' },
  done: { icon: 'check_circle', title: 'Calibration complete', hint: 'Saved for these earbuds. You only do this once.' },
  failed: { icon: 'replay', title: "Didn't catch that", hint: 'Move a bit further and hold each position for a second.' },
}

/** How long the "complete" screen stays before it closes by itself. */
const DONE_SHOWN_MS = 3000

export function EarbudsCalibration({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<LookStep>('ahead')
  const [hold, setHold] = useState(0)
  const [run, setRun] = useState(0)
  const stepRef = useRef<LookStep>('ahead')
  const name = earbudsTracker()?.earbuds?.name ?? 'your earbuds'

  useEffect(() => {
    const t = earbudsTracker()
    if (!t) return onClose()
    stepRef.current = 'ahead'
    setStep('ahead')
    setHold(0)
    let last = 0
    void t.calibrate((p) => {
      // a step just passed: ding (the last one gets the chime below instead)
      if (p.step !== stepRef.current) {
        if (p.step !== 'done' && p.step !== 'failed') playDing('step')
        stepRef.current = p.step
        setStep(p.step)
        setHold(p.hold)
        return
      }
      // ~50 updates a second from the earbuds: the bar needs far fewer
      const now = performance.now()
      if (now - last > 60) {
        last = now
        setHold(p.hold)
      }
    }).then((r) => {
      stepRef.current = r === 'saved' ? 'done' : 'failed'
      setStep(stepRef.current)
      if (r === 'saved') {
        playDing('step')
        setTimeout(() => playDing('done'), 350)
      }
    })
    return () => t.cancelCalibration()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run])

  // the finished screen closes by itself
  useEffect(() => {
    if (step !== 'done') return
    const id = window.setTimeout(onClose, DONE_SHOWN_MS)
    return () => window.clearTimeout(id)
  }, [step, onClose])

  const say = SAY[step]
  const finished = step === 'done' || step === 'failed'
  const at = LOOK_STEPS.indexOf(step as (typeof LOOK_STEPS)[number])
  return createPortal(
    <div className="ms-cal" role="dialog" aria-label={`Calibrating ${name}`} onClick={step === 'done' ? onClose : undefined}>
      <p className="ms-cal-who">Calibrating {name}</p>
      <div className={`ms-cal-frame ${step}`}>
        <i /><i /><i /><i />
        <Icon name={say.icon} size={64} />
      </div>
      <h2>{say.title}</h2>
      <p>{say.hint}</p>
      {!finished && <div className="ms-cal-hold" aria-hidden="true"><b style={{ width: `${Math.round(hold * 100)}%` }} /></div>}
      {!finished && <ol className="ms-cal-steps">{LOOK_STEPS.map((s, i) => <li key={s} className={i === at ? 'on' : i < at ? 'done' : ''} />)}</ol>}
      <div className="ms-cal-actions">
        {step === 'failed' && <button type="button" className="ms-btn primary" onClick={() => setRun((r) => r + 1)}>Try again</button>}
        {step !== 'done' && <button type="button" className="ms-btn text" onClick={onClose}>Cancel</button>}
      </div>
    </div>,
    document.querySelector('.ms-window') ?? document.body,
  )
}
