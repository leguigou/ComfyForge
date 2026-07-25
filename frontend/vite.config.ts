import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const appVersion = readFileSync(fileURLToPath(new URL('../VERSION', import.meta.url)), 'utf8').trim()

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
