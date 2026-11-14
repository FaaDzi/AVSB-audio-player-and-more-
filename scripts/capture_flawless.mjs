import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const OUT_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced'
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function runCapture() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_flawless_' + Date.now(),
    'about:blank'
  ])

  try {
    let wsUrl = null
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/json/list`)
        const list = await res.json()
        const page = list.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension://'))
        if (page && page.webSocketDebuggerUrl) {
          wsUrl = page.webSocketDebuggerUrl
          break
        }
      } catch {}
      await sleep(200)
    }

    if (!wsUrl) throw new Error('Could not find Edge debug URL')

    const ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.onopen = resolve
      ws.onerror = reject
    })

    let reqId = 1
    const pending = new Map()
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data.toString())
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg)
        pending.delete(msg.id)
      }
    }

    function send(method, params = {}) {
      return new Promise((resolve) => {
        const id = reqId++
        pending.set(id, resolve)
        ws.send(JSON.stringify({ id, method, params }))
      })
    }

    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1366,
      height: 850,
      deviceScaleFactor: 1,
      mobile: false
    })

    async function evaluate(code) {
      const res = await send('Runtime.evaluate', { expression: code, returnByValue: true })
      return res.result?.result?.value
    }

    async function snap(filename) {
      console.log(`[SNAP] Capturing ${filename}...`)
      await sleep(400)
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (res.result?.data) {
        writeFileSync(path.join(OUT_DIR, filename), Buffer.from(res.result.data, 'base64'))
        console.log(`[SNAP] Saved: ${filename}`)
      } else {
        console.error(`[SNAP] Failed to capture ${filename}`)
      }
    }

    // =========================================================================
    // 1. QUESTIONNAIRE FLOW
    // =========================================================================
    console.log('\n--- 1. QUESTIONNAIRE FLOW ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2500)
    await snap('screen_01_main_menu.png')

    // Click START
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
      if (b) b.click();
    `)
    await sleep(1000)

    // Redo questionnaire if modal showed up
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Redo Questionnaire'));
      if (b) b.click();
    `)
    await sleep(1000)

    // Sheet 1: Listening on
    await snap('screen_02_sheet1_listening_on.png')

    // Click Headphones card
    await evaluate(`
      const c = Array.from(document.querySelectorAll('.paper-choice-card')).find(x => x.innerText.includes('Headphones'));
      if (c) c.click();
    `)
    await sleep(1200)

    // Sheet 2: Which headphones
    await snap('screen_03_sheet2_which_headphones.png')

    // Type Sennheiser HD 600
    await evaluate(`
      const inp = document.querySelector('.paper-picker-box input');
      if (inp) {
        inp.focus();
        inp.value = 'Sennheiser HD 600';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(1000)
    await snap('screen_04_sheet2_search_dropdown.png')

    // Click the item
    await evaluate(`
      const item = document.querySelector('.iem-picker-dropdown button');
      if (item) item.click();
    `)
    await sleep(1200)

    // Sheet 3: Feelings
    await snap('screen_05_sheet3_feelings.png')

    // Finish questionnaire to save profile
    // Click "Balanced / as intended" or similar chip
    await evaluate(`
      const chip = Array.from(document.querySelectorAll('.paper-chip-btn')).find(x => x.innerText.includes('Balanced'));
      if (chip) chip.click();
    `)
    await sleep(500)
    // Click Next sheet
    await evaluate(`
      const next = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Next Sheet') || x.innerText.includes('Next'));
      if (next) next.click();
    `)
    await sleep(800)

    // =========================================================================
    // 2. GALLERY FLOW (IEM & Headphone Browser)
    // =========================================================================
    console.log('\n--- 2. GALLERY FLOW ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2000)

    // Click GALLERY on main menu
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('GALLERY'));
      if (b) b.click();
    `)
    await sleep(2000)

    // Click ◎ IEMS tab in Gallery
    console.log('Clicking ◎ IEMS tab...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('IEMS'));
      if (b) b.click();
    `)
    await sleep(1500)
    await snap('screen_06_gallery_iems_tab_default.png')

    // Click "Headphones" filter chip
    console.log('Clicking Headphones filter chip...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Headphones');
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_07_gallery_headphones_active.png')

    // Click "Open-back" sub-filter
    console.log('Clicking Open-back sub-filter...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Open-back' || x.innerText.trim() === 'Open');
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_08_gallery_open_back.png')

    // Select a specific headphone (e.g. Sennheiser HD 600 or first row) to view details
    console.log('Selecting headphone row for detail view...')
    await evaluate(`
      const rows = Array.from(document.querySelectorAll('.iem-row, .iem-table tr, .iem-browser-row'));
      if (rows.length > 1) rows[1].click();
      else if (rows.length > 0) rows[0].click();
    `)
    await sleep(1200)
    await snap('screen_09_gallery_headphone_detail_pane.png')

    // =========================================================================
    // 3. SETTINGS FLOW (Gear, Tests, Ear Gain Slider)
    // =========================================================================
    console.log('\n--- 3. SETTINGS FLOW ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2000)

    // Click SETTINGS on main menu
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('SETTINGS'));
      if (b) b.click();
    `)
    await sleep(1800)
    await snap('screen_10_settings_gear_hub.png')

    // Click "Test your gear" tab
    console.log('Clicking Test your gear...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-area-btn, button')).find(x => x.innerText.includes('Test your gear'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_11_settings_tests_list.png')

    // Click "Fit & seal" test card
    console.log('Clicking Fit & seal card...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-test-card, button')).find(x => x.innerText.includes('Fit & seal'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_12_settings_fit_ear_gain_slider.png')

    // Click Back from Fit & seal
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('←') || x.innerText.includes('Back') || x.className.includes('back'));
      if (b) b.click();
    `)
    await sleep(800)

    // Click Hearing check test card
    console.log('Clicking Hearing check card...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-test-card, button')).find(x => x.innerText.includes('Hearing check'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_13_settings_hearing_check.png')

    // =========================================================================
    // 4. TOURNAMENT SETUP (Step 0 Who's Competing & Headphone Roster)
    // =========================================================================
    console.log('\n--- 4. TOURNAMENT SETUP FLOW ---')
    // Set localStorage so that tournament setup opens candidates directly with saved profile
    await evaluate(`
      localStorage.setItem('prefs', JSON.stringify({
        currentId: 'hp-sennheiser-hd-600',
        listeningOn: 'headphones',
        mode: 'iem',
        budget: [0, 500],
        flavour: 'neutral',
        compare: 'iems',
        hpType: 'any',
        blind: true
      }));
    `)
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2000)

    // Click START
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
      if (b) b.click();
    `)
    await sleep(1000)

    // In modal, click "Yes (Skip to Bracket Setup)"
    console.log('Clicking Yes (Skip to Bracket Setup)...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Skip to Bracket Setup') || x.innerText.includes('Yes'));
      if (b) b.click();
    `)
    await sleep(1500)
    await snap('screen_14_tournament_step0_choice.png')

    // Select HEADPHONES in Step 0
    console.log('Selecting HEADPHONES in Step 0...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.includes('HEADPHONES'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_15_tournament_step0_headphones_selected.png')

    // Click "Open back" filter
    console.log('Selecting Open back in Step 0...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.hp-type-row button, button')).find(x => x.innerText.includes('Open back'));
      if (b) b.click();
    `)
    await sleep(800)
    await snap('screen_16_tournament_step0_open_back.png')

    // Click Continue to Size
    console.log('Clicking Continue...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Continue'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('screen_17_tournament_step1_size.png')

    // Select 8 Contenders
    console.log('Selecting 8 Contenders...')
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.trim().startsWith('8'));
      if (b) b.click();
    `)
    await sleep(1500)
    await snap('screen_18_tournament_step3_headphone_roster.png')

    ws.close()
    console.log('\n[ALL FINISHED] 18 real web screens captured!')
  } finally {
    edge.kill()
  }
}

runCapture().catch((err) => {
  console.error('Fatal error during flawless capture:', err)
  process.exit(1)
})

