import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // Proxy específico para el WebSocket
      '/api/socket': {
        target: 'wss://taxis.estrella-eats.mx',
        ws: true,
        changeOrigin: true,
        secure: false, // Puedes poner true si el SSL de Nginx ya es válido
        configure: (proxy, options) => {
          proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
            proxyReq.removeHeader('Origin');
          });
        }
      },
      // Resto de la API REST de Traccar (GET, POST, PUT, DELETE)
      '/api': {
        target: 'https://taxis.estrella-eats.mx',
        changeOrigin: true,
        secure: false,
        configure: (proxy, options) => {
          proxy.on('proxyReq', (proxyReq, req, res) => {
            // Eliminar Origin para evitar que el filtro CSRF de Traccar (SessionHelper.isSessionOriginValid) tire 401
            proxyReq.removeHeader('Origin');
          });
        }
      },
    },
  },
})
