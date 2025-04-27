import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    allowedHosts: [
      'localhost',
      'fps-game-web.loca.lt'
    ],
    hmr: {
      // Enable HMR through localtunnel
      clientPort: 443,
      protocol: 'wss'
    }
  }
})
