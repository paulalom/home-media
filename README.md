# My Home Media Server

My Home Media Server is an opinionated, local-first media server focused on responsiveness: fast library scans, quick playback handoff, and browser/TV interfaces that stay snappy while the server handles media work.

## Current Shape

- Vite, React, and TypeScript frontend.
- Local Vite middleware API that scans `F:/media` for video files.
- Byte-range media streaming endpoint for browser playback.
- Movies and TV shows grouped as title-level library entries.
- Out-of-the-way file browser for one-off LAN downloads.
- Server-side JSON metadata store for watched/resume history, with browser-local fallback.

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

## Windows Startup

This repo includes Windows helpers for running the LAN dev server:

```powershell
.\scripts\start-server.ps1
.\scripts\install-windows-startup-task.ps1
.\scripts\uninstall-windows-startup-task.ps1
```

The startup task installer creates a per-user Scheduled Task named
`HomeMediaServer` that runs when the current Windows user logs in. The task runs
`npm run dev:lan` on the port configured in `package.json`, falling back to port
`23232` if no port is specified. Because it runs as the signed-in user, Desktop
sharing, metadata, artwork, and preview-cache folders resolve under that user's
profile.

If you previously installed the old machine-level WinSW service, remove it with:

```powershell
.\scripts\uninstall-windows-service.ps1
```

Library scans do not warm preview thumbnails automatically. Use the Preview cache
Warm button to generate missing thumbnails, or set
`HOME_MEDIA_AUTO_WARM_PREVIEW_CACHE=1` before starting the server to opt into
background warming.

Artwork is served by the local server from nearby `poster`, `folder`, `cover`,
or `artwork` image files first. If no local image exists, TV shows can fall back
to TVmaze without an API key, movies can fall back to IMDb suggestions without
an API key, and movies/TV shows can use TMDB when `HOME_MEDIA_TMDB_API_KEY` or
`HOME_MEDIA_TMDB_BEARER_TOKEN` is set. Downloaded images are cached outside the
repo under the same per-user app data location.

## Samsung TV Prototype

This repo includes a Tizen Web app prototype path for Samsung TVs. See [docs/samsung-tv-prototype.md](docs/samsung-tv-prototype.md) for building a `.wgt`, running the media server on your LAN, and installing the app on a developer-mode TV.

## Next Milestones

1. Promote media sources and title metadata into the shared metadata store.
2. Add file-system watchers for incremental scans.
3. Add poster/metadata matching.
4. Add transcoding for containers Firefox cannot play directly.
5. Add authentication and per-device access controls.

## Project Notes

The project currently defaults to `F:/media`. Set `HOME_MEDIA_ROOT` before starting Vite to point the scanner at another folder.

Generic file sharing defaults to your Desktop. Set `HOME_MEDIA_FILES_ROOT` before starting Vite to point the Files view at another folder.

Playback metadata is stored outside the repository by default at `%LOCALAPPDATA%/My Home Media Server/metadata.json` on Windows, or `~/.my-home-media-server/metadata.json` when no local app data directory is available. Set `HOME_MEDIA_METADATA_PATH` to choose a different JSON file. If you point it into this repo, use `.my-home-media-server/metadata.json` or `my-home-media-server-data/metadata.json`; both folders are ignored by git.
