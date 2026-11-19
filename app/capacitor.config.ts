import type { CapacitorConfig } from '@capacitor/cli'

// The Android app wraps the same web build. dist-android = the normal build plus the
// phone-sized songs and ear-training clips (scripts/build_android.mjs).
const config: CapacitorConfig = {
  appId: 'com.iemdreambracket.app',
  appName: 'AVSB',
  webDir: 'dist-android',
  android: {
    backgroundColor: '#0e071b',
  },
  // §88 A: the page's log lines (player timings) reach adb logcat in the signed build too
  loggingBehavior: 'production',
}

export default config
