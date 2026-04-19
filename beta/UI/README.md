# OpenClaw Beta UI

Electron-based visual shell for the `personal` OpenClaw agent.

## Scripts

- `npm run dev` starts Vite on `127.0.0.1:5173` and launches Electron.
- `npm run build` builds the renderer into `dist/`.
- `npm run typecheck` validates the TypeScript app without emitting files.
- `npm run start` launches Electron and serves the built renderer from a local loopback HTTP server.

## Notes

- The app reads runtime config from `~/.openclaw/openclaw.json`.
- The app does not modify `infrastructure/`.
- Gateway access uses the existing local token plus a device-signed WebSocket handshake.
- Voice input is `push-to-talk` via Web Speech API and falls back to text-only mode when unavailable.
