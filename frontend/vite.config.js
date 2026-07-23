import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During local dev, proxy /api calls to the backend running on :8000
// so the frontend can use same-origin requests (matching the Ingress setup).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
