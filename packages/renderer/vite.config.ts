import path from 'node:path'
import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  resolve: {
    alias: {
      // Resolve workspace packages to their source for dev and build.
      // The `exports.types` field in each package points at src files,
      // but the bundler needs an explicit alias to find them.
      '@app/core': path.resolve(__dirname, '../core/src/index.ts'),
    },
  },
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
})
