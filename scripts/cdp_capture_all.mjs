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
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_headphone_profile',
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
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })

    console.log('Waiting 3s for page load...')
    await sleep(3000)

    async function capture(filename) {
      console.log('Capturing:', filename)
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (!res.result || !res.result.data) {
        console.error('Failed screenshot res:', res)
        return
      }
      const filepath = path.join(OUT_DIR, filename)
      writeFileSync(filepath, Buffer.from(res.result.data, 'base64'))
      console.log('Saved screenshot:', filename)
    }

    async function evalCode(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return r.result?.value
    }

    // Capture 1: current state
    await capture('hp_ui_01_current.png')

    const currentText = await evalCode(`document.body.innerText.slice(0, 300)`)
    console.log('Current page snippet:', currentText)

    // Let's click on "Gallery" navigation tab/button
    console.log('Looking for Gallery button...')
    await evalCode(`
      const btn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Gallery') || b.innerText.includes('Crate'));
      if (btn) btn.click();
    `)
    await sleep(2000)
    await capture('hp_ui_02_gallery.png')

    // Click "Headphones" chip in Gallery
    console.log('Looking for Headphones chip...')
    await evalCode(`
      const chip = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Headphones');
      if (chip) chip.click();
    `)
    await sleep(2000)
    await capture('hp_ui_03_gallery_headphones.png')

    // Click a headphone row to view details
    console.log('Opening headphone detail...')
    await evalCode(`
      const row = document.querySelector('.iem-row');
      if (row) row.click();
    `)
    await sleep(2000)
    await capture('hp_ui_04_gallery_detail.png')

    // Click on "Settings"
    console.log('Opening Settings...')
    await evalCode(`
      const sbtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Settings'));
      if (sbtn) sbtn.click();
    `)
    await sleep(2000)
    await capture('hp_ui_05_settings.png')

    // Click Fit & seal
    console.log('Opening Fit & seal...')
    await evalCode(`
      const card = Array.from(document.querySelectorAll('.set-test-card, button')).find(b => b.innerText.includes('Fit & seal'));
      if (card) card.click();
    `)
    await sleep(2000)
    await capture('hp_ui_06_settings_eargain.png')

    // Click Reset / Start over to see Questionnaire Sheet 1
    console.log('Clicking Start Over / Reset...')
    await evalCode(`
      // Switch to data tab or reset button
      const rbtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset') || b.innerText.includes('Start over'));
      if (rbtn) rbtn.click();
    `)
    await sleep(1000)
    await evalCode(`
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Reset everything') || b.innerText.includes('Yes, reset'));
      if (confirmBtn) confirmBtn.click();
    `)
    await sleep(2000)
    await capture('hp_ui_07_questionnaire_sheet1.png')

    // Click Headphones on Sheet 1
    console.log('Clicking Headphones on Sheet 1...')
    await evalCode(`
      const hpChoice = Array.from(document.querySelectorAll('.paper-choice-card')).find(b => b.innerText.includes('Headphones'));
      if (hpChoice) hpChoice.click();
    `)
    await sleep(2000)
    await capture('hp_ui_08_questionnaire_sheet2_hp.png')

    // Type Sennheiser to search
    console.log('Searching Sennheiser...')
    await evalCode(`
      const inp = document.querySelector('.paper-picker-box input');
      if (inp) {
        inp.focus();
        inp.value = 'Sennheiser HD 600';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(1000)
    await capture('hp_ui_09_questionnaire_search.png')

    ws.close()
    console.log('All captures done!')
  } finally {
    proc.kill()
  }
}

main().catch((err) => {
  console.error('Capture error:', err)
  proc.kill()
  process.exit(1)
})

