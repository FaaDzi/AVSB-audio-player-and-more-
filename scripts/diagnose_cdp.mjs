import { spawn } from 'node:child_process'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222

const proc = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_diag_profile',
  'http://127.0.0.1:5173/'
], { detached: false })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      if (list && list[0] && list[0].webSocketDebuggerUrl) {
        return list[0].webSocketDebuggerUrl
      }
    } catch {}
    await sleep(250)
  }
  throw new Error('Could not connect to Edge DevTools port')
}

async function main() {
  try {
    const wsUrl = await getWsUrl()
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    let id = 1
    const pending = new Map()
    ws.onmessage = (event) => {
      const text = typeof event.data === 'string' ? event.data : event.data.toString('utf-8')
      const msg = JSON.parse(text)
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    }

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const msgId = id++
        pending.set(msgId, resolve)
        ws.send(JSON.stringify({ id: msgId, method, params }))
      })
    }

    await send('Page.enable')
    await send('Runtime.enable')

    console.log('Waiting 3s for page load...')
    await sleep(3000)

    const r = await send('Runtime.evaluate', {
      expression: `(() => {
        return {
          title: document.title,
          url: window.location.href,
          text: document.body.innerText.slice(0, 300),
          buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)
        };
      })()`,
      returnByValue: true
    })
    console.log('Runtime.evaluate raw result:', JSON.stringify(r, null, 2))

    ws.close()
  } finally {
    proc.kill()
  }
}

main().catch(err => {
  console.error('Diag error:', err)
  proc.kill()
  process.exit(1)
})

