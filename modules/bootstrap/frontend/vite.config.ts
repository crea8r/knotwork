// @ts-nocheck
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  envDir: path.resolve(__dirname, '../../..'),
  css: {
    postcss: path.resolve(__dirname, './postcss.config.js'),
  },
  resolve: {
    alias: [
      { find: '@ui', replacement: path.resolve(__dirname, '../../../libs/ui') },
      { find: '@modules', replacement: path.resolve(__dirname, '../../..', 'modules') },
      { find: '@storage', replacement: path.resolve(__dirname, '../../../libs/browser-storage') },
      { find: '@data-models', replacement: path.resolve(__dirname, '../../../libs/data-models/index.ts') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react/jsx-runtime.js') },
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react/jsx-dev-runtime.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react-dom/client.js') },
      { find: 'axios', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/axios/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react/index.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react-dom/index.js') },
      { find: 'react-router-dom', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/react-router-dom/dist/index.js') },
      { find: 'lucide-react', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/lucide-react/dist/esm/lucide-react.js') },
      { find: '@tanstack/react-query', replacement: path.resolve(__dirname, '../../../core/app-shell/node_modules/@tanstack/react-query/build/modern/index.js') },
    ],
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    proxy: {
      '/api/v1': {
        target: process.env.BOOTSTRAP_BACKEND_PROXY_URL ?? 'http://127.0.0.1:8010',
        changeOrigin: true,
      },
    },
    fs: {
      allow: [path.resolve(__dirname, '../../..')],
    },
  },
})
