import { defineConfig } from 'vite'

export default defineConfig({
  server: { port: Number(process.env.PORT) || 5213, strictPort: true, host: '127.0.0.1', hmr: process.env.NOHMR ? false : undefined },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
})
