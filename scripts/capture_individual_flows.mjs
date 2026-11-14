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
    '--user-data-dir=C:\\Users\\Lenovo\\AppData\\Local\\Temp\\edge_cap_' + Date.now(),
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
      await sleep(300)
      const res = await send('Page.captureScreenshot', { format: 'png' })
      if (res.result?.data) {
        writeFileSync(path.join(OUT_DIR, filename), Buffer.from(res.result.data, 'base64'))
        console.log(`[SNAP] Saved: ${filename}`)
      } else {
        console.error(`[SNAP] Failed to capture ${filename}`)
      }
    }

    // Helper to reload app fresh
    async function loadApp() {
      await send('Page.navigate', { url: 'http://127.0.0.1:5173/' })
      await sleep(2000)
    }

    // ==========================================
    // 1. MAIN MENU & QUESTIONNAIRE FLOW
    // ==========================================
    console.log('\n--- 1. Testing Questionnaire Flow ---')
    await loadApp()
    await snap('hp_ui_01_main_menu.png')

    // Click START
    await evaluate(`
      const btn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('START'));
      if (btn) btn.click();
    `)
    await sleep(800)

    // In case reuse modal appears, click Redo
    await evaluate(`
      const redo = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Redo Questionnaire'));
      if (redo) redo.click();
    `)
    await sleep(800)

    // Questionnaire Sheet 1 (Listening On)
    const title1 = await evaluate(`document.querySelector('.paper-question')?.innerText`)
    console.log('Sheet 1 Question:', title1)
    await snap('hp_ui_02_sheet1_listening_on.png')

    // Click Headphones card
    await evaluate(`
      const cards = Array.from(document.querySelectorAll('.paper-choice-card'));
      const hp = cards.find(c => c.innerText.includes('Headphones'));
      if (hp) hp.click();
    `)
    await sleep(1000)

    // Questionnaire Sheet 2 (Which Headphones)
    const title2 = await evaluate(`document.querySelector('.paper-question')?.innerText`)
    console.log('Sheet 2 Question:', title2)
    await snap('hp_ui_03_sheet2_which_headphones.png')

    // Type Sennheiser HD 600 in search box
    await evaluate(`
      const input = document.querySelector('.paper-picker-box input');
      if (input) {
        input.focus();
        input.value = 'Sennheiser HD 600';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(800)
    await snap('hp_ui_04_sheet2_search_dropdown.png')

    // Select the first suggestion
    await evaluate(`
      const item = document.querySelector('.iem-picker-dropdown button');
      if (item) item.click();
    `)
    await sleep(800)

    // Questionnaire Sheet 3 (Sound Feelings)
    const title3 = await evaluate(`document.querySelector('.paper-question')?.innerText`)
    console.log('Sheet 3 Question:', title3)
    await snap('hp_ui_05_sheet3_sound_feelings.png')

    // ==========================================
    // 2. GALLERY (RECORD CRATE) FLOW
    // ==========================================
    console.log('\n--- 2. Testing Gallery Flow ---')
    await loadApp()

    // Click GALLERY on main menu
    await evaluate(`
      const btn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('GALLERY'));
      if (btn) btn.click();
    `)
    await sleep(2000)
    await snap('hp_ui_06_gallery_default.png')

    // Switch to IEM Browser tab inside Gallery (or check kind buttons)
    // Let's see what tabs or buttons exist in Gallery
    const galleryButtons = await evaluate(`
      Array.from(document.querySelectorAll('button')).map(b => b.innerText.trim()).filter(Boolean)
    `)
    console.log('Gallery buttons:', galleryButtons.slice(0, 15))

    // Click "Headphones" filter chip
    await evaluate(`
      const hpChip = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Headphones');
      if (hpChip) hpChip.click();
    `)
    await sleep(1200)
    await snap('hp_ui_07_gallery_headphones_selected.png')

    // Click "Open-back" sub-filter if present
    await evaluate(`
      const openBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.trim() === 'Open-back' || b.innerText.trim() === 'Open');
      if (openBtn) openBtn.click();
    `)
    await sleep(1000)
    await snap('hp_ui_08_gallery_open_back.png')

    // Click on the first headphone item to show detail preview panel
    await evaluate(`
      const row = document.querySelector('.iem-browser-row, .iem-row, .iem-grid-card, .iem-item');
      if (row) row.click();
    `)
    await sleep(1000)
    await snap('hp_ui_09_gallery_headphone_detail.png')

    // ==========================================
    // 3. SETTINGS FLOW (Fit & Seal & Ear Gain)
    // ==========================================
    console.log('\n--- 3. Testing Settings Flow ---')
    await loadApp()

    // Click SETTINGS on main menu
    await evaluate(`
      const btn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('SETTINGS'));
      if (btn) btn.click();
    `)
    await sleep(1500)
    await snap('hp_ui_10_settings_hub.png')

    // Click Fit & seal
    await evaluate(`
      const fitCard = Array.from(document.querySelectorAll('button, .set-test-card')).find(b => b.innerText.includes('Fit & seal'));
      if (fitCard) fitCard.click();
    `)
    await sleep(1000)
    await snap('hp_ui_11_settings_fit_eargain.png')

    // Click Hearing check
    await evaluate(`
      const hcCard = Array.from(document.querySelectorAll('button, .set-test-card')).find(b => b.innerText.includes('Hearing check'));
      if (hcCard) hcCard.click();
    `)
    await sleep(1000)
    await snap('hp_ui_12_settings_hearing_check.png')

    // ==========================================
    // 4. TOURNAMENT SETUP (Step 0 Who's Competing)
    // ==========================================
    console.log('\n--- 4. Testing Tournament Setup Flow ---')
    await loadApp()

    // Click START
    await evaluate(`
      const btn = Array.from(document.querySelectorAll('.menu-sticker-btn')).find(b => b.innerText.includes('START'));
      if (btn) btn.click();
    `)
    await sleep(800)

    // If reuse modal, click "Yes (Skip to Bracket Setup)"
    await evaluate(`
      const yes = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Skip to Bracket Setup') || b.innerText.includes('Yes'));
      if (yes) yes.click();
    `)
    await sleep(1500)

    // Check what step is active
    const stepHeading = await evaluate(`document.querySelector('.setup-heading')?.innerText`)
    console.log('Tournament Step Heading:', stepHeading)
    await snap('hp_ui_13_tournament_step0_candidates.png')

    // Click HEADPHONES in Step 0
    await evaluate(`
      const hpBtn = Array.from(document.querySelectorAll('.size-big-btn, button')).find(b => b.innerText.includes('HEADPHONES'));
      if (hpBtn) hpBtn.click();
    `)
    await sleep(1000)
    await snap('hp_ui_14_tournament_hp_selected.png')

    // Click "Open back" filter
    await evaluate(`
      const obBtn = Array.from(document.querySelectorAll('.hp-type-row button, button')).find(b => b.innerText.includes('Open back'));
      if (obBtn) obBtn.click();
    `)
    await sleep(800)
    await snap('hp_ui_15_tournament_open_back_selected.png')

    // Click Continue
    await evaluate(`
      const cont = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Continue'));
      if (cont) cont.click();
    `)
    await sleep(1000)
    await snap('hp_ui_16_tournament_step1_size.png')

    // Select 8 Contenders
    await evaluate(`
      const size8 = Array.from(document.querySelectorAll('.size-big-btn, button')).find(b => b.innerText.trim().startsWith('8'));
      if (size8) size8.click();
    `)
    await sleep(1500)
    await snap('hp_ui_17_tournament_step2_roster.png')

    // Click "Enter the Bracket" or "Start Tournament" if available
    await evaluate(`
      const enter = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Enter the Bracket') || b.innerText.includes('Start'));
      if (enter) enter.click();
    `)
    await sleep(2000)
    await snap('hp_ui_18_tournament_bracket_view.png')

    ws.close()
    console.log('\n[DONE] All 18 flows captured successfully!')
  } finally {
    edge.kill()
  }
}

runCapture().catch((err) => {
  console.error('Fatal error during capture:', err)
  process.exit(1)
})

