// Offscreen screenshot capture for PC UI (Material Dark and Party Mode)
// Captures Home, Library, Tournament, Winner (Podium), and Settings
const { app, BrowserWindow, protocol } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

const DIST = path.join(__dirname, '..', 'dist-shell')
const FIXTURE_DIR = path.join(__dirname, '..', 'shell-fixture')
const OUT_DIR_BUNDLE = path.join(__dirname, '..', '..', 'reference_screenshots', 'bundle_for_ai_studio')
const OUT_DIR_ARTIFACT = 'C:\\Users\\Lenovo\\.gemini\\antigravity\\brain\\ae604c30-8b55-4422-afde-bda205c4dced\\bundle_for_ai_studio'

fs.mkdirSync(OUT_DIR_BUNDLE, { recursive: true })
fs.mkdirSync(OUT_DIR_ARTIFACT, { recursive: true })

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const url = new URL(req.url)

    // Serve fixture library so Home and Library are beautifully populated
    if (url.pathname === '/shell-host/library') {
      const fixtureFile = path.join(FIXTURE_DIR, 'library.json')
      if (fs.existsSync(fixtureFile)) {
        const fixture = JSON.parse(fs.readFileSync(fixtureFile, 'utf8'))
        return new Response(JSON.stringify({
          folders: [{ path: 'D:/Music/HipHop', subfolders: true, lastScan: Date.now() - 3600000, online: true, count: fixture.tracks.length }],
          hidden: [],
          tracks: fixture.tracks,
          scanning: null,
          version: 1,
        }), { headers: { 'content-type': 'application/json' } })
      }
    }

    // Serve cover artwork from shell-fixture/covers
    if (url.pathname === '/shell-host/cover') {
      const id = url.searchParams.get('id')
      if (id) {
        const coverCandidates = [
          path.join(FIXTURE_DIR, 'covers', `${id}.webp`),
          path.join(FIXTURE_DIR, 'covers', `${id}.jpg`),
          path.join(FIXTURE_DIR, 'covers', `${id}.png`),
        ]
        for (const candidate of coverCandidates) {
          if (fs.existsSync(candidate)) {
            return new Response(fs.readFileSync(candidate), {
              headers: { 'content-type': MIME[path.extname(candidate)] || 'image/webp' }
            })
          }
        }
      }
    }

    let p = path.join(DIST, decodeURIComponent(url.pathname))
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) {
      p = path.join(DIST, 'shell.html')
    }
    const ext = path.extname(p).toLowerCase()
    const type = MIME[ext] || 'application/octet-stream'
    return new Response(fs.readFileSync(p), { headers: { 'content-type': type } })
  })

  const win = new BrowserWindow({
    width: 1360,
    height: 820,
    show: false,
    frame: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: false,
      nodeIntegration: true,
    },
  })

  const logPath = path.join(__dirname, '..', '..', 'scratch', 'capture_console.txt')
  fs.mkdirSync(path.dirname(logPath), { recursive: true })
  fs.writeFileSync(logPath, '--- Start capture ---\n')
  const appendLog = (msg) => {
    try { fs.appendFileSync(logPath, msg + '\n') } catch {}
  }

  win.webContents.on('console-message', (_, level, message) => {
    appendLog(`[PAGE LOG lvl=${level}] ${message}`)
    if (!message.includes('Electron Security Warning')) {
      console.log(`[PAGE LOG] ${message}`)
    }
  })

  await win.loadURL('app://local/shell.html')
  console.log('Loaded app://local/shell.html')

  // Wait for React to mount & load database
  await sleep(3500)

  // Seed finished tournament and history so Winner podium and tournament matches are available
  await win.webContents.executeJavaScript(`
    (() => {
      const matchResults = {
        'U1-1': { winner: 0, wins: [3, 0] },
        'U1-2': { winner: 0, wins: [3, 1] },
        'U2-1': { winner: 0, wins: [3, 1] },
        'L1-1': { winner: 0, wins: [3, 0] },
        'L2-1': { winner: 0, wins: [3, 2] },
        'GF': { winner: 0, wins: [3, 1] },
      };

      const finishedTournament = {
        version: 1,
        prefs: { compare: 'iems', size: 4 },
        entrants: [
          'thieaudio-monarch-mkii',
          'moondrop-blessing-2',
          'truthear-x-crinacle-zero-red',
          '7hz-zero',
        ],
        results: matchResults,
        heardBy: {},
        startedAt: new Date(Date.now() - 3600000).toISOString(),
      };
      localStorage.setItem('iem-tournament-v1', JSON.stringify(finishedTournament));

      const history = [{
        id: 'hist-1',
        finishedAt: new Date(Date.now() - 3600000).toISOString(),
        size: 4,
        championId: 'thieaudio-monarch-mkii',
        runnerUpId: 'moondrop-blessing-2',
        thirdId: 'truthear-x-crinacle-zero-red',
        entrants: [
          'thieaudio-monarch-mkii',
          'moondrop-blessing-2',
          'truthear-x-crinacle-zero-red',
          '7hz-zero',
        ],
        results: matchResults,
        prefs: { compare: 'iems', size: 4 },
      }];
      localStorage.setItem('iem-history-v1', JSON.stringify(history));

      // Seed gear selection to XENNS
      localStorage.setItem('gear', JSON.stringify({ active: 'xenns-tea-2', unlisted: false }));
    })()
  `)
  await sleep(400)

  // Expand sidebar for clear layout
  await win.webContents.executeJavaScript(`
    (() => {
      const rail = document.querySelector('.ms-rail');
      if (rail && !rail.classList.contains('expanded')) {
        const topBtn = rail.querySelector('.ms-rail-top button');
        if (topBtn) topBtn.click();
      }
    })()
  `)
  await sleep(500)

  async function capture(name) {
    await sleep(900)
    const image = await win.webContents.capturePage()
    const png = image.toPNG()
    const fileLocal = path.join(OUT_DIR_BUNDLE, `${name}.png`)
    const fileArtifact = path.join(OUT_DIR_ARTIFACT, `${name}.png`)
    fs.writeFileSync(fileLocal, png)
    fs.writeFileSync(fileArtifact, png)
    appendLog(`Captured ${name}.png`)
    console.log(`Saved: ${name}.png (${png.length} bytes)`)
  }

  async function navigate(pageName, section) {
    appendLog(`Navigating to ${pageName} ${section ?? ''}`)
    await win.webContents.executeJavaScript(`
      (() => {
        if (typeof window.__goRoute === 'function') {
          window.__goRoute({ page: '${pageName}'${section ? `, section: '${section}'` : ''} });
          return;
        }
        const p = '${pageName}'.toLowerCase();
        if (p === 'home') document.querySelectorAll('.ms-dest')[0]?.click();
        else if (p === 'library') document.querySelectorAll('.ms-dest')[1]?.click();
        else if (p === 'tournament') document.querySelectorAll('.ms-dest')[2]?.click();
        else if (p === 'database') document.querySelectorAll('.ms-dest')[3]?.click();
        else if (p === 'settings') document.querySelector('.ms-dest.settings')?.click();
      })()
    `)
    await sleep(800)
  }

  async function setStyle(style, theme = 'dark') {
    await win.webContents.executeJavaScript(`
      document.documentElement.setAttribute('data-style', '${style}');
      document.documentElement.setAttribute('data-theme', '${theme}');
      try {
        localStorage.setItem('style', '${style}');
        localStorage.setItem('theme', '${theme}');
      } catch {}
    `)
    await sleep(600)
  }

  const themes = [
    { prefix: 'party_mode', style: 'gameshow' },
    { prefix: 'normal_mode', style: 'clean' },
  ]

  for (const th of themes) {
    console.log(`\n=== Capturing ${th.prefix} (${th.style}) ===`)
    await setStyle(th.style, 'dark')

    // 1. Home
    await navigate('home')
    await capture(`${th.prefix}_01_home`)

    // 2. Library
    await navigate('library')
    await capture(`${th.prefix}_02_library`)

    // 3. Tournament Roster / Hub
    await navigate('tournament')
    await capture(`${th.prefix}_03_tournament`)

    // 4. Winner (Results / Podium Page)
    await win.webContents.executeJavaScript(`
      (() => {
        try {
          const row = Array.from(document.querySelectorAll('.ms-tourney-row')).find(r => (r.innerText || '').includes('Finished') || (r.innerText || '').includes('results'));
          if (row) row.click();
        } catch (e) {
          console.error('Failed to click tournament row:', e);
        }
      })()
    `)
    await sleep(1200)
    await capture(`${th.prefix}_04_winner`)

    // 5. Settings -> Appearance (Matching user's reference image exactly!)
    await navigate('settings', 'appearance')
    await sleep(1000)
    const debugHtml = await win.webContents.executeJavaScript(`
      (() => {
        const c = document.querySelector('.ms-content');
        return {
          layers: document.querySelectorAll('.ms-layer').length,
          settingsExists: Boolean(document.querySelector('.ms-settings')),
          settingsDisplay: document.querySelector('.ms-settings') ? getComputedStyle(document.querySelector('.ms-settings')).display : 'none',
          settingsVisibility: document.querySelector('.ms-settings') ? getComputedStyle(document.querySelector('.ms-settings')).visibility : 'none',
          settingsOpacity: document.querySelector('.ms-settings') ? getComputedStyle(document.querySelector('.ms-settings')).opacity : 'none',
          htmlSnippet: c ? c.innerHTML.slice(0, 400) : 'no content'
        };
      })()
    `)
    appendLog(`Before ${th.prefix}_05_settings: ${JSON.stringify(debugHtml)}`)
    await capture(`${th.prefix}_05_settings`)
  }

  console.log('\nAll bundled screenshots for AI Studio captured successfully!')
  app.quit()
})
