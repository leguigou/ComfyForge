import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appVersion = readFileSync(fileURLToPath(new URL('../VERSION', import.meta.url)), 'utf8').trim()
const entryChunkBudgetBytes = 450 * 1024

if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(appVersion)) {
  throw new Error('Invalid application version in VERSION')
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-app-version',
      closeBundle() {
        const serviceWorkerPath = fileURLToPath(new URL('./dist/sw.js', import.meta.url))
        const serviceWorker = readFileSync(serviceWorkerPath, 'utf8')
        writeFileSync(serviceWorkerPath, serviceWorker.replaceAll('__APP_VERSION__', appVersion))
      },
    },
    {
      name: 'entry-bundle-budget',
      generateBundle(_options, bundle) {
        const entry = Object.values(bundle).find(item => item.type === 'chunk' && item.isEntry)
        if (entry?.type !== 'chunk') throw new Error('Unable to locate the frontend entry chunk')
        const bytes = Buffer.byteLength(entry.code, 'utf8')
        if (bytes > entryChunkBudgetBytes) {
          throw new Error(`Frontend entry chunk is ${(bytes / 1024).toFixed(1)} KiB; budget is ${entryChunkBudgetBytes / 1024} KiB`)
        }
      },
    },
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  assetsInclude: ['**/*.md'],
  server: {
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: false,
        xfwd: true,
        ws: true
      }
    }
  }
})
