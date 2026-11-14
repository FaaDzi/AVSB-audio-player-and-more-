import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const OUT_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced'

mkdirSync(OUT_DIR, { recursive: true })

const proc = spawn(EDGE_PATH, [
  '--headless=new',
  '--disable-gpu',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_cdp_profile',
  'about:blank'
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
    console.log('Connected to CDP:', wsUrl)
    const ws = new WebSocket(wsUrl)
    await new Promise((res, rej) => {
      ws.onopen = res
      ws.onerror = rej
    })

    let id = 1
    const pending = new Map()
    ws.onmessage = (event) => {
      try {
        const text = typeof event.data === 'string' ? event.data : event.data.toString('utf-8')
        const msg = JSON.parse(text)
        if (msg.id && pending.has(msg.id)) {
          pending.get(msg.id)(msg)
          pending.delete(msg.id)
        }
      } catch (e) {
        console.error('onmessage parse error:', e)
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

    await send('Emulation.setDeviceMetricsOverride', {
      width: 1280,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false
    })

    console.log('Navigating to http://127.0.0.1:5173/ ...')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2500)

    async function capture(filename) {
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (!res.result || !res.result.data) {
        console.error('Failed screenshot res:', res)
        return
      }
      const filepath = path.join(OUT_DIR, filename)
      writeFileSync(filepath, Buffer.from(res.result.data, 'base64'))
      console.log('Saved screenshot:', filename)
    }

    // 1. Initial screen
    await capture('headphone_01_initial.png')

    // Helper to evaluate and click or inspect
    async function evalCode(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return r.result?.value
    }

    const initialInfo = await evalCode(`
      ({
        title: document.title,
        textSnippet: document.body.innerText.slice(0, 300),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)
      })
    `)
    console.log('Initial page info:', JSON.stringify(initialInfo, null, 2))

    ws.close()
  } finally {
    proc.kill()
  }
}

main().catch((err) => {
  console.error('CDP Error:', err)
  proc.kill()
  process.exit(1)
})

