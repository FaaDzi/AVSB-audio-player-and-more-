// The small bridge between the page and the Electron window. Context isolation stays on.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('musicHost', {
  /** Windows' folder picker, for Local Library. Answers the folder, or null. */
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  /** §119: AVSB's EQ in Equalizer APO (text = the AVSB.txt include; null empties it). Answers { ok, error? }. */
  apoWrite: (text) => ipcRenderer.invoke('apo-write', text == null ? null : String(text)),
  /** Opens a song from the library in the default Windows app. */
  openSong: (songPath) => ipcRenderer.invoke('open-song', String(songPath)),
  /** Switches between standard window and compact floating mini player widget. */
  setMiniMode: (mini) => ipcRenderer.invoke('set-mini-mode', Boolean(mini)),
  /** Writes lyrics found online to a .lrc beside the song, unless one is already there. */
  saveLyrics: (songPath, text) => ipcRenderer.invoke('save-lyrics', String(songPath), String(text)),
  /** Live Electron process/memory metrics for Settings → Logs subsystem monitor. */
  appMetrics: () => ipcRenderer.invoke('app-metrics'),
  /** The phone link (plan §70 D1): status, the pairing window with its QR, and removing a phone. */
  link: {
    status: () => ipcRenderer.invoke('link-status'),
    resync: () => ipcRenderer.invoke('link-resync'),
    ping: () => ipcRenderer.invoke('link-ping'),
    pair: () => ipcRenderer.invoke('link-pair'),
    stopPairing: () => ipcRenderer.invoke('link-stop-pairing'),
    remove: (id) => ipcRenderer.invoke('link-remove', String(id)),
    rename: (id, name) => ipcRenderer.invoke('link-rename', String(id), String(name)),
    /** §80 A: the page's playlists (JSON) for phones to fetch. */
    pushPlaylists: (json) => ipcRenderer.send('link-push-playlists', String(json)),
    /** A phone sent its playlists: the page merges them. */
    onPlaylists: (listener) => {
      const handler = (_e, sent) => listener(sent)
      ipcRenderer.on('link-playlists', handler)
      return () => ipcRenderer.removeListener('link-playlists', handler)
    },
    /** §114 G: EQs waiting for each phone ({ phoneId: presets[] }, JSON). */
    pushEqOutbox: (json) => ipcRenderer.send('link-push-eq-outbox', String(json)),
    /** A phone sent an EQ ({ type: 'eq-put', phoneId, from, preset }) or took its waiting ones ({ type: 'eq-taken', phoneId }). */
    onEq: (listener) => {
      const handler = (_e, msg) => listener(msg)
      ipcRenderer.on('link-eq', handler)
      return () => ipcRenderer.removeListener('link-eq', handler)
    },
    /** A phone sent a song into the library folder. */
    onUploaded: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('link-uploaded', handler)
      return () => ipcRenderer.removeListener('link-uploaded', handler)
    },
    onChange: (listener) => {
      const handler = () => listener()
      ipcRenderer.on('link-changed', handler)
      return () => ipcRenderer.removeListener('link-changed', handler)
    },
  },
})
