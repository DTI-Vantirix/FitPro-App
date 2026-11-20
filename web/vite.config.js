import path from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// In development the web app talks to the local API through this proxy, so
// VITE_API_URL can stay empty. In a deployed build, set VITE_API_URL to the
// API's public URL (or serve both from one origin and leave it empty).
const API = process.env.FITPRO_API_PROXY || 'http://localhost:4000'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': API,
      '/uploads': API,
    },
  },
})
