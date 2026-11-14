import { spawn } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9222
const OUT_DIR = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced'
mkdirSync(OUT_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function run() {
  const edge = spawn(EDGE_PATH, [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    `--remote-debugging-port=${PORT}`,
    '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_ui_' + Date.now(),
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

    // 1. QUESTIONNAIRE
    console.log('--- Navigating to Questionnaire ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2500)
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
      if (b) b.click();
    `)
    await sleep(1000)
    await snap('hp_ui_01_questionnaire_listening_on.png')

    // Click Headphones
    await evaluate(`
      const c = Array.from(document.querySelectorAll('.paper-choice-card')).find(x => x.innerText.includes('Headphones'));
      if (c) c.click();
    `)
    await sleep(1200)
    await snap('hp_ui_02_questionnaire_which_headphones.png')

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
    await snap('hp_ui_03_questionnaire_search_sennheiser.png')

    // 2. GALLERY
    console.log('--- Navigating to Gallery ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2000)
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('GALLERY'));
      if (b) b.click();
    `)
    await sleep(2000)

    // Click the second .gallery-tab (◎ IEMS)
    await evaluate(`
      const tabs = document.querySelectorAll('.gallery-tab');
      if (tabs.length > 1) tabs[1].click();
    `)
    await sleep(1500)
    await snap('hp_ui_04_gallery_iems_tab.png')

    // Click Headphones filter chip
    await evaluate(`
      const chips = Array.from(document.querySelectorAll('.iem-filter-bar button, .iem-browser button'));
      const hp = chips.find(b => b.innerText.trim() === 'Headphones');
      if (hp) hp.click();
    `)
    await sleep(1200)
    await snap('hp_ui_05_gallery_headphones_filter.png')

    // Click Open-back filter chip and select a headphone
    await evaluate(`
      const chips = Array.from(document.querySelectorAll('button'));
      const ob = chips.find(b => b.innerText.trim() === 'Open-back' || b.innerText.trim() === 'Open');
      if (ob) ob.click();
      const rows = document.querySelectorAll('.iem-row');
      if (rows.length > 0) rows[0].click();
    `)
    await sleep(1200)
    await snap('hp_ui_06_gallery_open_back_detail.png')

    // 3. SETTINGS
    console.log('--- Navigating to Settings ---')
    // Set listening gear to an IEM so earGainDb slider is shown
    await evaluate(`
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
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('SETTINGS'));
      if (b) b.click();
    `)
    await sleep(2000)

    // Click "Test your gear"
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-nav-row, button')).find(x => x.innerText.includes('Test your gear'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('hp_ui_07_settings_test_your_gear.png')

    // Click "Fit & seal"
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-test-card, button')).find(x => x.innerText.includes('Fit & seal'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('hp_ui_08_settings_fit_ear_gain.png')

    // Go back and click "Hearing check"
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('←') || x.innerText.includes('Back') || x.className.includes('back'));
      if (b) b.click();
    `)
    await sleep(600)
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.set-test-card, button')).find(x => x.innerText.includes('Hearing check'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('hp_ui_09_settings_hearing_check.png')

    // 4. TOURNAMENT SETUP
    console.log('--- Navigating to Tournament Setup ---')
    await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
    await sleep(2000)
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(x => x.innerText.includes('START'));
      if (b) b.click();
    `)
    await sleep(1000)
    // Modal: Yes (Skip to Bracket Setup)
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Skip to Bracket Setup') || x.innerText.includes('Yes'));
      if (b) b.click();
    `)
    await sleep(1500)
    await snap('hp_ui_10_tournament_step0_kind.png')

    // Select Open-back
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.hp-type-row button, button')).find(x => x.innerText.includes('Open back'));
      if (b) b.click();
    `)
    await sleep(800)
    await snap('hp_ui_11_tournament_step0_open_back.png')

    // Click Continue with Headphones
    await evaluate(`
      const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.includes('Continue with Headphones'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('hp_ui_12_tournament_step1_size.png')

    // Click 8 Contenders
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.trim().startsWith('8'));
      if (b) b.click();
    `)
    await sleep(1200)
    await snap('hp_ui_13_tournament_step2_who_picks.png')

    // Click "Let the Game Pick"
    await evaluate(`
      const b = Array.from(document.querySelectorAll('.size-big-btn, button')).find(x => x.innerText.includes('Let the Game Pick') || x.innerText.includes('Auto'));
      if (b) b.click();
    `)
    await sleep(1800)
    await snap('hp_ui_14_tournament_step3_headphone_roster.png')

    ws.close()
    console.log('ALL SCREENSHOTS CAPTURED CLEANLY!')
  } finally {
    edge.kill()
  }
}

run().catch((e) => {
  console.error(e)
  edge.kill()
})

