import { mergeConfig } from 'vite'
import { defineConfig } from 'vitest/config'
import base from './vite.config'

// material-color-utilities ships extensionless ES imports that Node can't resolve by itself
export default mergeConfig(base, defineConfig({
  test: { server: { deps: { inline: ['@material/material-color-utilities'] } } },
}))
