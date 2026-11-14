// The new shell (implementation_plan.md section 57). Its own page, so the current app is untouched.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import 'material-symbols/rounded.css'
import './tokens.css'
import './shell.css'
import '../styles/gallery.css'
import './screens.css'
import '@fontsource/fredoka/700.css'
import './brand.css'
import './tournament/tournament.css'
import './sound/sound.css'
import './phoneLayout.css'
import { Shell } from './Shell'
import { startTheme } from './theme'
import { startRainbowPulse } from './rainbowPulse'
import { engineForTests, startEngineSettings } from './engine'
import { startLogs } from './logs'

window.addEventListener('error', (e) => {
  console.error('WINDOW ERROR:', e.message, e.error?.stack || e.error)
})
window.addEventListener('unhandledrejection', (e) => {
  console.error('PROMISE REJECTION:', e.reason?.stack || e.reason)
})

startLogs()
startTheme()
startRainbowPulse()
startEngineSettings()
if (import.meta.env.DEV) (window as unknown as { shellEngine: unknown }).shellEngine = engineForTests

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
