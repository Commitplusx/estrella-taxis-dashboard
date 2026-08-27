import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // Permitir conexiones desde otros dispositivos en la red local (celulares)
    proxy: {
      // Proxy específico para el WebSocket
      '/api/socket': {
        target: 'wss://taxis.estrella-eats.mx',
        ws: true,
        changeOrigin: true,
        secure: false, // Puedes poner true si el SSL de Nginx ya es válido
        configure: (proxy, _options) => {
          proxy.on('proxyReqWs', (proxyReq, _req, _socket, _options, _head) => {
            proxyReq.removeHeader('Origin');
          });
        }
      },
      // Resto de la API REST de Traccar (GET, POST, PUT, DELETE)
      '/api': {
        target: 'https://taxis.estrella-eats.mx',
        changeOrigin: true,
        secure: false,
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            // Eliminar Origin para evitar que el filtro CSRF de Traccar (SessionHelper.isSessionOriginValid) tire 401
            proxyReq.removeHeader('Origin');
          });
          proxy.on('proxyRes', (proxyRes, _req, _res) => {
            // Eliminar CSP headers que Traccar manda en sus endpoints de reportes.
            delete proxyRes.headers['content-security-policy'];
            delete proxyRes.headers['content-security-policy-report-only'];
            delete proxyRes.headers['x-frame-options'];

            // Quitar el flag "Secure" de la cookie de sesión para que funcione en http:// local (celulares)
            if (proxyRes.headers['set-cookie']) {
              proxyRes.headers['set-cookie'] = proxyRes.headers['set-cookie'].map(cookie =>
                cookie.replace(/;\s*secure/i, '').replace(/;\s*SameSite=None/i, '; SameSite=Lax')
              );
            }
          });
        }
      },
    },
  },
})
