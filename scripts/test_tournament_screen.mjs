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
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_tour_' + Date.now(),
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

  // Log console errors from browser
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.exceptionThrown') {
      console.error('[BROWSER EXCEPTION]', JSON.stringify(m.params.exceptionDetails))
    }
  })

  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(1500)

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  // Set iem-prefs-v1
  await evalCode(`
    localStorage.setItem('iem-prefs-v1', JSON.stringify({
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
  await sleep(2200)

  console.log('Main Menu text:\n', await evalCode(`document.body.innerText.slice(0, 300)`))

  // Click START
  console.log('Clicking START...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
    if (b) b.click();
  `)
  await sleep(1000)
  console.log('Modal text:\n', await evalCode(`document.body.innerText.slice(0, 400)`))

  // In modal, click "Yes (Skip to Bracket Setup)"
  console.log('Clicking Yes (Skip to Bracket Setup)...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Skip to Bracket Setup') || x.innerText.includes('Yes'));
    if (b) b.click();
  `)
  await sleep(1500)
  console.log('After Skip, text:\n', await evalCode(`document.body.innerText.slice(0, 600)`))

  // Take screenshot
  const s = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync('C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced\\tour_step0_direct.png', Buffer.from(s.result.data, 'base64'))

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

