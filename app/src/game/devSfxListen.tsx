// Temporary listening page for §64 (dev server only): each burst with its matched whoosh, and the other new sounds.
import { createRoot } from 'react-dom/client'
import '../App.css'
import { sfx, SAMPLES, type SampleName } from '../audio/sfx'
import { playFireWipe } from './fireWipe'

const btn = { margin: 6, padding: '10px 16px', borderRadius: 10, border: 0, font: 'inherit', cursor: 'pointer' }
function Page() {
  return (
    <div>
      <h2>Bursts with their sounds</h2>
      <p>Each press plays a random burst (never the same twice) with its matched whoosh, as in a tournament.</p>
      <button style={btn} onClick={() => { void sfx.warmSamples().then(() => playFireWipe(() => {})) }}>Play a burst</button>
      <h2>The other sounds</h2>
      {(Object.keys(SAMPLES) as SampleName[]).map((n) => (
        <button key={n} style={btn} onClick={() => { void sfx.warmSamples().then(() => sfx.playSample(n)) }}>{n}</button>
      ))}
      <p>Mapping: VS appears = vs-slam · tap to start = tap · pick = pick · before results = build · champion = champion.</p>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<Page />)
