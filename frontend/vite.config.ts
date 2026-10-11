import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
        // Required for the retro board's socket.io connection, which is served
        // under /api/socket.io. Without this the WebSocket handshake 404s in dev.
        ws: true,
      }
    }
  }
})
