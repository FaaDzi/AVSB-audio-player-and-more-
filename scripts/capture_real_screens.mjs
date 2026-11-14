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
  '--disable-extensions',
  `--remote-debugging-port=${PORT}`,
  '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_clean_profile_' + Date.now(),
  'about:blank'
], { detached: false })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getWsUrl() {
  for (let i = 0; i < 20; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'))
      if (page && page.webSocketDebuggerUrl) return page.webSocketDebuggerUrl
    } catch {}
    await sleep(250)
  }
  throw new Error('Could not connect to Edge DevTools port')
}

async function main() {
  try {
    const wsUrl = await getWsUrl()
    console.log('Connected to CDP page target:', wsUrl)
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
      } catch (e) {}
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
      return r.result?.result?.value
    }

    async function capture(filename) {
      console.log('Capturing:', filename)
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (!res.result || !res.result.data) return
      const filepath = path.join(OUT_DIR, filename)
      writeFileSync(filepath, Buffer.from(res.result.data, 'base64'))
      console.log('Saved:', filename)
    }

    console.log('Navigating to app...')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2500)

    // Capture 0: Main Menu
    await capture('headphone_00_main_menu.png')

    // Click START on main menu
    console.log('Clicking START on Main Menu...')
    await evalCode(`
      const btn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('START'));
      if (btn) btn.click();
    `)
    await sleep(800)

    // Handle "Use your last answers?" modal if present
    await evalCode(`
      const redo = Array.from(document.querySelectorAll('.paper-pill-btn, button')).find(b => b.innerText.includes('Redo Questionnaire'));
      if (redo) redo.click();
    `)
    await sleep(1000)

    // Capture 1: Questionnaire Sheet 1 (What are you listening on?)
    await capture('headphone_01_sheet1_listening_on.png')

    // Click "Headphones" card
    console.log('Clicking Headphones choice card...')
    await evalCode(`
      const cards = Array.from(document.querySelectorAll('.paper-choice-card'));
      const hp = cards.find(c => c.innerText.includes('Headphones'));
      if (hp) hp.click();
    `)
    await sleep(1200)

    // Capture 2: Sheet 2: Which headphones are you wearing?
    await capture('headphone_02_sheet2_which_headphones.png')

    // Search "Sennheiser HD 600"
    console.log('Typing Sennheiser HD 600 into search...')
    await evalCode(`
      const inp = document.querySelector('.paper-picker-box input');
      if (inp) {
        inp.focus();
        inp.value = 'Sennheiser HD 600';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(800)
    await capture('headphone_03_sheet2_search_dropdown.png')

    // Click suggestion
    console.log('Selecting Sennheiser HD 600...')
    await evalCode(`
      const item = document.querySelector('.iem-picker-dropdown button, .iem-picker-dropdown li');
      if (item) item.click();
    `)
    await sleep(1000)

    // Advance to Sheet 3 / Feelings
    await capture('headphone_04_sheet3_feelings.png')

    // Now return to Main Menu
    console.log('Returning to main menu...')
    await evalCode(`
      const esc = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Esc') || b.innerText.includes('QUIT') || b.innerText.includes('Back'));
      if (esc) esc.click();
    `)
    await sleep(800)

    // Go to GALLERY
    console.log('Opening Gallery...')
    await evalCode(`
      const gal = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('GALLERY'));
      if (gal) gal.click();
    `)
    await sleep(2000)
    await capture('headphone_05_gallery_all.png')

    // Click "Headphones" chip in Gallery
    console.log('Clicking Headphones chip in Gallery...')
    await evalCode(`
      const chips = Array.from(document.querySelectorAll('button'));
      const hpChip = chips.find(b => b.innerText.trim() === 'Headphones');
      if (hpChip) hpChip.click();
    `)
    await sleep(1500)
    await capture('headphone_06_gallery_headphones_only.png')

    // Click "Open-back" filter in Gallery
    console.log('Selecting Open-back filter...')
    await evalCode(`
      const openBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Open-back' || b.innerText.trim() === 'Open');
      if (openBtn) openBtn.click();
    `)
    await sleep(1000)
    await capture('headphone_07_gallery_open_back.png')

    // Click first headphone to open detail card
    console.log('Opening headphone detail card...')
    await evalCode(`
      const firstRow = document.querySelector('.iem-row');
      if (firstRow) firstRow.click();
    `)
    await sleep(1500)
    await capture('headphone_08_gallery_headphone_detail.png')

    // Close detail or go to SETTINGS
    console.log('Navigating to Settings...')
    await evalCode(`
      const esc = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Esc') || b.innerText.includes('Back') || b.innerText.includes('×'));
      if (esc) esc.click();
    `)
    await sleep(500)
    await evalCode(`
      const esc2 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Esc') || b.innerText.includes('QUIT'));
      if (esc2) esc2.click();
    `)
    await sleep(800)
    await evalCode(`
      const setBtn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('SETTINGS'));
      if (setBtn) setBtn.click();
    `)
    await sleep(1500)
    await capture('headphone_09_settings_hub.png')

    // In Settings, click Fit & seal
    console.log('Opening Fit & seal in Settings...')
    await evalCode(`
      const fitCard = Array.from(document.querySelectorAll('.set-test-card')).find(b => b.innerText.includes('Fit & seal'));
      if (fitCard) fitCard.click();
    `)
    await sleep(1200)
    await capture('headphone_10_settings_fit_eargain.png')

    // Open Hearing check
    console.log('Opening Hearing check in Settings...')
    await evalCode(`
      const back = document.querySelector('.settings-pane-back, .back-btn');
      if (back) back.click();
    `)
    await sleep(500)
    await evalCode(`
      const hc = Array.from(document.querySelectorAll('.set-test-card')).find(b => b.innerText.includes('Hearing check'));
      if (hc) hc.click();
    `)
    await sleep(1200)
    await capture('headphone_11_settings_hearing_check.png')

    // Now go to TOURNAMENT SETUP / CANDIDATES
    console.log('Navigating to Tournament Setup...')
    await evalCode(`
      const esc = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Esc') || b.innerText.includes('Back'));
      if (esc) esc.click();
    `)
    await sleep(500)
    await evalCode(`
      const esc2 = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Esc') || b.innerText.includes('QUIT'));
      if (esc2) esc2.click();
    `)
    await sleep(800)
    await evalCode(`
      const start = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('START'));
      if (start) start.click();
    `)
    await sleep(800)
    await evalCode(`
      const skip = Array.from(document.querySelectorAll('.paper-stamp-btn, button')).find(b => b.innerText.includes('Skip to Bracket Setup') || b.innerText.includes('Yes'));
      if (skip) skip.click();
    `)
    await sleep(1500)
    await capture('headphone_12_tournament_who_competes.png')

    // Select HEADPHONES in Step 0
    console.log('Selecting HEADPHONES in Step 0...')
    await evalCode(`
      const hpBtn = Array.from(document.querySelectorAll('.size-big-btn, button')).find(b => b.innerText.includes('HEADPHONES'));
      if (hpBtn) hpBtn.click();
    `)
    await sleep(1000)
    await capture('headphone_13_tournament_hp_selected.png')

    // Click Open back button in hp-type-row
    console.log('Clicking Open back filter in Tournament setup...')
    await evalCode(`
      const obBtn = Array.from(document.querySelectorAll('.hp-type-row button')).find(b => b.innerText.includes('Open back'));
      if (obBtn) obBtn.click();
    `)
    await sleep(800)
    await capture('headphone_14_tournament_open_back_type.png')

    // Click Continue
    console.log('Continuing to Size step...')
    await evalCode(`
      const contBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue'));
      if (contBtn) contBtn.click();
    `)
    await sleep(1200)
    await capture('headphone_15_tournament_size_step.png')

    // Click 8 Contenders
    console.log('Selecting 8 contenders...')
    await evalCode(`
      const btn8 = Array.from(document.querySelectorAll('.size-big-btn, button')).find(b => b.innerText.includes('8'));
      if (btn8) btn8.click();
    `)
    await sleep(1500)
    await capture('headphone_16_tournament_headphone_roster.png')

    ws.close()
    console.log('All real headphone screens captured successfully!')
  } finally {
    proc.kill()
  }
}

main().catch((err) => {
  console.error('Capture error:', err)
  proc.kill()
  process.exit(1)
})

