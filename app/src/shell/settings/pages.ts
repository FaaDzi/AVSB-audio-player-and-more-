// Every Settings page as data. Row order comes from Mornye's settings pages and reference captures; its name
// becomes "this app" and service names become placeholders. Nothing here changes real behaviour yet.

import { SEPARATORS } from '../library'
/** On Android the same page is the phone's side of the link: Connect to a PC. */
const ONPHONE = typeof window !== 'undefined' && (window as unknown as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.() === 'android'

export interface Rule {
  id: string
  /** The value it must have, or any of these. */
  is: boolean | string | string[]
}

interface Common {
  label: string
  sub?: string
  icon?: string
  /** A small chip after the label, such as Beta. */
  badge?: string
  /** Show the row only when another setting has this value. */
  when?: Rule
  /** Dim the row and show it off when another setting has this value. */
  disabledWhen?: Rule
}

export interface Tile {
  label: string
  icon?: string
}

export type Row = Common & (
  | { kind: 'toggle'; id: string; off?: string; on?: boolean; sub2?: string }
  | { kind: 'nav'; to?: string }
  | { kind: 'action'; danger?: boolean; plain?: boolean; trail?: string }
  | { kind: 'choice'; id: string; options: string[]; value: string; format?: (value: string) => string }
  | { kind: 'pick'; id: string; selected?: boolean; mark?: 'tick' | 'circle' }
  | { kind: 'segment'; id: string; options: Tile[]; value: string; hideLabel?: boolean; note?: string }
  | { kind: 'tiles'; id: string; options: Tile[]; value: string; tall?: boolean; subFor?: (value: string) => string }
  | { kind: 'chips'; id: string; options: string[]; value: string }
  | { kind: 'slider'; id: string; min: number; max: number; step: number; value: number; format: (value: number) => string; preview?: string; resettable?: boolean; ticks?: number; note?: string }
  | { kind: 'bubble' }
  | { kind: 'swatches' }
  | { kind: 'font' }
  | { kind: 'info'; value?: string }
  | { kind: 'expander'; summary: (get: (id: string) => boolean | string | number | undefined) => string; children: Row[] }
)

export interface Section {
  title?: string
  when?: Rule
  rows: Row[]
  /** A card drawn instead of, or after, the group of rows. */
  block?: 'style-preview' | 'library-count' | 'network-empty' | 'separator-preview' | 'library-folders' | 'metadata-naming' | 'metadata-bulk' | 'data-network' | 'app-update'
  /** A dim info card. */
  card?: { icon: string; title?: string; text: string }
}

export interface Page {
  id: string
  title: string
  icon: string
  /** The page this one opens from, for the back button and the selected row in the list. */
  parent?: string
  custom?: 'gear' | 'equalizer' | 'stats' | 'storage' | 'logs' | 'shortcuts' | 'about' | 'phone' | 'lyrics-priority' | 'metadata-priority' | 'duplicates' | 'saved-eq'
  sections?: Section[]
}

const toggle = (id: string, label: string, sub?: string, icon?: string, on = false, off?: string, extra?: Partial<Common>): Row => ({ kind: 'toggle', id, label, sub, icon, on, off, ...extra })
const nav = (label: string, sub?: string, icon?: string, to?: string, extra?: Partial<Common>): Row => ({ kind: 'nav', label, sub, icon, to, ...extra })
const action = (label: string, sub?: string, icon?: string, extra?: { plain?: boolean; trail?: string; when?: Rule }): Row => ({ kind: 'action', label, sub, icon, ...extra })
const choice = (id: string, label: string, options: string[], value: string, icon?: string, format?: (value: string) => string): Row => ({ kind: 'choice', id, label, options, value, icon, format })
const pick = (id: string, label: string, sub: string | undefined, icon: string, selected = false, mark: 'tick' | 'circle' = 'tick', badge?: string): Row => ({ kind: 'pick', id, label, sub, icon, selected, mark, badge })
const seg = (id: string, label: string, options: Tile[], value: string, extra?: Partial<Common> & { hideLabel?: boolean; note?: string }): Row => ({ kind: 'segment', id, label, options, value, ...extra })
const words = (...labels: string[]): Tile[] => labels.map((label) => ({ label }))

export const LYRICS_ORDER_SAMPLE = 'LRCLIB. Lyrics in the file always come first'

export const PAGE_GROUPS: Page[][] = [
  [
    // §69: what you listen on, the gear you own and want to hear, your DAC and DSP
    { id: 'gear', title: 'My gear', icon: 'headphones', custom: 'gear' },
    {
      id: 'tournament',
      title: 'Tournament',
      icon: 'emoji_events',
      sections: [
        {
          title: 'CanOpener Crossfeed & Soundstage',
          card: {
            icon: 'surround_sound',
            title: 'CanOpener Spatial Crossfeed',
            text: 'Simulates the natural open-air binaural soundstage of open-back headphones and studio monitors. Eliminates intracranial in-head localization without altering frequency response balance.',
          },
          rows: [
            choice(
              'tourney_crossfeed',
              'Crossfeed mode',
              ['Auto (Open backs on IEMs & Closed)', 'Always On (All matches)', 'Off (Pure Monaural EQ)'],
              'Auto (Open backs on IEMs & Closed)',
              'surround_sound'
            ),
            {
              kind: 'slider',
              id: 'tourney_crossfeed_level',
              label: 'Crossfeed level',
              min: -20,
              max: -8,
              step: 1,
              value: -14,
              format: (v) => `${v} dB (350 Hz corner, 0.3 ms delay)`,
              note: '-14 dB is the standard Bauer / CanOpener reference with natural head shadow (<1 dB frequency ripple).',
              when: { id: 'tourney_crossfeed', is: ['Auto (Open backs on IEMs & Closed)', 'Always On (All matches)'] },
            },
            toggle(
              'tourney_stage_reflections',
              'Virtual stage reflections',
              'Adds subtle 7 ms and 13 ms room reflections (-20 dB / -23 dB) so the stage floats slightly outside the head.',
              'speaker',
              true,
              undefined,
              { when: { id: 'tourney_crossfeed', is: ['Auto (Open backs on IEMs & Closed)', 'Always On (All matches)'] } }
            ),
          ],
        },
        {
          title: 'Audio Comparison & Testing',
          rows: [
            toggle(
              'tourney_raw_mode',
              'Raw mode switch',
              'Enable a Raw toggle in tournament matches to hear your headphones unmodified alongside Contender A and B.',
              'compare',
              true
            ),
            choice(
              'tourney_uncalibrated_ref',
              'Default comparison baseline',
              ['Auto (Harmonized Catalog Targets)', 'Raw Pure Sound (No EQ Bypass)'],
              'Auto (Harmonized Catalog Targets)',
              'tune'
            ),
            toggle(
              'levelmatch',
              'Loudness matching',
              'Even out volume differences between contenders so a naturally louder IEM or headphone does not get an unfair advantage.',
              'equalizer',
              true
            ),
          ],
        },
        {
          title: 'Driver Protection & Excursion',
          card: {
            icon: 'shield',
            title: 'Bottom-Out Excursion Guard',
            text: 'Open-back headphones (such as Koss KSC75 or Sennheiser HD 600) require massive cone excursion when equalizing deep sub-bass (+12 to +18 dB at 20–30 Hz), risking driver bottoming out, mechanical rattle, and motor clipping. The bottom-out filter safely limits excessive cone travel.',
          },
          rows: [
            toggle(
              'tourney_bottom_guard',
              'Bottom-out protection filter',
              'Safely limits sub-bass boost on open-air headphones and delicate drivers to prevent mechanical bottoming out and harmonic distortion.',
              'shield',
              true
            ),
            choice(
              'tourney_bottom_corner',
              'High-pass protection corner',
              ['Auto (Adaptive by Device Back Type)', 'Sub-Bass 35 Hz HPF', 'Sub-Bass 45 Hz HPF', 'Soft-Knee 6 dB Boost Cap'],
              'Auto (Adaptive by Device Back Type)',
              'filter_alt'
            ),
            {
              kind: 'slider',
              id: 'tourney_max_bass_boost',
              label: 'Maximum bass boost cap',
              min: 4,
              max: 14,
              step: 1,
              value: 10,
              format: (v) => `+${v} dB max boost`,
              note: 'Standard is +10 dB. Boosts above +12 dB on open-back drivers cause rapid THD rises.',
              when: { id: 'tourney_bottom_guard', is: true },
            },
          ],
        },
        {
          title: 'Air & Treble Detail',
          rows: [
            choice(
              'air_mode',
              'High treble resolution (10 kHz+)',
              ['Auto (Full detail when measured alike)', 'Always held back (Smoothed)', 'Always measured (Raw detail)'],
              'Auto (Full detail when measured alike)',
              'graphic_eq'
            ),
          ],
        },
      ],
    },
    {
      id: 'appearance', title: 'Appearance', icon: 'palette', sections: [
        { rows: [choice('windowmode', 'Window mode', ['Windowed', 'Full screen', 'Borderless'], 'Windowed', 'desktop_windows')] },
        {
          title: 'App Style',
          block: 'style-preview',
          rows: [
            pick('style', 'Material', 'Modern minimalist dark and light theme', 'palette', true, 'circle'),
            pick('style', 'Game show', 'Full game show stage styling across Home, Library, Tournament, Sidebar and Player Bar', 'music_note', false, 'circle', 'Party'),
          ],
        },
        { title: 'Color', rows: [toggle('outlines', 'Outlines', 'Show thin edges around the see-through panels. Turning this off keeps the blur.', 'rounded_corner', true, undefined, { when: { id: 'style', is: 'Game show' } }), toggle('dynamic', 'Dynamic Color', 'Use colors from your wallpaper', 'wallpaper', true), { kind: 'swatches', label: 'Color', when: { id: 'dynamic', is: false } }] },
        { title: 'Theme', when: { id: 'style', is: 'Material' }, rows: [seg('theme', 'Theme', [{ label: 'System', icon: 'brightness_auto' }, { label: 'Light', icon: 'light_mode' }, { label: 'Dark', icon: 'dark_mode' }], 'System', { hideLabel: true }), toggle('amoled', 'AMOLED Dark', 'Pure black background', 'brightness_2', false, undefined, { when: { id: '__dark', is: true } })] },
        { rows: [toggle('sysfont', 'Use system font', 'Use your device\'s default typeface for app text.', 'font_download'), toggle('hero', 'Hero animations', 'Fly covers between screens, e.g. when opening the player', 'animation', true), toggle('reducemotion', 'Reduce motion', 'Skip the tournament bursts, slams and drifting colours. Windows\' own animation setting doesn\'t turn these off.', 'motion_photos_off', false), { kind: 'font', label: 'Custom font', sub: 'Import a TTF or OTF file (up to 10 MB). Overrides the theme and system font.', icon: 'format_size' }, toggle('blur', 'Always use blur effects', 'Enable the navigation bar blur even on devices where it is off by default. May cost performance.', 'blur_on')] },
        { title: 'Language', rows: [choice('language', 'App Language', ['System default', 'English'], 'English', 'language')] },
        { title: 'Layout', rows: [seg('historyview', 'History View', [{ label: 'List', icon: 'view_list' }, { label: 'Grid', icon: 'grid_view' }], 'List')] },
      ],
    },
    {
      id: 'playback', title: 'Playback', icon: 'play_circle', sections: [
        ...(ONPHONE ? [] : [{ title: 'Player', rows: [pick('player', 'External player', 'Open songs in your default Windows music app. Only in the installed app.', 'open_in_new', false, 'circle'), pick('player', 'Built-in player', 'Play your music right inside this app', 'play_circle', true, 'circle')] }]),
        // §86 D: what shapes the sound, then the tools and tests (pages of their own), then levels and transitions
        { title: 'Sound', rows: [
          nav('Equalizer', 'AutoEQ to a target, fine-tune by ear, bands and filters', 'equalizer', 'equalizer'),
          nav('Saved Equalizers', 'Save, import, export and manage your EQs', 'tune', 'saved-eq'),
          nav('Spatial & Crossfeed', 'CanOpener crossfeed, virtual speaker room stage, SOFA HRTF profiles and head tracking', 'surround_sound', 'spatial'),
        ] },
        { title: 'Tools and tests', rows: [
          nav('Audio Tools & Diagnostics', 'Fit & seal, left/right & phase, and channel balance', 'biotech', 'audio-tools'),
          nav('Hearing Check', 'Multi-frequency threshold check (125 Hz – 16 kHz) with personal audiogram curve', 'hearing', 'hearing-test'),
          nav('Ear-Training & Blind ABX', 'Name the boosted band, and blind ABX', 'quiz', 'blind-abx'),
        ] },
        { title: 'Volume and transitions', rows: [
          toggle('normalize', 'Volume normalization', 'Measures each song and plays them at a similar loudness, so a quiet song isn\'t followed by a sudden loud one. Only the level changes, the sound itself doesn\'t.', 'graphic_eq', true),
          { kind: 'chips', id: 'gainmode', label: 'Gain mode', options: ['Track', 'Album'], value: 'Track', when: { id: 'normalize', is: true } },
          { kind: 'slider', id: 'normpreamp', label: 'Pre-amp', min: -14, max: 4, step: 1, value: 0, ticks: 19, format: (v) => `${v > 0 ? '+' : ''}${v} dB (target ${v - 14} LUFS)`, note: 'Higher is louder but evens out less, as more songs reach their peak. A song is never raised past its own peak, so it never clips.', when: { id: 'normalize', is: true } },
          toggle('gapless', 'Gapless playback', 'Start the next song the moment one ends, without silence between them. AutoMix replaces it while on.', 'linear_scale', true, undefined, { disabledWhen: { id: 'automix', is: true } }),
          toggle('automix', 'AutoMix', 'Blend each song into the next with a crossfade and the transition effect you choose.', 'compare_arrows', true),
          ...(ONPHONE ? [toggle('directdac', 'Direct to DAC', 'With a USB DAC plugged in, songs go straight to it at their own sample rate and bit depth. Takes over whenever EQ, Sound, Spatial and AutoMix are off.', 'usb', true)] : []),
        ] },
        { title: 'Mix transitions', when: { id: 'automix', is: true }, rows: [
          choice('transition', 'Transition effect', ['Auto', 'Crossfade', 'Muffled', 'Echo', 'Pitch', 'Custom'], 'Auto', 'tune'),
          { kind: 'slider', id: 'mixsecs', label: 'Transition length', min: 0, max: 30, step: 1, value: 0, format: (v) => (v ? `${v} s` : 'Auto'), resettable: true },
          { kind: 'slider', id: 'mixpitch', label: 'Pitch', min: -6, max: 6, step: 0.5, value: 2, format: (v) => `${v > 0 ? '+' : ''}${v} semitones`, note: 'Speed moves with the pitch, like a record.', when: { id: 'transition', is: ['Pitch', 'Custom'] } },
          { kind: 'slider', id: 'mixspeed', label: 'Speed', min: 0.8, max: 1.2, step: 0.01, value: 1, format: (v) => `${v.toFixed(2)}×`, when: { id: 'transition', is: 'Custom' } },
          toggle('mixecho', 'Echo', undefined, 'surround_sound', false, undefined, { when: { id: 'transition', is: 'Custom' } }),
          toggle('mixlowpass', 'Low-pass', undefined, 'graphic_eq', false, undefined, { when: { id: 'transition', is: 'Custom' } }),
          { kind: 'bubble', label: 'Effects apply to the end of the outgoing song during the mix. Short songs use a shorter overlap.' },
        ] },
        { title: 'Autoplay from your Library', rows: [
          toggle('autoplay', 'Autoplay from your Library', 'Continue with related songs from your Library when the queue ends.', 'playlist_play'),
          toggle('personal', 'Personalized autoplay', 'Learn from songs you listen to and skip, privately on this device. Turning this off stops learning and restores ordinary autoplay.', 'auto_awesome', true),
          action('Reset recommendation learning', 'Ranking tunes to you after 40 Autoplay songs (0 so far)', 'restart_alt', { when: { id: 'personal', is: true } }),
          toggle('analysis', 'Song analysis', 'Learn how each Library song sounds, privately on this device, so Autoplay picks songs that sound like what you play and flow into each other.', 'graphic_eq'),
          action('Clear song analysis', '0 of 635 songs analyzed', 'delete', { when: { id: 'analysis', is: true } }),
        ] },
        { title: 'Cover art', rows: [pick('cover', 'Card', 'Artwork as a card above the controls', 'crop_square', true, 'circle'), pick('cover', 'Full screen', 'Artwork fills the top of the player and fades into a blur.', 'fullscreen', false, 'circle'), toggle('artlyrics', 'Album art beside lyrics', 'Show album art instead of track details while lyrics are open.', 'splitscreen'), toggle('compact', 'Compact player', 'When lyrics are left alone for a few seconds, shrink the player to a slim bar so the lyrics get more room.', 'short_text')] },
        // §95: Samsung-style humps on the seek bar
        { title: 'Seek bar', rows: [
          pick('seekwave', 'Waves', 'Soft waves that rise with the loud parts of the song and settle in the quiet ones', 'graphic_eq', true, 'circle'),
          pick('seekwave', 'Squiggly', 'A thin line that wiggles while the music plays', 'waves', false, 'circle'),
          pick('seekwave', 'Flat', 'A plain bar', 'horizontal_rule', false, 'circle'),
        ] },
        { title: 'Animated artwork', rows: [toggle('animated', 'Enable animated artwork', 'Play a GIF or animated WebP in the player if the song has one, either in its file or beside it with the same name. Only in the installed app.', 'motion_photos_on')] },
        { title: 'Statistics', rows: [nav('Listening statistics', 'What you play, kept on this computer.', 'bar_chart', 'stats')] },
      ],
    },
    {
      id: 'lyrics', title: 'Lyrics', icon: 'lyrics', sections: [
        { title: 'Lyrics', rows: [
          { kind: 'slider', id: 'lyricsize', label: 'Lyrics text size', preview: 'Follow every line of your favorite song', resettable: true, ticks: 13, min: 0.7, max: 1.9, step: 0.1, value: 1, format: (v) => `${Math.round(v * 100)}%` },
          { kind: 'slider', id: 'lyricoffset', label: 'Lyrics timing', sub: 'Show synced lyrics later or earlier, for example when Bluetooth audio arrives late', resettable: true, ticks: 41, min: -2, max: 2, step: 0.1, value: 0, format: (v) => (Math.abs(v) < 0.05 ? 'In sync' : `${v > 0 ? '+' : ''}${v.toFixed(1)} s`) },
          ...(ONPHONE ? [toggle('locklyrics', 'Lyrics on lock screen', 'While a song with timed lyrics plays, the notification and lock screen show the line being sung in place of the artist.', 'screen_lock_portrait', true)] : []),
          toggle('keepscreen', 'Keep screen on while viewing lyrics', 'Prevent screen timeout while lyrics are open, including when playback is paused.', 'light_mode', true),
          toggle('savelrc', 'Save found lyrics as .lrc files', 'When lyrics are found online, write them to a .lrc file next to the song. An existing .lrc is never replaced, and audio files are never changed. Only in the installed app.', 'save'),
          toggle('autolyrics', 'Find lyrics automatically', 'When a song has no lyrics, look it up online while the lyrics view is open. Sends its title, artist, album and length to the lyrics service.', 'cloud_download', true),
          nav('Lyrics Provider Priority', LYRICS_ORDER_SAMPLE, 'folder_open', 'lyrics-priority'),
        ] },
        { title: 'Display', rows: [
          toggle('censor_lyrics', 'Censor explicit lyrics', 'Filter profanity and mature words in lyrics with asterisks. Turn off to view unfiltered lyrics.', 'explicit', true),
          toggle('lyrroman', 'Romaji for Japanese lyrics', 'Shows how each line is read, under it. Worked out on this computer.', 'format_size', true),
          toggle('lyrmulti', 'Multi-Person Lyrics', 'Duet singers on their own side, and background vocals under the line', 'record_voice_over', true),
          toggle('lyrword', 'Word Sync', 'Light up each word as it\'s sung. Off shows whole lines.', 'graphic_eq', true),
        ] },
      ],
    },
  ],
  [
    {
      id: 'library', title: 'Local Library', icon: 'library_music', sections: [
        { block: 'library-count', rows: [
          choice('defaultview', 'Default view', ['Last used', 'Songs', 'Albums', 'Singles', 'Artists', 'Playlists', 'Folders'], 'Last used', 'grid_view'),
          choice('qualityshown', 'Audio quality', ['File format', 'Bit Depth', 'Bit Depth & Sample Rate', 'Bit Depth & Bitrate', 'Bitrate'], 'Bit Depth & Sample Rate', 'graphic_eq'),
        ] },
        { title: 'Folders', block: 'library-folders', rows: [] },
        { title: 'Scan Settings', rows: [
          choice('autoscan', 'Auto Scan', ['Every app open', 'Daily', 'Weekly', 'Off'], 'Every app open', 'sync'),
          nav('Review duplicates', 'The same song found more than once in your folders', 'difference', 'duplicates'),
        ] },
        { title: 'Actions', rows: [action('Scan Library', 'Look for new, changed and removed songs', 'refresh'), action('Force Full Scan', 'Read every file again, ignoring what was saved', 'sync_problem')] },
        { rows: [], card: { icon: 'info', title: 'About Local Library', text: 'Plays the music in the folders you choose, where it is: nothing is copied or uploaded. Each scan picks up new and changed songs and drops ones that are gone. FLAC, MP3, AAC, Opus, Ogg and WAV play; ALAC, AIFF, APE, WavPack and DSD files are listed but can\'t be played yet.' } },
      ],
    },
    { id: 'network', title: 'Network storage', icon: 'dns', sections: [{ block: 'network-empty', rows: [] }] },
    { id: 'phone', title: ONPHONE ? 'Connect to a PC' : 'Pair a phone', icon: 'smartphone', custom: 'phone' },
  ],
  [
    ...(ONPHONE ? [{
      id: 'offline', title: 'Saved & Offline Songs', icon: 'folder', sections: [
        { title: 'PC to Phone Storage', rows: [
          nav('Save Location on Device', 'Music/AVSB', 'folder'),
          toggle('autocache', 'Auto-save liked songs from PC', 'Keep offline copy of songs you like when connected to PC', 'favorite', false),
          choice('streamqual', 'Stream Quality', ['Original / Lossless', 'High (320 kbps)', 'Data Saver'], 'Original / Lossless', 'high_quality'),
        ] },
        { title: 'Offline Storage', rows: [
          action('Clear saved PC songs', 'Free up device storage', 'delete_sweep'),
        ] },
        { rows: [], card: { icon: 'info', title: 'Offline PC Streaming', text: 'Songs you stream or save from your PC are kept on your device for offline listening. When away from your PC, saved tracks play instantly from local storage.' } },
      ],
    }] : []),
    {
      id: 'metadata', title: 'Metadata', icon: 'sell', sections: [
        { title: 'Library', rows: [action('Refresh metadata', 'Re-read the tags in your song files', 'sync')] },
        // §87: Import song art and Sync lyrics sit between Refresh metadata and the separators
        { block: 'metadata-bulk', rows: [nav('Metadata separators', 'How one artist tag splits into separate artists in Library', 'format_list_bulleted', 'metadata-separators')] },
        { block: 'metadata-naming', rows: [] },
        { title: 'Providers', rows: [nav('Metadata Provider Priority', 'MusicBrainz, Cover Art Archive, Deezer. Tags in the file always come first', 'folder_open', 'metadata-priority')] },
        { rows: [], card: { icon: 'info', title: 'Look up details', text: 'On a song\'s page, Look up details fills only the fields its file leaves empty. It sends the title, artist, album, length and ISRC to the sources above. What\'s found is kept on this computer; audio files are never changed, and Library filters keep reading the file tags.' } },
      ],
    },
  ],
  [
    {
      id: 'app', title: 'App', icon: 'tune', sections: [
        { title: 'App', block: 'app-update', rows: [
          toggle('updates', 'Check for Updates', 'Notify when new version is available', 'system_update', true),
          seg('channel', 'Update Channel', words('Stable', 'Preview'), 'Stable', { sub: 'Stable releases only', icon: 'verified', note: 'Preview may contain bugs or incomplete features' }),
          choice('rewind_frequency', 'Rewind recap check', ['1 Day', '1 Week', '1 Month', '1 Year'], '1 Week', 'auto_awesome'),
          choice('home_shelves_refresh', 'Home playlists refresh', ['1 Day', '3 Days', '1 Week'], '3 Days', 'refresh'),
        ] },
        {
          title: 'Data & Network',
          block: 'data-network',
          rows: [
            toggle('offline_mode', 'Offline Mode', 'Play only downloaded and local songs. Disables PC streaming and network usage.', 'cloud_off', false),
            seg('stream_quality', 'Streaming Quality', [
              { label: 'Low Data (~128 kbps)', icon: 'data_saver_on' },
              { label: 'Normal (Lossless)', icon: 'high_quality' },
            ], 'Normal (Lossless)', {
              disabledWhen: { id: 'offline_mode', is: true },
              note: 'Low Data Mode reduces mobile data usage by ~95% (YouTube Music standard).',
            }),
            toggle('auto_lowdata_on_weak', 'Auto-Switch on Weak Signal', 'Automatically switches to Low Data Mode when PC connection signal or speed is very low.', 'network_check', true, undefined, {
              disabledWhen: { id: 'offline_mode', is: true },
            }),
          ],
        },
        { title: 'Debug', rows: [toggle('detailedlog', 'Detailed Logging', 'Enable for bug reports', 'bug_report')] },
      ],
    },
    { id: 'shortcuts', title: 'Keyboard Shortcuts', icon: 'keyboard', custom: 'shortcuts' },
    { id: 'storage', title: 'Storage & Cache', icon: 'storage', custom: 'storage' },
    {
      id: 'backup', title: 'Backup & Restore', icon: 'settings_backup_restore', sections: [
        { title: 'Create backup', rows: [
          nav('Settings only', undefined, 'settings'),
          toggle('bksettings', 'App settings', 'Includes your profile name and photo', 'settings', true),
          toggle('bkhistory', 'Download history', undefined, 'history', true),
          toggle('bkcollections', 'Library collections', 'Liked tracks, wishlist, favorite artists, playlists and playlist covers.', 'library_music', true),
          toggle('bkext', 'Extensions and their settings', undefined, 'extension', true),
          toggle('bkcreds', 'Include extension credentials', 'Tokens and API keys from extensions will be saved into the backup file. Keep the file private. When off, you re-enter them after restoring.', 'vpn_key'),
          action('Create backup file', 'Save the selected categories to a backup file. Audio files are not included.', 'ios_share'),
        ] },
        { title: 'Restore backup', rows: [action('Choose backup file', 'Pick a backup file to restore your data. This replaces the current settings, history and library on this device.', 'settings_backup_restore')] },
      ],
    },
  ],
  [
    { id: 'logs', title: 'Logs', icon: 'article', custom: 'logs' },
    { id: 'about', title: 'About', icon: 'info', custom: 'about' },
  ],
]

const SUB_PAGES: Page[] = [
  { id: 'equalizer', title: 'Equalizer', icon: 'equalizer', parent: 'playback', custom: 'equalizer' },
  { id: 'saved-eq', title: 'Saved Equalizers', icon: 'tune', parent: 'playback', custom: 'saved-eq' },
  { id: 'spatial', title: 'Spatial & Crossfeed', icon: 'surround_sound', parent: 'playback', custom: 'equalizer' },
  { id: 'audio-tools', title: 'Audio Tools & Diagnostics', icon: 'biotech', parent: 'playback', custom: 'equalizer' },
  { id: 'hearing-test', title: 'Hearing Check', icon: 'hearing', parent: 'playback', custom: 'equalizer' },
  { id: 'blind-abx', title: 'Ear-Training & Blind ABX', icon: 'quiz', parent: 'playback', custom: 'equalizer' },
  { id: 'stats', title: 'Listening statistics', icon: 'bar_chart', parent: 'playback', custom: 'stats' },
  { id: 'lyrics-priority', title: 'Lyrics Provider Priority', icon: 'folder_open', parent: 'lyrics', custom: 'lyrics-priority' },
  { id: 'duplicates', title: 'Review duplicates', icon: 'difference', parent: 'library', custom: 'duplicates' },
  { id: 'metadata-priority', title: 'Metadata Provider Priority', icon: 'folder_open', parent: 'metadata', custom: 'metadata-priority' },
  {
    id: 'metadata-separators', title: 'Metadata separators', icon: 'format_list_bulleted', parent: 'metadata', sections: [
      { title: 'Artists tab', rows: [toggle('artistsall', 'Every artist on the song', 'Off: the Artists tab lists album artists, and featured guests show on an artist’s page under Appears on. On: everyone named on a song is an artist of their own.', 'groups')] },
      { title: 'Split artists at', rows: SEPARATORS.map((m) => toggle(m.id, m.label, undefined, undefined, m.on)) },
      { rows: [], block: 'separator-preview' },
      { rows: [], card: { icon: 'info', text: 'Names with a comma in them, like Tyler, The Creator, stay whole. & only splits with a space on each side. Your files keep their tags as they are.' } },
    ],
  },
]

export const ALL_PAGES: Page[] = [...PAGE_GROUPS.flat(), ...SUB_PAGES]

const allRows = (rows: Row[]): Row[] => rows.flatMap((r) => (r.kind === 'expander' ? [r, ...r.children] : [r]))

/** The starting value of every setting, so one row can depend on another that hasn't been touched yet. */
export const DEFAULTS: Record<string, boolean | string | number> = {}
for (const page of ALL_PAGES) {
  for (const section of page.sections ?? []) {
    for (const r of allRows(section.rows)) {
      if (r.kind === 'toggle') DEFAULTS[r.id] = Boolean(r.on)
      else if (r.kind === 'pick') { if (r.selected) DEFAULTS[r.id] = r.label }
      else if ('value' in r && 'id' in r && r.value !== undefined) DEFAULTS[r.id] = r.value
    }
  }
}

/** Every label on every page, so Search settings can find what's inside a page and not only its title. */
export function searchPages(query: string): { page: Page; row?: string }[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hits: { page: Page; row?: string }[] = []
  for (const page of ALL_PAGES) {
    if (page.title.toLowerCase().includes(q)) hits.push({ page })
    for (const s of page.sections ?? []) {
      for (const r of allRows(s.rows)) {
        if (`${r.label} ${r.sub ?? ''}`.toLowerCase().includes(q)) hits.push({ page, row: r.label })
      }
    }
  }
  return hits
}
