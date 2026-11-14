import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_inspect2_' + Date.now(),
  'about:blank'
])

async function run() {
  await sleep(1000)
  const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
  const list = await res.json()
  const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'))
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => ws.onopen = r)

  let id = 1
  const pending = new Map()
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }
  const send = (m, p = {}) => new Promise((r) => {
    const i = id++
    pending.set(i, r)
    ws.send(JSON.stringify({ id: i, method: m, params: p }))
  })

  await send('Page.enable')
  await send('Runtime.enable')

  // Set an IEM first in localStorage so Test Your Gear is unlocked!
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(1500)

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  await evalCode(`
    localStorage.setItem('prefs', JSON.stringify({
      currentId: 'tangzu-waner-s.g',
      listeningOn: 'iem',
      mode: 'iem',
      budget: [0, 500],
      flavour: 'neutral',
      compare: 'headphones',
      hpType: 'any',
      blind: true
    }));
  `)
  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2000)

  // Click SETTINGS
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('SETTINGS'));
    if (b) b.click();
  `)
  await sleep(1500)

  // Click "Test your gear"
  console.log('Clicking Test your gear nav row...')
  await evalCode(`
    const rows = Array.from(document.querySelectorAll('.set-nav-row'));
    const t = rows.find(r => r.innerText.includes('Test your gear'));
    if (t) t.click();
  `)
  await sleep(1000)
  console.log('After Test your gear click:\n', await evalCode(`document.body.innerText.slice(0, 500)`))

  // Capture screenshot of tests list
  const s1 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced\\real_settings_01_tests_list.png', Buffer.from(s1.result.data, 'base64'))

  // Click Fit & seal
  console.log('Clicking Fit & seal card...')
  await evalCode(`
    const cards = Array.from(document.querySelectorAll('.set-test-card, button'));
    const fit = cards.find(c => c.innerText.includes('Fit & seal'));
    if (fit) fit.click();
  `)
  await sleep(1000)
  console.log('Fit & seal innerText:\n', await evalCode(`document.body.innerText.slice(0, 800)`))

  const s2 = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced\\real_settings_02_ear_gain_slider.png', Buffer.from(s2.result.data, 'base64'))

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

