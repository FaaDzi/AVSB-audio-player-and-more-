// Builds the Android APK: the app's web build (the same one the PC exe ships, vite.shell.config.ts) → Capacitor → Gradle.
//
// Usage (from app/): npm run android → release/AVSB.apk (debug-signed)
//   npm run android -- --release → release/AVSB-release.apk, signed with the key named in ~/.avsb/keystore.properties
//   env ANDROID_JAVA_HOME / ANDROID_HOME override the defaults below.
import { spawnSync } from 'node:child_process'
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(app, 'dist-android')
// Capacitor 8 needs Java 21+, but Gradle 8.14 can't run on 25 (what Android Studio now bundles):
// use the JetBrains Java 21 runtime when it's there, else Studio's own. The system JAVA_HOME
// on this PC is JDK 17, so it is deliberately not used.
const JBR21 = path.join(os.homedir(), '.jdks', 'jbr-21.0.11')
const JAVA_HOME = process.env.ANDROID_JAVA_HOME || (existsSync(JBR21) ? JBR21 : 'D:\\Project\\Android\\Android Studio\\jbr')
const ANDROID_HOME = process.env.ANDROID_HOME || 'D:\\Project\\Android\\Sdk'

const release = process.argv.includes('--release')

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd: app, ...opts })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

// 1. the web build, with its page as index.html (Capacitor's start page)
run('npx', ['tsc', '-b'])
run('npx', ['vite', 'build', '--config', 'vite.shell.config.ts'])
rmSync(out, { recursive: true, force: true })
cpSync(path.join(app, 'dist-shell'), out, { recursive: true })
copyFileSync(path.join(out, 'shell.html'), path.join(out, 'index.html'))
rmSync(path.join(out, 'shell.html'))
// the Android build unzips *.gz assets and drops the extension (kuromoji then 404s): ship them as *.gzip,
// ShellHostPlugin.kuromojiDict serves them under the .gz names romaji.ts asks for (plan §76 J)
const dict = path.join(out, 'kuromoji-dict')
for (const f of readdirSync(dict)) if (f.endsWith('.gz')) renameSync(path.join(dict, f), path.join(dict, `${f}ip`))
// the dev server's sample library (24 MB): the phone reads its library from the phone and the PC link
rmSync(path.join(out, 'shell-fixture'), { recursive: true, force: true })
// source maps are for debugging the PC build; the phone never loads them (5 MB)
for (const f of readdirSync(path.join(out, 'assets'))) if (f.endsWith('.map')) rmSync(path.join(out, 'assets', f))

// 2. Capacitor + Gradle
const env = { ...process.env, JAVA_HOME, ANDROID_HOME, ANDROID_SDK_ROOT: ANDROID_HOME }
writeFileSync(path.join(app, 'android', 'local.properties'), `sdk.dir=${ANDROID_HOME.replace(/\\/g, '\\\\')}\n`)
run('npx', ['cap', 'sync', 'android'], { env })
const androidDir = path.join(app, 'android')
run(`"${path.join(androidDir, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew')}"`, ['clean', release ? 'assembleRelease' : 'assembleDebug', '--no-daemon', '--max-workers=2'], { cwd: androidDir, env })

const apk = path.join(androidDir, 'app', 'build', 'outputs', 'apk', release ? 'release' : 'debug', release ? 'app-release.apk' : 'app-debug.apk')
const releaseDir = path.join(app, 'release')
mkdirSync(releaseDir, { recursive: true })
const dest = path.join(releaseDir, release ? 'AVSB-release.apk' : 'AVSB.apk')
copyFileSync(apk, dest)
console.log(`APK created: ${dest} (${(statSync(dest).size / 1e6).toFixed(0)} MB)`)
