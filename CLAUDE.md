# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
npm run dev          # Start Vite dev server (localhost:5173)
npm run server       # Start WebSocket server (port 8080)
npm run start:all    # Start everything (server + dev + localtunnels)
npm run build        # Production build to dist/
npm run preview      # Preview production build
```

No test or lint commands are configured.

## Environment Variables

- `VITE_WS_URL` - WebSocket server URL (e.g., `ws://localhost:8080`). Must use `VITE_` prefix for Vite build-time injection. See `.env.example`.

## Architecture

**Multiplayer FPS game** with a client-server architecture using WebSocket for real-time communication.

### Client (`src/main.js`, `index.html`)
- Three.js for 3D WebGL rendering with pointer lock for FPS controls
- Single large file (`main.js`, ~1600 lines) containing all game logic: rendering, input, networking, physics, UI
- `textureLoader.js` provides a shared Three.js `TextureLoader` instance
- Player identity (ID + color) persisted in localStorage

### Server (`server.js`)
- Node.js WebSocket server (~11K lines) using the `ws` library
- Manages player connections, position broadcasting, hit validation, and scoring
- Server-side validation: hit distance checks (< 4.0 units), invulnerability enforcement, player ID uniqueness

### WebSocket Message Protocol
JSON messages with a `type` field. Key types:
- **Client→Server**: `register`, `position`, `shoot`, `hit`
- **Server→Client**: `connected`, `init`, `error`, `playerJoined`, `playerLeft`, `playerMoved`, `playerShot`, `scoreUpdate`

### Game World
- 4 arenas arranged in a 2x2 grid (each 100x100 units), connected by color-coded teleport pads
- Procedural player models (head, body, arms, legs) with per-player colors
- Physics: gravity 20 u/s², jump force 8, move speed 15 u/s (30 sprinting)
- Projectile speed 50 u/s, lifetime 2s, hit radius 1.5 units
- Controls: WASD move, mouse look, click shoot, space jump, shift sprint, ctrl crouch, E teleport

### Networking Details
- Position updates throttled to ~60fps (16.67ms)
- WebSocket reconnection with exponential backoff (max 5 attempts)
- 2-second invulnerability after respawn

## Deployment

The project is configured for deployment on Render.com with localtunnel support for development. The Vite config allows specific hosts (`fps-game-web.loca.lt`, `web-fps-game-ws.onrender.com`) and configures HMR for secure tunnel usage (wss, port 443).
