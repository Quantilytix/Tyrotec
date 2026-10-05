import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Tests only: the app's own Vite config, plus the automatic JSX runtime so
// component tests can render JSX without importing React (as the app does).
export default mergeConfig(viteConfig, defineConfig({
  esbuild: { jsx: 'automatic' },
}))
