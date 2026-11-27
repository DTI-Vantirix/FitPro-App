import path from 'node:path'
import basicSsl from '@vitejs/plugin-basic-ssl'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the web app talks to the local API through this proxy, so
// VITE_API_URL can stay empty. In a deployed build, set VITE_API_URL to the
// API's public URL (or serve both from one origin and leave it empty).
const API = process.env.FITPRO_API_PROXY || 'http://localhost:4000'

// `npm run dev:phone` serves the site to the home network over https with a
// self-signed certificate. Browsers only share location with secure pages, so a
// phone opening the plain http address never gets asked for it.
const PHONE = process.env.FITPRO_PHONE === '1'

export default defineConfig({
  plugins: [react(), ...(PHONE ? [basicSsl()] : [])],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    host: PHONE ? true : undefined,
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
})
