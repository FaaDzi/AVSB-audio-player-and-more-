import { spawn } from 'node:child_process'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const edge = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_inspect_' + Date.now(),
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

  await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
  await sleep(2500)

  async function evalCode(expr) {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
    return r.result?.result?.value
  }

  // Click SETTINGS
  console.log('Clicking SETTINGS...')
  await evalCode(`
    const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('SETTINGS'));
    if (b) b.click();
  `)
  await sleep(1500)
  console.log('Settings screen innerText:\n', await evalCode(`document.body.innerText`))

  edge.kill()
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

