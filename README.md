# Home Media

Home Media is a new local-first media server project intended to replace a Plex-style workflow with an app owned by this repository.

## Current Shape

- Vite, React, and TypeScript frontend.
- Local mock library data for films, shows, music, sources, streams, and server status.
- Responsive app shell that starts on the media dashboard instead of a marketing page.
- Local cover-art assets under `src/assets/posters`.

## Scripts

```sh
npm install
npm run dev
npm run lint
npm run build
```

## Next Milestones

1. Add a Node service for library scanning and metadata persistence.
2. Store media sources, title metadata, and playback sessions in SQLite.
3. Add file-system watchers for incremental scans.
4. Prototype playback and stream routing.
5. Add authentication and per-device access controls.

## Project Notes

The project currently uses mock data only. It is ready for the backend shape to be added without reworking the app surface.
