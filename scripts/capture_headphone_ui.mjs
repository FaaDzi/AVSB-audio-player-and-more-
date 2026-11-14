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
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })

    async function evalCode(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
      return r.result?.value
    }

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

    console.log('Navigating to http://127.0.0.1:5173/ ...')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2500)

    // Capture Screen 1: App home / Questionnaire Sheet 1
    // Reset questionnaire to sheet 1 if in tournament or gallery
    await evalCode(`
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Restart') || b.innerText.includes('Start over'));
      if (btn) btn.click();
    `)
    await sleep(500)

    await capture('hp_ui_01_questionnaire_sheet1.png')

    // Click "Headphones" on Sheet 1
    console.log('Clicking "Headphones" choice card...')
    await evalCode(`
      const cards = Array.from(document.querySelectorAll('.paper-choice-card'));
      const hpCard = cards.find(c => c.innerText.includes('Headphones'));
      if (hpCard) hpCard.click();
    `)
    await sleep(1000)

    // Capture Screen 2: Sheet 2 with Headphones
    await capture('hp_ui_02_questionnaire_headphones.png')

    // Search for a headphone, e.g. "Sennheiser HD 600"
    console.log('Typing Sennheiser HD 600 in search...')
    await evalCode(`
      const input = document.querySelector('.paper-picker-box input');
      if (input) {
        input.focus();
        input.value = 'Sennheiser HD 600';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(800)
    await capture('hp_ui_03_questionnaire_hp_search.png')

    // Select the first suggestion
    await evalCode(`
      const item = document.querySelector('.iem-picker-dropdown li, .iem-picker-dropdown button, .picker-row');
      if (item) item.click();
    `)
    await sleep(1000)

    // Go to Tournament Setup / Candidates view
    // Let's navigate to Gallery first to inspect headphone gallery
    console.log('Navigating to Gallery...')
    await evalCode(`
      const galBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Gallery') || b.innerText.includes('Crate'));
      if (galBtn) galBtn.click();
    `)
    await sleep(1500)
    await capture('hp_ui_04_gallery_initial.png')

    // In Gallery, click "Headphones" filter chip
    console.log('Filtering Gallery by Headphones...')
    await evalCode(`
      const hpChip = Array.from(document.querySelectorAll('.gallery-kind-chip, .chip, button')).find(b => b.innerText.trim() === 'Headphones');
      if (hpChip) hpChip.click();
    `)
    await sleep(1000)
    await capture('hp_ui_05_gallery_headphones_list.png')

    // Click on a headphone row in Gallery to open its details
    console.log('Opening detail view for first headphone...')
    await evalCode(`
      const row = document.querySelector('.iem-row');
      if (row) row.click();
    `)
    await sleep(1200)
    await capture('hp_ui_06_gallery_headphone_detail.png')

    // Now navigate to Settings
    console.log('Navigating to Settings...')
    await evalCode(`
      const setBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Settings'));
      if (setBtn) setBtn.click();
    `)
    await sleep(1500)
    await capture('hp_ui_07_settings_main.png')

    // Open "Fit & seal" test or Ear Gain calibration
    console.log('Opening Fit & seal...')
    await evalCode(`
      const fitCard = Array.from(document.querySelectorAll('.set-test-card, .settings-tab-pill, button')).find(b => b.innerText.includes('Fit & seal') || b.innerText.includes('Fit'));
      if (fitCard) fitCard.click();
    `)
    await sleep(1000)
    await capture('hp_ui_08_settings_eargain.png')

    // Open "Hearing check" in Settings
    console.log('Opening Hearing check...')
    await evalCode(`
      const hc = Array.from(document.querySelectorAll('.set-test-card, button')).find(b => b.innerText.includes('Hearing check'));
      if (hc) hc.click();
    `)
    await sleep(1000)
    await capture('hp_ui_09_settings_hearing_check.png')

    // Now test Tournament Setup / Candidates view (who's competing step)
    console.log('Navigating to Bracket setup...')
    await evalCode(`
      const tourBtn = Array.from(document.querySelectorAll('button, a')).find(b => b.innerText.includes('Tournament') || b.innerText.includes('Bracket') || b.innerText.includes('VS'));
      if (tourBtn) tourBtn.click();
    `)
    await sleep(1500)
    await capture('hp_ui_10_tournament_setup.png')

    ws.close()
  } finally {
    proc.kill()
  }
}

main().catch((err) => {
  console.error('Capture error:', err)
  proc.kill()
  process.exit(1)
})

