import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: [
      'localhost',
      'fps-game-web.loca.lt',
      'web-fps-game-ws.onrender.com'
    ],
    hmr: {
      // Enable HMR through localtunnel
      clientPort: 443,
      protocol: 'wss'
    }
  }
})
