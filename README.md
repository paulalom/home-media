# Home Media

Home Media is a new local-first media server project intended to replace a Plex-style workflow with an app owned by this repository.

## Current Shape

- Vite, React, and TypeScript frontend.
- Local Vite middleware API that scans `F:/media` for video files.
- Byte-range media streaming endpoint for browser playback.
- Movies and TV shows grouped as title-level library entries.
- Browser-local resume history for recently watched movies and shows.

## Scripts

```sh
npm install
npm run dev
npm run dev:lan
npm run lint
npm run build
npm run build:tv
npm run preview:lan
```

## Samsung TV Prototype

This repo includes a Tizen Web app prototype path for Samsung TVs. See [docs/samsung-tv-prototype.md](docs/samsung-tv-prototype.md) for building a `.wgt`, running the media server on your LAN, and installing the app on a developer-mode TV.

## Next Milestones

1. Store media sources, title metadata, and playback sessions in SQLite.
2. Add file-system watchers for incremental scans.
3. Add poster/metadata matching.
4. Add transcoding for containers Firefox cannot play directly.
5. Add authentication and per-device access controls.

## Project Notes

The project currently defaults to `F:/media`. Set `HOME_MEDIA_ROOT` before starting Vite to point the scanner at another folder.
