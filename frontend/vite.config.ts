import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 3000,
    proxy: {
      // BACKEND_URL is set to the Docker service name when running in Docker,
      // falls back to localhost for local development outside Docker.
      '/api': process.env.BACKEND_URL ?? 'http://localhost:8000',
      '/ws': { target: process.env.BACKEND_WS_URL ?? 'ws://localhost:8000', ws: true },
    },
  },
})
