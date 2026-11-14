import { spawn } from 'node:child_process'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_diag_' + Date.now(),
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

  // Capture console errors
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.method === 'Runtime.consoleAPICalled' || m.method === 'Runtime.exceptionThrown') {
      console.log('[BROWSER CONSOLE]', JSON.stringify(m.params))
    }
  })

  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2500)

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  console.log('Main menu buttons:', await evalCode(`Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)`))

  // Click GALLERY
  console.log('Clicking GALLERY...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('GALLERY'));
    if (b) b.click();
  `)
  await sleep(2000)
  console.log('After Gallery click, current text:', await evalCode(`document.body.innerText.slice(0, 300)`))

  // In Gallery, click ◎ IEMS tab
  console.log('Clicking ◎ IEMS...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('IEMS'));
    if (b) b.click();
  `)
  await sleep(1500)
  console.log('After IEMS tab click, current text:', await evalCode(`document.body.innerText.slice(0, 400)`))

  // Now click Headphones
  console.log('Clicking Headphones chip...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Headphones');
    if (b) b.click();
  `)
  await sleep(1500)
  console.log('After Headphones chip, filter text:', await evalCode(`document.body.innerText.slice(0, 400)`))

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

