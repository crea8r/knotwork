import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: [
      { find: '@app-shell', replacement: path.resolve(__dirname) },
      { find: '@core-api', replacement: path.resolve(__dirname, '../api') },
      { find: '@distributions', replacement: path.resolve(__dirname, '../../distributions') },
      { find: '@ui', replacement: path.resolve(__dirname, '../../libs/ui') },
      { find: '@storage', replacement: path.resolve(__dirname, '../../libs/browser-storage') },
      { find: '@sdk', replacement: path.resolve(__dirname, '../../libs/sdk') },
      { find: '@data-models', replacement: path.resolve(__dirname, '../../libs/data-models/index.ts') },
      { find: '@auth', replacement: path.resolve(__dirname, '../../libs/auth/index.ts') },
      { find: '@modules', replacement: path.resolve(__dirname, '../../modules') },
      { find: /^zustand$/, replacement: path.resolve(__dirname, './node_modules/zustand/esm/index.mjs') },
      { find: /^zustand\/middleware$/, replacement: path.resolve(__dirname, './node_modules/zustand/esm/middleware.mjs') },
      { find: 'react/jsx-runtime', replacement: path.resolve(__dirname, './node_modules/react/jsx-runtime.js') },
      { find: 'react/jsx-dev-runtime', replacement: path.resolve(__dirname, './node_modules/react/jsx-dev-runtime.js') },
      { find: 'react-dom/client', replacement: path.resolve(__dirname, './node_modules/react-dom/client.js') },
      { find: 'axios', replacement: path.resolve(__dirname, './node_modules/axios/index.js') },
      { find: '@tiptap/react', replacement: path.resolve(__dirname, './node_modules/@tiptap/react/dist/index.js') },
      { find: '@tiptap/starter-kit', replacement: path.resolve(__dirname, './node_modules/@tiptap/starter-kit/dist/index.js') },
      { find: '@tiptap/extension-underline', replacement: path.resolve(__dirname, './node_modules/@tiptap/extension-underline/dist/index.js') },
      { find: '@tiptap/extension-highlight', replacement: path.resolve(__dirname, './node_modules/@tiptap/extension-highlight/dist/index.js') },
      { find: '@tiptap/extension-text-style', replacement: path.resolve(__dirname, './node_modules/@tiptap/extension-text-style/dist/index.js') },
      { find: '@tiptap/extension-color', replacement: path.resolve(__dirname, './node_modules/@tiptap/extension-color/dist/index.js') },
      { find: '@tiptap/extension-link', replacement: path.resolve(__dirname, './node_modules/@tiptap/extension-link/dist/index.js') },
      { find: 'marked', replacement: path.resolve(__dirname, './node_modules/marked/lib/marked.esm.js') },
      { find: 'turndown', replacement: path.resolve(__dirname, './node_modules/turndown/lib/turndown.es.js') },
      { find: 'react-markdown', replacement: path.resolve(__dirname, './node_modules/react-markdown/index.js') },
      { find: 'remark-gfm', replacement: path.resolve(__dirname, './node_modules/remark-gfm/index.js') },
      { find: 'rehype-raw', replacement: path.resolve(__dirname, './node_modules/rehype-raw/index.js') },
      { find: 'react', replacement: path.resolve(__dirname, './node_modules/react/index.js') },
      { find: 'react-dom', replacement: path.resolve(__dirname, './node_modules/react-dom/index.js') },
      { find: 'react-router-dom', replacement: path.resolve(__dirname, './node_modules/react-router-dom/dist/index.js') },
      { find: 'lucide-react', replacement: path.resolve(__dirname, './node_modules/lucide-react/dist/esm/lucide-react.js') },
      { find: '@tanstack/react-query', replacement: path.resolve(__dirname, './node_modules/@tanstack/react-query/build/modern/index.js') },
      { find: '@dagrejs/dagre', replacement: path.resolve(__dirname, './node_modules/@dagrejs/dagre/dist/dagre.js') },
    ],
  },
  server: {
    port: parseInt(process.env.PORT ?? '3000'),
    fs: {
      allow: [path.resolve(__dirname, '../..')],
    },
  },
})
