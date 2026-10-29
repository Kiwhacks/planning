import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// En développement, `API_PORT=3001 pnpm dev` redirige /api vers le serveur local (`pnpm dev:api`).
const apiPort = process.env.API_PORT
const proxy = apiPort ? { '/api': { target: `http://localhost:${apiPort}`, changeOrigin: true } } : undefined

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: { proxy },
  preview: { proxy },
})
