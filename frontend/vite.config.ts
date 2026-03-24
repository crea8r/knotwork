import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  // Read .env files from the project root (one level up from frontend/).
  envDir: '../',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    // No proxy — the browser calls the backend directly via VITE_API_URL.
  },
})
