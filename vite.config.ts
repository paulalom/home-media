import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleMediaApi } from './server/media-library'

function mediaApiPlugin(): Plugin {
  return {
    name: 'home-media-api',
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
  plugins: [react(), mediaApiPlugin()],
})
