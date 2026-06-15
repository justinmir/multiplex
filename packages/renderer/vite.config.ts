import path from 'node:path'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      // `@app/core` is pure TypeScript (no Node deps), so the renderer bundles
      // it straight from source for dev ergonomics and live updates.
      '@app/core': path.resolve(__dirname, '../core/src/index.ts'),
      // `@app/preload` MUST resolve to its browser entry, not `src/index.ts`.
      // The source imports `electron`/`node:crypto`/`node:process`; bundling
      // those into the renderer pulls in electron's launcher shim, which
      // references `__dirname` and throws at module-eval in the browser ESM
      // context (blank/black screen). The browser build reads the
      // contextBridge-exposed `ipc`/`sha256sum`/`versions` off `globalThis`.
      '@app/preload': path.resolve(__dirname, '../preload/dist/_virtual_browser.mjs'),
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
})
