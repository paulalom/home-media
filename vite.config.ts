import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { handleMediaApi } from './server/media-library'

const packageJson = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: string }
const appVersion = packageJson.version ?? '0.0.0'

function mediaApiPlugin(): Plugin {
  return {
    name: 'my-home-media-server-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleMediaApi(req, res)
          .then((handled) => {
            if (!handled) {
              next()
            }
          })
          .catch(next)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        void handleMediaApi(req, res)
          .then((handled) => {
            if (!handled) {
              next()
            }
          })
          .catch(next)
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        tv: fileURLToPath(new URL('./tv.html', import.meta.url)),
      },
    },
  },
  define: {
    __HOME_MEDIA_APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    react(),
    legacy({
      modernPolyfills: true,
      targets: ['Chrome >= 47'],
    }),
    mediaApiPlugin(),
  ],
})
