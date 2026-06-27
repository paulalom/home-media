import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path'
import {
  parsePlaybackRecord,
  readPlaybackHistory,
  removePlaybackRecord,
  upsertPlaybackRecord,
} from './metadata-store'

export type MediaCategory = 'movie' | 'show' | 'other'

export type MediaItem = {
  id: string
  title: string
  category: MediaCategory
  artworkUrl?: string
  container: string
  browserPlayable: boolean
  relativePath: string
  folder: string
  source: string
  sizeBytes: number
  sizeLabel: string
  modifiedAt: string
  streamUrl: string
  showTitle?: string
  seasonNumber?: number
  episodeNumber?: number
  episodeTitle?: string
}

export type SourceSummary = {
  name: string
  path: string
  videoCount: number
  playableCount: number
  totalBytes: number
  sizeLabel: string
}

export type LibrarySummary = {
  root: string
  scannedAt: string
  totalVideos: number
  playableVideos: number
  totalBytes: number
  sizeLabel: string
  sources: number
}

export type LibraryResponse = {
  summary: LibrarySummary
  sources: SourceSummary[]
  items: MediaItem[]
}

export type FileShareEntryKind = 'directory' | 'file'

export type FileShareEntry = {
  id: string
  name: string
  kind: FileShareEntryKind
  relativePath: string
  sizeBytes: number
  sizeLabel: string
  modifiedAt: string
  downloadUrl?: string
}

export type FileShareSummary = {
  root: string
  relativePath: string
  parentPath: string | null
  scannedAt: string
  directories: number
  files: number
  totalBytes: number
  sizeLabel: string
}

export type FileShareResponse = {
  summary: FileShareSummary
  entries: FileShareEntry[]
}

type RangeRequest = {
  start: number
  end: number
}

type LibraryCache = {
  data: LibraryResponse
  root: string
}

type ArtworkCategory = Extract<MediaCategory, 'movie' | 'show'>

type ArtworkTarget = {
  cacheKey: string
  category: ArtworkCategory
  mediaPath: string
  relativePath: string
  searchTitle: string
  source: string
  title: string
  year?: number
}

type ArtworkProvider = 'imdb' | 'tmdb' | 'tvmaze'

type ArtworkCacheEntry = {
  cacheKey: string
  category: ArtworkCategory
  checkedAt: string
  contentType?: string
  fileName?: string
  lookupVersion?: number
  provider: ArtworkProvider | 'remote'
  sourceUrl?: string
  status: 'missing' | 'ready'
  title: string
}

type RemoteArtwork = {
  imageUrl: string
  provider: ArtworkProvider
  sourceUrl: string
}

type ResolvedArtwork = {
  cacheControl: string
  contentType: string
  filePath: string
}

type PreviewCacheState = 'clearing' | 'idle' | 'warming'

type PreviewCacheStatus = {
  cacheBytes: number
  cacheFiles: number
  cacheRoot: string
  cacheSizeLabel: string
  cachedFrames: number
  completedVideos: number
  cpuBudget: number
  currentTitle?: string
  failedFrames: number
  failedVideos: number
  generatedFrames: number
  intervalSeconds: number
  lastError?: string
  pendingFrames: number
  quality: PreviewFrameQuality
  startedAt?: string
  state: PreviewCacheState
  totalFrames: number
  totalVideos: number
  updatedAt: string
  width: number
  warmMode: PreviewCacheWarmMode
}

type TranscodeCacheState = 'clearing' | 'idle' | 'warming'

type TranscodeCacheStatus = {
  cacheBytes: number
  cacheFiles: number
  cacheRoot: string
  cacheSizeLabel: string
  cachedVideos: number
  completedVideos: number
  currentTitle?: string
  failedVideos: number
  generatedVideos: number
  lastError?: string
  pendingVideos: number
  state: TranscodeCacheState
  target: string
  totalVideos: number
  updatedAt: string
}

type ClientVideoProbe = {
  label: string
  mimeType: string
  result: string
}

type ClientProfile = {
  app: string
  avInfoVersion?: string
  firmware?: string
  is8K?: boolean
  isHdrTvSupport?: boolean
  isUhd?: boolean
  model?: string
  modelCode?: string
  productInfoVersion?: string
  realModel?: string
  reportedAt: string
  tizenVersion?: string
  userAgent?: string
  videoProbes: ClientVideoProbe[]
}

type PlaybackActivityState = 'closed' | 'ended' | 'open'

type PlaybackActivityReport = {
  clientId: string
  mediaId?: string
  state: PlaybackActivityState
}

type PlaybackActivityLease = {
  clientId: string
  expiresAt: number
  lastReportedAt: number
  mediaId: string
  state: Exclude<PlaybackActivityState, 'closed'>
}

type PreviewFrameQuality = keyof typeof PREVIEW_FRAME_SETTINGS

type PreviewCacheWarmMode = 'background' | 'foreground'

type PreviewCacheWarmRequest = {
  library: LibraryResponse
  mode: PreviewCacheWarmMode
}

type TranscodeCacheWarmRequest = {
  library: LibraryResponse
}

type TranscodeTarget = {
  cachePath: string
  mediaPath: string
  stats: Stats
}

type PreviewFrameGenerationOptions = {
  threads?: number
}

type PreviewSpriteSheetInfo = {
  sheetIndex: number
  sheetPath: string
  startFrameIndex: number
  startTime: number
  versionKey: string
}

type PreviewSpriteFrameInfo = PreviewSpriteSheetInfo & {
  column: number
  frameIndex: number
  frameTime: number
  row: number
}

type PreviewSprite = {
  column: number
  columns: number
  frameIndex: number
  frameWidth: number
  quality: PreviewFrameQuality
  row: number
  rows: number
  sheetIndex: number
  sheetUrl: string
  time: number
}

type JsonResponseOptions = {
  cacheControl?: string
}

type TmdbCredentials =
  | {
      apiKey: string
      bearerToken?: never
    }
  | {
      apiKey?: never
      bearerToken: string
    }

type TmdbSearchResult = {
  first_air_date?: string
  id?: number
  name?: string
  poster_path?: string | null
  release_date?: string
  title?: string
}

type TmdbSearchResponse = {
  results?: TmdbSearchResult[]
}

type ImdbSuggestionImage = {
  imageUrl?: string
}

type ImdbSuggestionResult = {
  i?: ImdbSuggestionImage
  id?: string
  l?: string
  q?: string
  qid?: string
  rank?: number
  y?: number
}

type ImdbSuggestionResponse = {
  d?: ImdbSuggestionResult[]
}

type TvmazeShow = {
  id?: number
  image?: {
    medium?: string
    original?: string
  } | null
  name?: string
  premiered?: string
  url?: string
}

const DEFAULT_MEDIA_ROOT = 'F:/media'
const DEFAULT_FILE_SHARE_DIRECTORY_NAME = 'Desktop'
const ARTWORK_CACHE_DIRECTORY_NAME = 'My Home Media Server'
const PREVIEW_FRAME_CACHE_DIRECTORY_NAME = 'preview-frames'
const TRANSCODE_CACHE_DIRECTORY_NAME = 'encoded-videos'
const VIDEO_EXTENSIONS = new Set([
  '.avi',
  '.divx',
  '.m4v',
  '.mkv',
  '.mov',
  '.mp4',
  '.ogv',
  '.webm',
  '.wmv',
])
const BROWSER_PLAYABLE_EXTENSIONS = new Set([
  '.m4v',
  '.mov',
  '.mp4',
  '.ogv',
  '.webm',
])
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const IGNORED_TOP_LEVEL_SOURCES = new Set(['mixes', 'music'])
const ARTWORK_NAMES = ['poster', 'folder', 'cover', 'artwork']
const IMDB_SUGGESTION_BASE_URL = 'https://v3.sg.media-imdb.com/suggestion'
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500'
const TVMAZE_API_BASE_URL = 'https://api.tvmaze.com'
const REMOTE_METADATA_USER_AGENT =
  'My Home Media Server/0.0.0 (local personal media server)'
const ARTWORK_LOOKUP_VERSION = 2
const ARTWORK_FETCH_TIMEOUT_MS = 10_000
const ARTWORK_MISSING_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ARTWORK_BYTES = 8 * 1024 * 1024
const PREVIEW_FRAME_TIMEOUT_MS = 8_000
const PREVIEW_FRAME_PROBE_TIMEOUT_MS = 8_000
const PREVIEW_SPRITE_SHEET_MAX_TIMEOUT_MS = 10 * 60_000
const PREVIEW_SPRITE_SHEET_TIMEOUT_MS_PER_FRAME = 1_000
const MAX_PREVIEW_FRAME_BYTES = 3 * 1024 * 1024
const PREVIEW_FRAME_SETTINGS = {
  high: {
    fastSeek: false,
    jpegQuality: 4,
    timeBucketSeconds: 1,
    width: 960,
  },
  low: {
    fastSeek: true,
    jpegQuality: 12,
    timeBucketSeconds: 5,
    width: 240,
  },
} as const
const PREVIEW_CACHE_FRAME_INTERVAL_SECONDS = 5
const PREVIEW_CACHE_QUALITY: PreviewFrameQuality = 'low'
const PREVIEW_CACHE_BACKGROUND_COOLDOWN_MS = 2_000
const PREVIEW_CACHE_BACKGROUND_CPU_BUDGET = 0.25
const PREVIEW_CACHE_BACKGROUND_FFMPEG_THREADS = 8
const PREVIEW_CACHE_BACKGROUND_SHEET_CONCURRENCY = 4
const PREVIEW_CACHE_FOREGROUND_CPU_BUDGET = 1
const PREVIEW_CACHE_FOREGROUND_SHEET_CONCURRENCY = 4
const PREVIEW_SPRITE_COLUMNS = 10
const PREVIEW_SPRITE_ROWS = 6
const PREVIEW_SPRITE_FRAMES_PER_SHEET =
  PREVIEW_SPRITE_COLUMNS * PREVIEW_SPRITE_ROWS
const TRANSCODE_CACHE_BACKGROUND_COOLDOWN_MS = 2_000
const TRANSCODE_TARGET_LABEL = 'MP4 H.264/AAC'
const PLAYBACK_ACTIVITY_HEARTBEAT_TTL_MS = 90_000
const PLAYBACK_ACTIVITY_ENDED_GRACE_MS = 5 * 60_000
const PLAYBACK_ACTIVITY_CLEANUP_INTERVAL_MS = 15_000
const PLAYBACK_ACTIVITY_POWER_REFRESH_SECONDS = 30
const PLAYBACK_ACTIVITY_MAX_CLIENT_ID_LENGTH = 128
const PLAYBACK_ACTIVITY_MAX_MEDIA_ID_LENGTH = 2048

const MIME_BY_EXTENSION = new Map([
  ['.avi', 'video/x-msvideo'],
  ['.divx', 'video/divx'],
  ['.m4v', 'video/mp4'],
  ['.mkv', 'video/x-matroska'],
  ['.mov', 'video/quicktime'],
  ['.mp4', 'video/mp4'],
  ['.ogv', 'video/ogg'],
  ['.webm', 'video/webm'],
  ['.wmv', 'video/x-ms-wmv'],
])
const IMAGE_MIME_BY_EXTENSION = new Map([
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp'],
])
const GENERIC_FILE_MIME_BY_EXTENSION = new Map([
  ['.7z', 'application/x-7z-compressed'],
  ['.aac', 'audio/aac'],
  ['.csv', 'text/csv; charset=utf-8'],
  ['.doc', 'application/msword'],
  [
    '.docx',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8'],
  ['.mp3', 'audio/mpeg'],
  ['.pdf', 'application/pdf'],
  ['.ppt', 'application/vnd.ms-powerpoint'],
  [
    '.pptx',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ],
  ['.rar', 'application/vnd.rar'],
  ['.rtf', 'application/rtf'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wav', 'audio/wav'],
  ['.xls', 'application/vnd.ms-excel'],
  [
    '.xlsx',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ],
  ['.zip', 'application/zip'],
])
const IMAGE_EXTENSION_BY_MIME = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
])
const API_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Allow-Methods':
    'DELETE, GET, HEAD, OPTIONS, PATCH, POST, PUT',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Disposition, Content-Length, Content-Range, Content-Type',
  'Timing-Allow-Origin': '*',
}
const MAX_JSON_BODY_BYTES = 64 * 1024
let libraryCache: LibraryCache | null = null
const artworkFetches = new Map<string, Promise<ResolvedArtwork | null>>()
const previewCacheActiveWarmFrames = new Set<Promise<void>>()
const transcodeCacheActiveWarmVideos = new Set<Promise<void>>()
let previewCacheWarmMode: PreviewCacheWarmMode = 'background'
let previewCacheStatus = createInitialPreviewCacheStatus()
let previewCacheWarmRequest: PreviewCacheWarmRequest | null = null
let previewCacheWarmRunId = 0
let previewCacheWarmRunning = false
let transcodeCacheStatus = createInitialTranscodeCacheStatus()
let transcodeCacheWarmRequest: TranscodeCacheWarmRequest | null = null
let transcodeCacheWarmRunId = 0
let transcodeCacheWarmRunning = false
let latestClientProfile: ClientProfile | null = null
const playbackActivityLeases = new Map<string, PlaybackActivityLease>()
let playbackActivityCleanupTimer: NodeJS.Timeout | null = null
let systemAwakeProcess: ChildProcess | null = null
let systemAwakeRestartTimer: NodeJS.Timeout | null = null
let systemAwakeStartErrorLogged = false
const previewFrameFetches = new Map<string, Promise<string>>()
const transcodeCacheEncodes = new Map<string, Promise<string>>()

export function getMediaRoot() {
  return process.env.HOME_MEDIA_ROOT ?? DEFAULT_MEDIA_ROOT
}

export function getFileShareRoot() {
  const configuredRoot = process.env.HOME_MEDIA_FILES_ROOT?.trim()

  return configuredRoot
    ? resolve(configuredRoot)
    : resolve(homedir(), DEFAULT_FILE_SHARE_DIRECTORY_NAME)
}

export function getArtworkCacheRoot() {
  const configuredRoot = process.env.HOME_MEDIA_ARTWORK_CACHE_ROOT?.trim()

  if (configuredRoot) {
    return resolve(configuredRoot)
  }

  const localAppData = process.env.LOCALAPPDATA?.trim()

  return localAppData
    ? resolve(localAppData, ARTWORK_CACHE_DIRECTORY_NAME, 'artwork')
    : resolve(homedir(), '.my-home-media-server', 'artwork')
}

export function getPreviewFrameCacheRoot() {
  const configuredRoot = process.env.HOME_MEDIA_PREVIEW_CACHE_ROOT?.trim()

  if (configuredRoot) {
    return resolve(configuredRoot)
  }

  const localAppData = process.env.LOCALAPPDATA?.trim()

  return localAppData
    ? resolve(
        localAppData,
        ARTWORK_CACHE_DIRECTORY_NAME,
        PREVIEW_FRAME_CACHE_DIRECTORY_NAME,
      )
    : resolve(
        homedir(),
        '.my-home-media-server',
        PREVIEW_FRAME_CACHE_DIRECTORY_NAME,
      )
}

export function getTranscodeCacheRoot() {
  const configuredRoot = process.env.HOME_MEDIA_TRANSCODE_CACHE_ROOT?.trim()

  if (configuredRoot) {
    return resolve(configuredRoot)
  }

  const localAppData = process.env.LOCALAPPDATA?.trim()

  return localAppData
    ? resolve(
        localAppData,
        ARTWORK_CACHE_DIRECTORY_NAME,
        TRANSCODE_CACHE_DIRECTORY_NAME,
      )
    : resolve(
        homedir(),
        '.my-home-media-server',
        TRANSCODE_CACHE_DIRECTORY_NAME,
      )
}

export async function scanMediaLibrary(
  root = getMediaRoot(),
): Promise<LibraryResponse> {
  const absoluteRoot = resolve(root)
  const sourceMap = new Map<string, SourceSummary>()
  const items: MediaItem[] = []

  await collectMediaFiles(absoluteRoot, absoluteRoot, sourceMap, items)

  items.sort((first, second) => {
    if (first.browserPlayable !== second.browserPlayable) {
      return first.browserPlayable ? -1 : 1
    }

    return first.title.localeCompare(second.title, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  })

  const sources = Array.from(sourceMap.values()).sort((first, second) =>
    first.name.localeCompare(second.name, undefined, {
      numeric: true,
      sensitivity: 'base',
    }),
  )
  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0)
  const playableVideos = items.filter((item) => item.browserPlayable).length

  return {
    summary: {
      root: absoluteRoot,
      scannedAt: new Date().toISOString(),
      totalVideos: items.length,
      playableVideos,
      totalBytes,
      sizeLabel: formatBytes(totalBytes),
      sources: sources.length,
    },
    sources,
    items,
  }
}

export async function readFileShareDirectory(
  requestedPath = '',
): Promise<FileShareResponse> {
  const root = resolve(getFileShareRoot())
  const directory = getFileShareDirectoryPath(root, requestedPath)

  if (!directory) {
    throw createHttpError(400, 'Invalid file path')
  }

  let directoryStats: Stats

  try {
    directoryStats = await fs.stat(directory)
  } catch {
    throw createHttpError(404, 'File share folder not found')
  }

  if (!directoryStats.isDirectory()) {
    throw createHttpError(404, 'File share folder not found')
  }

  if (!(await isPathInsideRealRoot(root, directory))) {
    throw createHttpError(400, 'Invalid file path')
  }

  let entries

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    throw createHttpError(403, 'File share folder cannot be opened')
  }

  const fileEntries: FileShareEntry[] = []
  let directories = 0
  let files = 0
  let totalBytes = 0

  for (const entry of entries) {
    const isDirectory = entry.isDirectory()
    const isRegularFile = entry.isFile()

    if (entry.isSymbolicLink() || (!isDirectory && !isRegularFile)) {
      continue
    }

    const entryPath = resolve(directory, entry.name)

    if (!isPathInside(root, entryPath)) {
      continue
    }

    let stats: Stats

    try {
      stats = await fs.lstat(entryPath)
    } catch {
      continue
    }

    const relativePath = relative(root, entryPath)
    const fileId = encodeFileId(relativePath)
    const sizeBytes = isRegularFile ? stats.size : 0

    if (isDirectory) {
      directories += 1
    } else {
      files += 1
      totalBytes += stats.size
    }

    fileEntries.push({
      id: fileId,
      name: entry.name,
      kind: isDirectory ? 'directory' : 'file',
      relativePath,
      sizeBytes,
      sizeLabel: isRegularFile ? formatBytes(sizeBytes) : '',
      modifiedAt: stats.mtime.toISOString(),
      downloadUrl: isRegularFile
        ? `/api/files/${encodeURIComponent(fileId)}/download`
        : undefined,
    })
  }

  fileEntries.sort(sortFileShareEntries)

  const relativePath = relative(root, directory)
  const normalizedRelativePath = relativePath === '.' ? '' : relativePath
  const parentRelativePath = normalizedRelativePath
    ? relative(root, dirname(directory))
    : null

  return {
    summary: {
      root,
      relativePath: normalizedRelativePath,
      parentPath:
        parentRelativePath === null || parentRelativePath === '.'
          ? null
          : parentRelativePath,
      scannedAt: new Date().toISOString(),
      directories,
      files,
      totalBytes,
      sizeLabel: formatBytes(totalBytes),
    },
    entries: fileEntries,
  }
}

export async function handleMediaApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://my-home-media-server.local')
  const isApiPath =
    url.pathname === '/api/client-profile' ||
    url.pathname === '/api/files' ||
    url.pathname === '/api/library' ||
    url.pathname === '/api/playback' ||
    url.pathname === '/api/playback-activity' ||
    url.pathname === '/api/preview-cache' ||
    url.pathname === '/api/transcode-cache' ||
    /^\/api\/files\/[^/]+\/download$/.test(url.pathname) ||
    /^\/api\/playback\/[^/]+$/.test(url.pathname) ||
    /^\/api\/media\/[^/]+\/(?:artwork|preview-frame|preview-sheet|preview-sprite|stream|transcode)$/.test(
      url.pathname,
    )

  if (isApiPath && req.method === 'OPTIONS') {
    res.writeHead(204, API_CORS_HEADERS)
    res.end()

    return true
  }

  if (url.pathname === '/api/client-profile') {
    if (req.method === 'GET') {
      sendJson(res, { profile: latestClientProfile })
      return true
    }

    if (req.method === 'POST') {
      try {
        latestClientProfile = normalizeClientProfile(await readJsonBody(req))
        sendJson(res, latestClientProfile)
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    sendMethodNotAllowed(res, ['GET', 'POST'])
    return true
  }

  if (url.pathname === '/api/files') {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, ['GET'])
      return true
    }

    try {
      sendJson(
        res,
        await readFileShareDirectory(url.searchParams.get('path') ?? ''),
      )
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  if (url.pathname === '/api/library') {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, ['GET'])
      return true
    }

    try {
      sendJson(
        res,
        await getCachedLibrary(
          url.searchParams.get('refresh') === '1',
          getAutoPreviewCacheWarmMode(),
        ),
      )
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  if (url.pathname === '/api/preview-cache') {
    if (req.method === 'GET') {
      try {
        sendJson(res, await getPreviewCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    if (req.method === 'POST') {
      try {
        ensurePreviewCacheWarm(await getCachedLibrary(false, null), 'foreground')
        sendJson(res, await getPreviewCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    if (req.method === 'DELETE') {
      try {
        await clearPreviewCache()
        sendJson(res, await getPreviewCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    sendMethodNotAllowed(res, ['DELETE', 'GET', 'POST'])
    return true
  }

  if (url.pathname === '/api/transcode-cache') {
    if (req.method === 'GET') {
      try {
        sendJson(res, await getTranscodeCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    if (req.method === 'POST') {
      try {
        ensureTranscodeCacheWarm(await getCachedLibrary(false, null))
        sendJson(res, await getTranscodeCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    if (req.method === 'DELETE') {
      try {
        await clearTranscodeCache()
        sendJson(res, await getTranscodeCacheStatus())
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    sendMethodNotAllowed(res, ['DELETE', 'GET', 'POST'])
    return true
  }

  if (url.pathname === '/api/playback') {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, ['GET'])
      return true
    }

    try {
      sendJson(res, await readPlaybackHistory())
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  if (url.pathname === '/api/playback-activity') {
    if (req.method === 'GET') {
      updateSystemAwakeRequest(Date.now())
      sendJson(res, getPlaybackActivityStatus(Date.now()))
      return true
    }

    if (req.method === 'POST') {
      try {
        updatePlaybackActivity(
          normalizePlaybackActivityReport(await readJsonBody(req)),
        )
        sendJson(res, getPlaybackActivityStatus(Date.now()))
      } catch (error) {
        sendError(res, getErrorStatusCode(error), getErrorMessage(error))
      }

      return true
    }

    sendMethodNotAllowed(res, ['GET', 'POST'])
    return true
  }

  const playbackMatch = /^\/api\/playback\/([^/]+)$/.exec(url.pathname)

  if (playbackMatch) {
    if (req.method !== 'DELETE' && req.method !== 'PATCH' && req.method !== 'PUT') {
      sendMethodNotAllowed(res, ['DELETE', 'PATCH', 'PUT'])
      return true
    }

    const mediaId = decodeUrlSegment(playbackMatch[1])

    if (!mediaId) {
      sendError(res, 400, 'Invalid media id')
      return true
    }

    try {
      if (req.method === 'DELETE') {
        await removePlaybackRecord(mediaId)
        sendNoContent(res)
        return true
      }

      const playbackRecord = parsePlaybackRecord(await readJsonBody(req))

      if (!playbackRecord) {
        sendError(res, 400, 'Invalid playback record')
        return true
      }

      sendJson(res, await upsertPlaybackRecord(mediaId, playbackRecord))
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  const fileDownloadMatch = /^\/api\/files\/([^/]+)\/download$/.exec(
    url.pathname,
  )

  if (fileDownloadMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    const fileId = decodeUrlSegment(fileDownloadMatch[1])

    if (!fileId) {
      sendError(res, 400, 'Invalid file id')
      return true
    }

    try {
      await streamSharedFile(fileId, req, res)
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  const streamMatch = /^\/api\/media\/([^/]+)\/stream$/.exec(url.pathname)

  if (streamMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      await streamMedia(streamMatch[1], req, res)
    } catch (error) {
      sendError(res, 500, getErrorMessage(error))
    }

    return true
  }

  const transcodeMatch = /^\/api\/media\/([^/]+)\/transcode$/.exec(
    url.pathname,
  )

  if (transcodeMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      await streamTranscodedMedia(transcodeMatch[1], req, res)
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  const artworkMatch = /^\/api\/media\/([^/]+)\/artwork$/.exec(url.pathname)

  if (artworkMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      await streamArtwork(
        artworkMatch[1],
        req,
        res,
        url.searchParams.get('refresh') === '1',
      )
    } catch (error) {
      sendError(res, 500, getErrorMessage(error))
    }

    return true
  }

  const previewFrameMatch = /^\/api\/media\/([^/]+)\/preview-frame$/.exec(
    url.pathname,
  )

  if (previewFrameMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      await streamPreviewFrame(previewFrameMatch[1], req, res, url.searchParams)
    } catch (error) {
      sendError(res, 500, getErrorMessage(error))
    }

    return true
  }

  const previewSpriteMatch = /^\/api\/media\/([^/]+)\/preview-sprite$/.exec(
    url.pathname,
  )

  if (previewSpriteMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      const previewSprite = await resolvePreviewSpriteForRequest(
        previewSpriteMatch[1],
        url.searchParams,
      )

      if (req.method === 'HEAD') {
        sendNoContent(res)
      } else {
        sendJson(res, previewSprite, {
          cacheControl: url.searchParams.has('v')
            ? 'public, max-age=604800, immutable'
            : 'public, max-age=60',
        })
      }
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  const previewSheetMatch = /^\/api\/media\/([^/]+)\/preview-sheet$/.exec(
    url.pathname,
  )

  if (previewSheetMatch) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendMethodNotAllowed(res, ['GET', 'HEAD'])
      return true
    }

    try {
      await streamPreviewSheet(previewSheetMatch[1], req, res, url.searchParams)
    } catch (error) {
      sendError(res, getErrorStatusCode(error), getErrorMessage(error))
    }

    return true
  }

  return false
}

async function getCachedLibrary(
  refresh: boolean,
  warmMode: PreviewCacheWarmMode | null = 'background',
) {
  const root = getMediaRoot()

  if (!refresh && libraryCache?.root === root) {
    return libraryCache.data
  }

  const data = await scanMediaLibrary(root)
  libraryCache = {
    data,
    root,
  }

  if (warmMode) {
    ensurePreviewCacheWarm(data, warmMode)
  }

  return data
}

function getAutoPreviewCacheWarmMode(): PreviewCacheWarmMode | null {
  const value = process.env.HOME_MEDIA_AUTO_WARM_PREVIEW_CACHE?.trim()
    .toLowerCase()

  return value === '1' || value === 'true' || value === 'yes' || value === 'on'
    ? 'background'
    : null
}

function ensurePreviewCacheWarm(
  library: LibraryResponse,
  mode: PreviewCacheWarmMode,
) {
  previewCacheWarmRequest = {
    library,
    mode,
  }

  if (mode === 'foreground') {
    previewCacheWarmMode = mode
    previewCacheStatus = {
      ...previewCacheStatus,
      ...getPreviewCacheWarmStatusFields(mode),
      updatedAt: new Date().toISOString(),
    }
  }

  if (!previewCacheWarmRunning) {
    void runPreviewCacheWarmLoop().catch((error: unknown) => {
      previewCacheStatus = {
        ...previewCacheStatus,
        currentTitle: undefined,
        lastError: getErrorMessage(error),
        state: 'idle',
        updatedAt: new Date().toISOString(),
      }
      previewCacheWarmRunning = false
    })
  }
}

async function runPreviewCacheWarmLoop() {
  if (previewCacheWarmRunning) {
    return
  }

  previewCacheWarmRunning = true

  try {
    while (previewCacheWarmRequest) {
      const request = previewCacheWarmRequest
      const runId = ++previewCacheWarmRunId

      previewCacheWarmRequest = null
      previewCacheWarmMode = request.mode
      await warmPreviewCacheForLibrary(request.library, runId)
    }
  } finally {
    previewCacheWarmRunning = false

    if (previewCacheWarmRequest) {
      const request = previewCacheWarmRequest

      ensurePreviewCacheWarm(request.library, request.mode)
    }
  }
}

async function warmPreviewCacheForLibrary(
  library: LibraryResponse,
  runId: number,
) {
  const startedAt = new Date().toISOString()
  const items = library.items

  previewCacheStatus = {
    ...createInitialPreviewCacheStatus('warming'),
    ...getPreviewCacheWarmStatusFields(previewCacheWarmMode),
    startedAt,
    totalVideos: items.length,
    updatedAt: startedAt,
  }

  for (const item of items) {
    if (runId !== previewCacheWarmRunId) {
      return
    }

    await warmPreviewCacheForItem(item, runId)
  }

  if (runId === previewCacheWarmRunId) {
    previewCacheStatus = {
      ...previewCacheStatus,
      currentTitle: undefined,
      pendingFrames: 0,
      state: 'idle',
      updatedAt: new Date().toISOString(),
    }
  }
}

async function warmPreviewCacheForItem(item: MediaItem, runId: number) {
  previewCacheStatus = {
    ...previewCacheStatus,
    currentTitle: getMediaItemDisplayTitle(item),
    updatedAt: new Date().toISOString(),
  }

  try {
    const mediaPath = getMediaPath(item.id)

    if (!mediaPath) {
      throw new Error('Media not found')
    }

    const stats = await fs.stat(mediaPath)

    if (!stats.isFile()) {
      throw new Error('Media not found')
    }

    const duration = await probeMediaDuration(mediaPath)

    if (runId !== previewCacheWarmRunId) {
      return
    }

    const frameTimes = getPreviewCacheFrameTimes(duration)
    const missingFrameTimes: number[] = []
    const generatedSheetIndexes = new Set<number>()

    previewCacheStatus = {
      ...previewCacheStatus,
      totalFrames: previewCacheStatus.totalFrames + frameTimes.length,
      updatedAt: new Date().toISOString(),
    }

    for (const frameTime of frameTimes) {
      if (runId !== previewCacheWarmRunId) {
        return
      }

      const sheetInfo = getPreviewSpriteSheetInfo(
        item.id,
        mediaPath,
        stats,
        frameTime,
        PREVIEW_CACHE_QUALITY,
      )

      if (await isFile(sheetInfo.sheetPath)) {
        previewCacheStatus = {
          ...previewCacheStatus,
          cachedFrames: previewCacheStatus.cachedFrames + 1,
          updatedAt: new Date().toISOString(),
        }
      } else {
        missingFrameTimes.push(frameTime)
        generatedSheetIndexes.add(sheetInfo.sheetIndex)
      }
    }

    previewCacheStatus = {
      ...previewCacheStatus,
      pendingFrames: previewCacheStatus.pendingFrames + missingFrameTimes.length,
      updatedAt: new Date().toISOString(),
    }

    await warmMissingPreviewSheets(
      item.id,
      mediaPath,
      stats,
      missingFrameTimes,
      generatedSheetIndexes,
      runId,
    )

    if (runId !== previewCacheWarmRunId) {
      return
    }

    previewCacheStatus = {
      ...previewCacheStatus,
      completedVideos: previewCacheStatus.completedVideos + 1,
      updatedAt: new Date().toISOString(),
    }
  } catch (error) {
    if (runId !== previewCacheWarmRunId) {
      return
    }

    previewCacheStatus = {
      ...previewCacheStatus,
      completedVideos: previewCacheStatus.completedVideos + 1,
      failedVideos: previewCacheStatus.failedVideos + 1,
      lastError: getErrorMessage(error),
      updatedAt: new Date().toISOString(),
    }
  }
}

async function getPreviewCacheStatus(): Promise<PreviewCacheStatus> {
  const directoryStats = await getDirectoryStats(getPreviewFrameCacheRoot())

  return {
    ...previewCacheStatus,
    cacheBytes: directoryStats.bytes,
    cacheFiles: directoryStats.files,
    cacheRoot: getPreviewFrameCacheRoot(),
    cacheSizeLabel: formatBytes(directoryStats.bytes),
  }
}

async function clearPreviewCache() {
  const cacheRoot = getPreviewFrameCacheRoot()

  assertSafePreviewCacheRoot(cacheRoot)
  previewCacheWarmRequest = null
  previewCacheWarmRunId += 1
  previewFrameFetches.clear()
  previewCacheStatus = {
    ...createInitialPreviewCacheStatus('clearing'),
    updatedAt: new Date().toISOString(),
  }

  await Promise.allSettled([...previewCacheActiveWarmFrames])

  await fs.rm(cacheRoot, { force: true, recursive: true })
  await fs.mkdir(cacheRoot, { recursive: true })

  previewCacheStatus = {
    ...createInitialPreviewCacheStatus('idle'),
    updatedAt: new Date().toISOString(),
  }
}

function createInitialPreviewCacheStatus(
  state: PreviewCacheState = 'idle',
): PreviewCacheStatus {
  const cacheRoot = getPreviewFrameCacheRoot()

  return {
    cacheBytes: 0,
    cacheFiles: 0,
    cacheRoot,
    cacheSizeLabel: formatBytes(0),
    cachedFrames: 0,
    completedVideos: 0,
    ...getPreviewCacheWarmStatusFields(previewCacheWarmMode),
    failedFrames: 0,
    failedVideos: 0,
    generatedFrames: 0,
    intervalSeconds: PREVIEW_CACHE_FRAME_INTERVAL_SECONDS,
    pendingFrames: 0,
    quality: PREVIEW_CACHE_QUALITY,
    state,
    totalFrames: 0,
    totalVideos: 0,
    updatedAt: new Date().toISOString(),
    width: PREVIEW_FRAME_SETTINGS[PREVIEW_CACHE_QUALITY].width,
  }
}

function ensureTranscodeCacheWarm(library: LibraryResponse) {
  transcodeCacheWarmRequest = {
    library,
  }

  if (transcodeCacheStatus.state === 'idle') {
    transcodeCacheStatus = {
      ...transcodeCacheStatus,
      state: 'warming',
      updatedAt: new Date().toISOString(),
    }
  }

  if (!transcodeCacheWarmRunning) {
    void runTranscodeCacheWarmLoop().catch((error: unknown) => {
      transcodeCacheStatus = {
        ...transcodeCacheStatus,
        lastError: getErrorMessage(error),
        state: 'idle',
        updatedAt: new Date().toISOString(),
      }
      transcodeCacheWarmRunning = false
    })
  }
}

async function runTranscodeCacheWarmLoop() {
  if (transcodeCacheWarmRunning) {
    return
  }

  transcodeCacheWarmRunning = true

  try {
    while (transcodeCacheWarmRequest) {
      const request = transcodeCacheWarmRequest
      const runId = ++transcodeCacheWarmRunId

      transcodeCacheWarmRequest = null
      await warmTranscodeCache(request.library, runId)
    }
  } finally {
    transcodeCacheWarmRunning = false

    if (transcodeCacheWarmRequest) {
      const request = transcodeCacheWarmRequest

      ensureTranscodeCacheWarm(request.library)
    }
  }
}

async function warmTranscodeCache(library: LibraryResponse, runId: number) {
  const candidates = library.items.filter((item) => !item.browserPlayable)

  transcodeCacheStatus = {
    ...createInitialTranscodeCacheStatus('warming'),
    pendingVideos: candidates.length,
    totalVideos: candidates.length,
    updatedAt: new Date().toISOString(),
  }

  for (const item of candidates) {
    if (runId !== transcodeCacheWarmRunId) {
      return
    }

    transcodeCacheStatus = {
      ...transcodeCacheStatus,
      currentTitle: getMediaItemDisplayTitle(item),
      updatedAt: new Date().toISOString(),
    }

    try {
      const target = await getTranscodeTarget(item.id)

      if (await isFile(target.cachePath)) {
        markTranscodeCacheVideoCached()
        continue
      }

      await trackActiveTranscodeCacheWarm(
        encodeTranscodeCacheFile(target),
      )

      if (runId !== transcodeCacheWarmRunId) {
        return
      }

      markTranscodeCacheVideoGenerated()
      await throttleTranscodeCacheWarm(runId)
    } catch (error) {
      if (runId !== transcodeCacheWarmRunId) {
        return
      }

      markTranscodeCacheVideoFailed(getErrorMessage(error))
    }
  }

  if (runId === transcodeCacheWarmRunId) {
    transcodeCacheStatus = {
      ...transcodeCacheStatus,
      currentTitle: undefined,
      state: 'idle',
      updatedAt: new Date().toISOString(),
    }
  }
}

async function getTranscodeCacheStatus(): Promise<TranscodeCacheStatus> {
  const directoryStats = await getDirectoryStats(getTranscodeCacheRoot())

  return {
    ...transcodeCacheStatus,
    cacheBytes: directoryStats.bytes,
    cacheFiles: directoryStats.files,
    cacheRoot: getTranscodeCacheRoot(),
    cacheSizeLabel: formatBytes(directoryStats.bytes),
  }
}

async function clearTranscodeCache() {
  const cacheRoot = getTranscodeCacheRoot()

  assertSafeTranscodeCacheRoot(cacheRoot)
  transcodeCacheWarmRequest = null
  transcodeCacheWarmRunId += 1
  transcodeCacheEncodes.clear()
  transcodeCacheStatus = {
    ...createInitialTranscodeCacheStatus('clearing'),
    updatedAt: new Date().toISOString(),
  }

  await Promise.allSettled([...transcodeCacheActiveWarmVideos])

  await fs.rm(cacheRoot, { force: true, recursive: true })
  await fs.mkdir(cacheRoot, { recursive: true })

  transcodeCacheStatus = {
    ...createInitialTranscodeCacheStatus('idle'),
    updatedAt: new Date().toISOString(),
  }
}

function createInitialTranscodeCacheStatus(
  state: TranscodeCacheState = 'idle',
): TranscodeCacheStatus {
  const cacheRoot = getTranscodeCacheRoot()

  return {
    cacheBytes: 0,
    cacheFiles: 0,
    cacheRoot,
    cacheSizeLabel: formatBytes(0),
    cachedVideos: 0,
    completedVideos: 0,
    failedVideos: 0,
    generatedVideos: 0,
    pendingVideos: 0,
    state,
    target: TRANSCODE_TARGET_LABEL,
    totalVideos: 0,
    updatedAt: new Date().toISOString(),
  }
}

async function trackActiveTranscodeCacheWarm<T>(promise: Promise<T>) {
  const trackedPromise = promise.then(
    () => undefined,
    () => undefined,
  )

  transcodeCacheActiveWarmVideos.add(trackedPromise)

  try {
    return await promise
  } finally {
    transcodeCacheActiveWarmVideos.delete(trackedPromise)
  }
}

function markTranscodeCacheVideoCached() {
  transcodeCacheStatus = {
    ...transcodeCacheStatus,
    cachedVideos: transcodeCacheStatus.cachedVideos + 1,
    completedVideos: transcodeCacheStatus.completedVideos + 1,
    pendingVideos: Math.max(transcodeCacheStatus.pendingVideos - 1, 0),
    updatedAt: new Date().toISOString(),
  }
}

function markTranscodeCacheVideoGenerated() {
  transcodeCacheStatus = {
    ...transcodeCacheStatus,
    completedVideos: transcodeCacheStatus.completedVideos + 1,
    generatedVideos: transcodeCacheStatus.generatedVideos + 1,
    pendingVideos: Math.max(transcodeCacheStatus.pendingVideos - 1, 0),
    updatedAt: new Date().toISOString(),
  }
}

function markTranscodeCacheVideoFailed(message: string) {
  transcodeCacheStatus = {
    ...transcodeCacheStatus,
    completedVideos: transcodeCacheStatus.completedVideos + 1,
    failedVideos: transcodeCacheStatus.failedVideos + 1,
    lastError: message,
    pendingVideos: Math.max(transcodeCacheStatus.pendingVideos - 1, 0),
    updatedAt: new Date().toISOString(),
  }
}

async function throttleTranscodeCacheWarm(runId: number) {
  if (runId !== transcodeCacheWarmRunId) {
    return
  }

  await sleep(TRANSCODE_CACHE_BACKGROUND_COOLDOWN_MS)
}

function getPreviewCacheWarmStatusFields(mode: PreviewCacheWarmMode) {
  const settings = getPreviewCacheWarmSettings(mode)

  return {
    cpuBudget: settings.cpuBudget,
    warmMode: mode,
  }
}

function getPreviewCacheWarmSettings(mode = previewCacheWarmMode) {
  if (mode === 'foreground') {
    return {
      cpuBudget: PREVIEW_CACHE_FOREGROUND_CPU_BUDGET,
      ffmpegThreads: undefined,
      sheetConcurrency: PREVIEW_CACHE_FOREGROUND_SHEET_CONCURRENCY,
    }
  }

  return {
    cpuBudget: PREVIEW_CACHE_BACKGROUND_CPU_BUDGET,
    ffmpegThreads: PREVIEW_CACHE_BACKGROUND_FFMPEG_THREADS,
    sheetConcurrency: PREVIEW_CACHE_BACKGROUND_SHEET_CONCURRENCY,
  }
}

async function warmMissingPreviewSheets(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  missingFrameTimes: number[],
  missingSheetIndexes: Set<number>,
  runId: number,
) {
  const settings = getPreviewCacheWarmSettings()
  const missingFrameCountBySheet = new Map<number, number>()

  for (const frameTime of missingFrameTimes) {
    const sheetInfo = getPreviewSpriteSheetInfo(
      mediaId,
      mediaPath,
      stats,
      frameTime,
      PREVIEW_CACHE_QUALITY,
    )

    missingFrameCountBySheet.set(
      sheetInfo.sheetIndex,
      (missingFrameCountBySheet.get(sheetInfo.sheetIndex) ?? 0) + 1,
    )
  }

  const jobs = [...missingSheetIndexes]
    .sort((first, second) => first - second)
    .map((sheetIndex) => {
      const frameCount = missingFrameCountBySheet.get(sheetIndex) ?? 0
      const sheetInfo = getPreviewSpriteSheetInfoForIndex(
        mediaId,
        mediaPath,
        stats,
        sheetIndex,
        PREVIEW_CACHE_QUALITY,
      )

      return {
        frameCount,
        sheetInfo,
      }
    })
    .filter((job) => job.frameCount > 0)

  await runWithConcurrency(jobs, settings.sheetConcurrency, async (job) => {
    if (runId !== previewCacheWarmRunId) {
      return
    }

    if (await isFile(job.sheetInfo.sheetPath)) {
      markPreviewCacheFramesCached(job.frameCount)
      return
    }

    try {
      await trackActivePreviewFrameWarm(
        generatePreviewSpriteSheet(
          mediaPath,
          job.sheetInfo,
          PREVIEW_CACHE_QUALITY,
          {
            threads: settings.ffmpegThreads,
          },
        ).then(() => undefined),
      )

      if (runId !== previewCacheWarmRunId) {
        return
      }

      markPreviewCacheFramesGenerated(job.frameCount)
      await throttlePreviewCacheWarm(runId)
    } catch (error) {
      if (runId !== previewCacheWarmRunId) {
        return
      }

      markPreviewCacheFramesFailed(job.frameCount, getErrorMessage(error))
    }
  })
}

async function trackActivePreviewFrameWarm<T>(promise: Promise<T>) {
  const trackedPromise = promise.then(
    () => undefined,
    () => undefined,
  )

  previewCacheActiveWarmFrames.add(trackedPromise)

  try {
    return await promise
  } finally {
    previewCacheActiveWarmFrames.delete(trackedPromise)
  }
}

function markPreviewCacheFramesCached(count: number) {
  previewCacheStatus = {
    ...previewCacheStatus,
    cachedFrames: previewCacheStatus.cachedFrames + count,
    pendingFrames: Math.max(previewCacheStatus.pendingFrames - count, 0),
    updatedAt: new Date().toISOString(),
  }
}

function markPreviewCacheFramesGenerated(count: number) {
  previewCacheStatus = {
    ...previewCacheStatus,
    generatedFrames: previewCacheStatus.generatedFrames + count,
    pendingFrames: Math.max(previewCacheStatus.pendingFrames - count, 0),
    updatedAt: new Date().toISOString(),
  }
}

function markPreviewCacheFramesFailed(count: number, message: string) {
  previewCacheStatus = {
    ...previewCacheStatus,
    failedFrames: previewCacheStatus.failedFrames + count,
    lastError: message,
    pendingFrames: Math.max(previewCacheStatus.pendingFrames - count, 0),
    updatedAt: new Date().toISOString(),
  }
}

async function throttlePreviewCacheWarm(runId: number) {
  const settings = getPreviewCacheWarmSettings()

  if (
    settings.cpuBudget >= PREVIEW_CACHE_FOREGROUND_CPU_BUDGET ||
    runId !== previewCacheWarmRunId
  ) {
    return
  }

  await sleep(PREVIEW_CACHE_BACKGROUND_COOLDOWN_MS)
}

function getPreviewCacheFrameTimes(duration: number) {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 0
  const frameTimes: number[] = []

  for (
    let frameTime = 0;
    frameTime < safeDuration;
    frameTime += PREVIEW_CACHE_FRAME_INTERVAL_SECONDS
  ) {
    frameTimes.push(
      getPreviewFrameTime(String(frameTime), PREVIEW_CACHE_QUALITY),
    )
  }

  return [...new Set(frameTimes)]
}

function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  let nextIndex = 0
  const workerCount = Math.min(Math.max(concurrency, 1), items.length)
  const workers = Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const item = items[nextIndex]

      nextIndex += 1
      await worker(item)
    }
  })

  return Promise.all(workers)
}

function sleep(delayMs: number) {
  return new Promise<void>((resolvePromise) => {
    setTimeout(resolvePromise, delayMs)
  })
}

async function getDirectoryStats(directory: string): Promise<{
  bytes: number
  files: number
}> {
  let entries

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return {
      bytes: 0,
      files: 0,
    }
  }

  let bytes = 0
  let files = 0

  for (const entry of entries) {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      const nestedStats = await getDirectoryStats(entryPath)

      bytes += nestedStats.bytes
      files += nestedStats.files
      continue
    }

    if (entry.isFile()) {
      try {
        const stats = await fs.stat(entryPath)

        bytes += stats.size
        files += 1
      } catch {
        // Ignore files that are deleted while status is being computed.
      }
    }
  }

  return {
    bytes,
    files,
  }
}

async function collectMediaFiles(
  root: string,
  directory: string,
  sourceMap: Map<string, SourceSummary>,
  items: MediaItem[],
) {
  let entries

  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      if (
        directory === root &&
        IGNORED_TOP_LEVEL_SOURCES.has(entry.name.toLowerCase())
      ) {
        continue
      }

      await collectMediaFiles(root, fullPath, sourceMap, items)
      continue
    }

    if (!entry.isFile()) {
      continue
    }

    const extension = extname(entry.name).toLowerCase()

    if (!VIDEO_EXTENSIONS.has(extension)) {
      continue
    }

    let stats: Stats

    try {
      stats = await fs.stat(fullPath)
    } catch {
      continue
    }

    const relativePath = relative(root, fullPath)
    const sourceName = getSourceName(relativePath)
    const sourcePath = join(root, sourceName)
    const browserPlayable = BROWSER_PLAYABLE_EXTENSIONS.has(extension)
    const mediaMetadata = getMediaMetadata(relativePath, entry.name, extension)
    const mediaId = encodeMediaId(relativePath)
    const item: MediaItem = {
      id: mediaId,
      title: mediaMetadata.title,
      category: mediaMetadata.category,
      artworkUrl: getArtworkUrl(mediaId, mediaMetadata.category),
      container: extension.replace('.', '').toUpperCase(),
      browserPlayable,
      relativePath,
      folder: relative(root, dirname(fullPath)),
      source: sourceName,
      sizeBytes: stats.size,
      sizeLabel: formatBytes(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      streamUrl: `/api/media/${encodeURIComponent(mediaId)}/stream`,
      showTitle: mediaMetadata.showTitle,
      seasonNumber: mediaMetadata.seasonNumber,
      episodeNumber: mediaMetadata.episodeNumber,
      episodeTitle: mediaMetadata.episodeTitle,
    }

    items.push(item)
    upsertSource(sourceMap, sourceName, sourcePath, item)
  }
}

async function streamArtwork(
  mediaId: string,
  req: IncomingMessage,
  res: ServerResponse,
  refresh: boolean,
) {
  const target = await getArtworkTarget(mediaId)

  if (!target) {
    sendError(res, 404, 'Media not found')
    return
  }

  const artwork = await resolveArtwork(target, refresh)

  if (!artwork) {
    sendError(res, 404, 'Artwork not found')
    return
  }

  let stats: Stats

  try {
    stats = await fs.stat(artwork.filePath)
  } catch {
    sendError(res, 404, 'Artwork not found')
    return
  }

  if (!stats.isFile()) {
    sendError(res, 404, 'Artwork not found')
    return
  }

  res.writeHead(200, {
    ...API_CORS_HEADERS,
    'Cache-Control': artwork.cacheControl,
    'Content-Length': stats.size,
    'Content-Type': artwork.contentType,
    'Last-Modified': stats.mtime.toUTCString(),
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(artwork.filePath).pipe(res)
}

async function streamPreviewFrame(
  mediaId: string,
  req: IncomingMessage,
  res: ServerResponse,
  searchParams: URLSearchParams,
) {
  const mediaPath = getMediaPath(mediaId)

  if (!mediaPath) {
    sendError(res, 404, 'Media not found')
    return
  }

  const extension = extname(mediaPath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(extension)) {
    sendError(res, 415, 'Unsupported media type')
    return
  }

  let stats: Stats

  try {
    stats = await fs.stat(mediaPath)
  } catch {
    sendError(res, 404, 'Media not found')
    return
  }

  if (!stats.isFile()) {
    sendError(res, 404, 'Media not found')
    return
  }

  const quality = getPreviewFrameQuality(searchParams.get('quality'))
  const frameTime = getPreviewFrameTime(searchParams.get('t'), quality)
  const framePath = await resolvePreviewFrame(
    mediaId,
    mediaPath,
    stats,
    frameTime,
    quality,
  )
  const frameStats = await fs.stat(framePath)

  res.writeHead(200, {
    ...API_CORS_HEADERS,
    'Cache-Control': 'public, max-age=86400',
    'Content-Length': frameStats.size,
    'Content-Type': 'image/jpeg',
    'Last-Modified': frameStats.mtime.toUTCString(),
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(framePath).pipe(res)
}

async function resolvePreviewSpriteForRequest(
  mediaId: string,
  searchParams: URLSearchParams,
): Promise<PreviewSprite> {
  const previewMedia = await getPreviewMedia(mediaId)
  const quality = getPreviewFrameQuality(searchParams.get('quality'))
  const frameTime = getPreviewFrameTime(searchParams.get('t'), quality)

  return resolvePreviewSprite(
    mediaId,
    previewMedia.mediaPath,
    previewMedia.stats,
    frameTime,
    quality,
  )
}

async function streamPreviewSheet(
  mediaId: string,
  req: IncomingMessage,
  res: ServerResponse,
  searchParams: URLSearchParams,
) {
  const previewMedia = await getPreviewMedia(mediaId)
  const quality = getPreviewFrameQuality(searchParams.get('quality'))
  const rawSheetIndex = Number(searchParams.get('sheet') ?? 0)
  const sheetIndex =
    Number.isInteger(rawSheetIndex) && rawSheetIndex > 0 ? rawSheetIndex : 0
  const sheetInfo = getPreviewSpriteSheetInfoForIndex(
    mediaId,
    previewMedia.mediaPath,
    previewMedia.stats,
    sheetIndex,
    quality,
  )
  const sheetPath = await resolvePreviewSpriteSheet(
    previewMedia.mediaPath,
    sheetInfo,
    quality,
  )
  const sheetStats = await fs.stat(sheetPath)

  res.writeHead(200, {
    ...API_CORS_HEADERS,
    'Cache-Control': 'public, max-age=604800, immutable',
    'Content-Length': sheetStats.size,
    'Content-Type': 'image/jpeg',
    'Last-Modified': sheetStats.mtime.toUTCString(),
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(sheetPath).pipe(res)
}

async function getPreviewMedia(mediaId: string) {
  const mediaPath = getMediaPath(mediaId)

  if (!mediaPath) {
    throw createHttpError(404, 'Media not found')
  }

  const extension = extname(mediaPath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw createHttpError(415, 'Unsupported media type')
  }

  let stats: Stats

  try {
    stats = await fs.stat(mediaPath)
  } catch {
    throw createHttpError(404, 'Media not found')
  }

  if (!stats.isFile()) {
    throw createHttpError(404, 'Media not found')
  }

  return {
    mediaPath,
    stats,
  }
}

async function resolvePreviewSprite(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  frameTime: number,
  quality: PreviewFrameQuality,
): Promise<PreviewSprite> {
  const sheetInfo = getPreviewSpriteSheetInfo(
    mediaId,
    mediaPath,
    stats,
    frameTime,
    quality,
  )

  return {
    column: sheetInfo.column,
    columns: PREVIEW_SPRITE_COLUMNS,
    frameIndex: sheetInfo.frameIndex,
    frameWidth: PREVIEW_FRAME_SETTINGS[quality].width,
    quality,
    row: sheetInfo.row,
    rows: PREVIEW_SPRITE_ROWS,
    sheetIndex: sheetInfo.sheetIndex,
    sheetUrl: getPreviewSpriteSheetUrl(
      mediaId,
      sheetInfo.sheetIndex,
      quality,
      sheetInfo.versionKey,
    ),
    time: sheetInfo.frameTime,
  }
}

async function resolvePreviewSpriteSheet(
  mediaPath: string,
  sheetInfo: ReturnType<typeof getPreviewSpriteSheetInfoForIndex>,
  quality: PreviewFrameQuality,
) {
  if (await isFile(sheetInfo.sheetPath)) {
    return sheetInfo.sheetPath
  }

  const existingFetch = previewFrameFetches.get(sheetInfo.sheetPath)

  if (existingFetch) {
    return existingFetch
  }

  const fetchPromise = generatePreviewSpriteSheet(mediaPath, sheetInfo, quality)

  previewFrameFetches.set(sheetInfo.sheetPath, fetchPromise)

  try {
    return await fetchPromise
  } finally {
    if (previewFrameFetches.get(sheetInfo.sheetPath) === fetchPromise) {
      previewFrameFetches.delete(sheetInfo.sheetPath)
    }
  }
}

async function resolvePreviewFrame(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  frameTime: number,
  quality: PreviewFrameQuality,
  options: PreviewFrameGenerationOptions = {},
) {
  const framePath = getPreviewFramePath(
    mediaId,
    mediaPath,
    stats,
    frameTime,
    quality,
  )

  if (await isFile(framePath)) {
    return framePath
  }

  const existingFetch = previewFrameFetches.get(framePath)

  if (existingFetch) {
    return existingFetch
  }

  const fetchPromise = generatePreviewFrame(
    mediaPath,
    framePath,
    frameTime,
    quality,
    options,
  )

  previewFrameFetches.set(framePath, fetchPromise)

  try {
    return await fetchPromise
  } finally {
    if (previewFrameFetches.get(framePath) === fetchPromise) {
      previewFrameFetches.delete(framePath)
    }
  }
}

async function generatePreviewSpriteSheet(
  mediaPath: string,
  sheetInfo: ReturnType<typeof getPreviewSpriteSheetInfoForIndex>,
  quality: PreviewFrameQuality,
  options: PreviewFrameGenerationOptions = {},
) {
  const tempPath = `${sheetInfo.sheetPath}.${Date.now()}.tmp.jpg`

  try {
    await fs.mkdir(dirname(sheetInfo.sheetPath), { recursive: true })
    await extractPreviewSpriteSheet(
      mediaPath,
      sheetInfo.startTime,
      tempPath,
      PREVIEW_FRAME_SETTINGS[quality],
      options,
    )
    await movePreviewFrameIntoCache(tempPath, sheetInfo.sheetPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }

  return sheetInfo.sheetPath
}

async function generatePreviewFrame(
  mediaPath: string,
  framePath: string,
  frameTime: number,
  quality: PreviewFrameQuality,
  options: PreviewFrameGenerationOptions = {},
) {
  const settings = PREVIEW_FRAME_SETTINGS[quality]
  const tempPath = `${framePath}.${Date.now()}.tmp`
  const imageBytes = await extractPreviewFrame(
    mediaPath,
    frameTime,
    settings,
    options,
  )

  await fs.mkdir(dirname(framePath), { recursive: true })
  await fs.writeFile(tempPath, imageBytes)
  await fs.rename(tempPath, framePath)

  return framePath
}

async function movePreviewFrameIntoCache(tempPath: string, framePath: string) {
  if (await isFile(framePath)) {
    await fs.rm(tempPath, { force: true })
    return
  }

  await fs.mkdir(dirname(framePath), { recursive: true })

  try {
    await fs.rename(tempPath, framePath)
  } catch (error) {
    if (await isFile(framePath)) {
      await fs.rm(tempPath, { force: true })
      return
    }

    throw error
  }
}

function extractPreviewFrame(
  mediaPath: string,
  frameTime: number,
  settings: (typeof PREVIEW_FRAME_SETTINGS)[PreviewFrameQuality],
  options: PreviewFrameGenerationOptions = {},
) {
  return new Promise<Buffer>((resolvePromise, rejectPromise) => {
    const threadArgs = options.threads
      ? ['-threads', String(options.threads)]
      : []
    const ffmpeg = spawn(
      getFfmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        formatFfmpegTime(frameTime),
        ...(settings.fastSeek ? ['-noaccurate_seek'] : []),
        ...threadArgs,
        '-i',
        mediaPath,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-frames:v',
        '1',
        '-vf',
        `scale=${settings.width}:-2`,
        '-q:v',
        String(settings.jpegQuality),
        ...threadArgs,
        '-f',
        'image2pipe',
        'pipe:1',
      ],
      {
        windowsHide: true,
      },
    )
    const chunks: Buffer[] = []
    const errorChunks: Buffer[] = []
    let byteLength = 0
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error('Preview frame generation timed out'))
      ffmpeg.kill()
    }, PREVIEW_FRAME_TIMEOUT_MS)

    function finish(error: Error | null, imageBytes?: Buffer) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      if (error) {
        rejectPromise(error)
        return
      }

      resolvePromise(imageBytes ?? Buffer.alloc(0))
    }

    ffmpeg.stdout.on('data', (chunk: Buffer) => {
      byteLength += chunk.byteLength

      if (byteLength > MAX_PREVIEW_FRAME_BYTES) {
        finish(new Error('Preview frame is too large'))
        ffmpeg.kill()
        return
      }

      chunks.push(chunk)
    })

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })

    ffmpeg.on('error', (error) => {
      finish(error)
    })

    ffmpeg.on('close', (code) => {
      if (settled) {
        return
      }

      const imageBytes = Buffer.concat(chunks, byteLength)

      if (code === 0 && imageBytes.length > 0) {
        finish(null, imageBytes)
        return
      }

      const stderr = Buffer.concat(errorChunks).toString('utf8').trim()
      const message = stderr
        ? `Preview frame generation failed: ${stderr}`
        : `Preview frame generation failed (${code ?? 'unknown exit'})`

      finish(new Error(message))
    })
  })
}

function extractPreviewSpriteSheet(
  mediaPath: string,
  startTime: number,
  outputPath: string,
  settings: (typeof PREVIEW_FRAME_SETTINGS)[PreviewFrameQuality],
  options: PreviewFrameGenerationOptions = {},
) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const threadArgs = options.threads
      ? ['-threads', String(options.threads)]
      : []
    const ffmpeg = spawn(
      getFfmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-ss',
        formatFfmpegTime(startTime),
        ...(settings.fastSeek ? ['-noaccurate_seek'] : []),
        ...threadArgs,
        '-i',
        mediaPath,
        '-map',
        '0:v:0',
        '-an',
        '-sn',
        '-dn',
        '-vf',
        `fps=1/${PREVIEW_CACHE_FRAME_INTERVAL_SECONDS},scale=${settings.width}:-2,tile=${PREVIEW_SPRITE_COLUMNS}x${PREVIEW_SPRITE_ROWS}`,
        '-frames:v',
        '1',
        '-q:v',
        String(settings.jpegQuality),
        ...threadArgs,
        '-f',
        'image2',
        outputPath,
      ],
      {
        windowsHide: true,
      },
    )
    const errorChunks: Buffer[] = []
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error('Preview sprite sheet generation timed out'))
      ffmpeg.kill()
    }, getPreviewSpriteSheetTimeout())

    function finish(error?: Error) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      if (error) {
        rejectPromise(error)
        return
      }

      resolvePromise()
    }

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })

    ffmpeg.on('error', (error) => {
      finish(error)
    })

    ffmpeg.on('close', (code) => {
      if (settled) {
        return
      }

      if (code === 0) {
        finish()
        return
      }

      const stderr = Buffer.concat(errorChunks).toString('utf8').trim()
      const message = stderr
        ? `Preview sprite sheet generation failed: ${stderr}`
        : `Preview sprite sheet generation failed (${code ?? 'unknown exit'})`

      finish(new Error(message))
    })
  })
}

function getPreviewSpriteSheetTimeout() {
  return Math.min(
    PREVIEW_SPRITE_SHEET_MAX_TIMEOUT_MS,
    PREVIEW_FRAME_TIMEOUT_MS +
      PREVIEW_SPRITE_FRAMES_PER_SHEET *
        PREVIEW_SPRITE_SHEET_TIMEOUT_MS_PER_FRAME,
  )
}

function encodeTranscodeCacheFile(target: TranscodeTarget) {
  const existingEncode = transcodeCacheEncodes.get(target.cachePath)

  if (existingEncode) {
    return existingEncode
  }

  const encodePromise = encodeTranscodeFile(target)
    .then(() => target.cachePath)
    .finally(() => {
      if (transcodeCacheEncodes.get(target.cachePath) === encodePromise) {
        transcodeCacheEncodes.delete(target.cachePath)
      }
    })

  transcodeCacheEncodes.set(target.cachePath, encodePromise)

  return encodePromise
}

async function encodeTranscodeFile(target: TranscodeTarget) {
  if (await isFile(target.cachePath)) {
    return
  }

  const tempPath = `${target.cachePath}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp.mp4`

  await fs.mkdir(dirname(target.cachePath), { recursive: true })

  try {
    await runFfmpegToFile(target.mediaPath, tempPath)
    await moveTranscodeFileIntoCache(tempPath, target.cachePath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}

async function moveTranscodeFileIntoCache(
  tempPath: string,
  cachePath: string,
) {
  if (await isFile(cachePath)) {
    await fs.rm(tempPath, { force: true })
    return
  }

  await fs.mkdir(dirname(cachePath), { recursive: true })

  try {
    await fs.rename(tempPath, cachePath)
  } catch (error) {
    if (await isFile(cachePath)) {
      await fs.rm(tempPath, { force: true })
      return
    }

    throw error
  }
}

function runFfmpegToFile(mediaPath: string, outputPath: string) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const ffmpeg = spawn(
      getFfmpegExecutable(),
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-fflags',
        '+genpts',
        '-i',
        mediaPath,
        ...getTranscodeOutputArgs(),
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        outputPath,
      ],
      {
        windowsHide: true,
      },
    )
    const errorChunks: Buffer[] = []
    let settled = false

    function finish(error?: Error) {
      if (settled) {
        return
      }

      settled = true

      if (error) {
        rejectPromise(error)
        return
      }

      resolvePromise()
    }

    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })

    ffmpeg.on('error', (error) => {
      finish(error)
    })

    ffmpeg.on('close', (code) => {
      if (settled) {
        return
      }

      if (code === 0) {
        finish()
        return
      }

      const stderr = Buffer.concat(errorChunks).toString('utf8').trim()
      const message = stderr
        ? `Video encoding failed: ${stderr}`
        : `Video encoding failed (${code ?? 'unknown exit'})`

      finish(new Error(message))
    })
  })
}

function streamFfmpegTranscode(
  mediaPath: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  if (req.method === 'HEAD') {
    res.writeHead(200, getTranscodeStreamHeaders('no-store'))
    res.end()
    return
  }

  const ffmpeg = spawn(
    getFfmpegExecutable(),
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-re',
      '-fflags',
      '+genpts',
      '-i',
      mediaPath,
      ...getTranscodeOutputArgs(),
      '-avoid_negative_ts',
      'make_zero',
      '-movflags',
      'frag_keyframe+empty_moov+default_base_moof',
      '-muxdelay',
      '0',
      '-muxpreload',
      '0',
      '-flush_packets',
      '1',
      '-f',
      'mp4',
      'pipe:1',
    ],
    {
      windowsHide: true,
    },
  )
  const errorChunks: Buffer[] = []
  let clientClosed = false

  function stopTranscode() {
    clientClosed = true

    if (!ffmpeg.killed) {
      ffmpeg.kill()
    }
  }

  res.writeHead(200, getTranscodeStreamHeaders('no-store'))

  req.on('close', stopTranscode)
  res.on('close', stopTranscode)

  ffmpeg.stdout.pipe(res)

  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    errorChunks.push(chunk)
  })

  ffmpeg.on('error', (error) => {
    if (!res.writableEnded) {
      res.destroy(error)
    }
  })

  ffmpeg.on('close', () => {
    req.off('close', stopTranscode)
    res.off('close', stopTranscode)

    if (clientClosed) {
      return
    }

    if (!res.writableEnded) {
      const stderr = Buffer.concat(errorChunks).toString('utf8').trim()

      if (stderr) {
        res.destroy(new Error(`Video transcode failed: ${stderr}`))
        return
      }

      res.end()
    }
  })
}

function getTranscodeOutputArgs() {
  return [
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-g',
    '48',
    '-keyint_min',
    '48',
    '-sc_threshold',
    '0',
    '-crf',
    '21',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ar',
    '48000',
    '-ac',
    '2',
  ]
}

function getTranscodeStreamHeaders(cacheControl: string) {
  return {
    ...API_CORS_HEADERS,
    'Accept-Ranges': 'none',
    'Cache-Control': cacheControl,
    'Content-Type': 'video/mp4',
  }
}

function getPreviewFrameQuality(value: string | null): PreviewFrameQuality {
  return value === 'high' ? 'high' : 'low'
}

function getPreviewFrameTime(
  value: string | null,
  quality: PreviewFrameQuality,
) {
  const numericValue = Number(value)
  const requestedTime =
    Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
  const bucketSeconds = PREVIEW_FRAME_SETTINGS[quality].timeBucketSeconds

  return Math.max(Math.round(requestedTime / bucketSeconds) * bucketSeconds, 0)
}

function probeMediaDuration(mediaPath: string) {
  return new Promise<number>((resolvePromise, rejectPromise) => {
    const ffprobe = spawn(
      getFfprobeExecutable(),
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        mediaPath,
      ],
      {
        windowsHide: true,
      },
    )
    const chunks: Buffer[] = []
    const errorChunks: Buffer[] = []
    let settled = false
    const timeout = setTimeout(() => {
      finish(new Error('Preview frame duration probe timed out'))
      ffprobe.kill()
    }, PREVIEW_FRAME_PROBE_TIMEOUT_MS)

    function finish(error: Error | null, duration?: number) {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      if (error) {
        rejectPromise(error)
        return
      }

      resolvePromise(duration ?? 0)
    }

    ffprobe.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    ffprobe.stderr.on('data', (chunk: Buffer) => {
      errorChunks.push(chunk)
    })

    ffprobe.on('error', (error) => {
      finish(error)
    })

    ffprobe.on('close', (code) => {
      if (settled) {
        return
      }

      const rawDuration = Buffer.concat(chunks).toString('utf8').trim()
      const duration = Number(rawDuration)

      if (code === 0 && Number.isFinite(duration) && duration > 0) {
        finish(null, duration)
        return
      }

      const stderr = Buffer.concat(errorChunks).toString('utf8').trim()
      const message = stderr
        ? `Preview frame duration probe failed: ${stderr}`
        : `Preview frame duration probe failed (${code ?? 'unknown exit'})`

      finish(new Error(message))
    })
  })
}

function createPreviewFrameCacheKey(
  mediaId: string,
  stats: Stats,
  frameTime: number,
  quality: PreviewFrameQuality,
) {
  return createHash('sha256')
    .update(
      [
        mediaId,
        String(stats.size),
        String(Math.floor(stats.mtimeMs)),
        quality,
        formatFfmpegTime(frameTime),
      ].join('\n'),
    )
    .digest('hex')
}

function getPreviewSpriteSheetInfo(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  frameTime: number,
  quality: PreviewFrameQuality,
): PreviewSpriteFrameInfo {
  const intervalSeconds = PREVIEW_FRAME_SETTINGS[quality].timeBucketSeconds
  const frameIndex = Math.max(Math.round(frameTime / intervalSeconds), 0)
  const sheetInfo = getPreviewSpriteSheetInfoForIndex(
    mediaId,
    mediaPath,
    stats,
    Math.floor(frameIndex / PREVIEW_SPRITE_FRAMES_PER_SHEET),
    quality,
  )
  const cellIndex = frameIndex % PREVIEW_SPRITE_FRAMES_PER_SHEET

  return {
    ...sheetInfo,
    column: cellIndex % PREVIEW_SPRITE_COLUMNS,
    frameIndex,
    frameTime: frameIndex * intervalSeconds,
    row: Math.floor(cellIndex / PREVIEW_SPRITE_COLUMNS),
  }
}

function getPreviewSpriteSheetInfoForIndex(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  sheetIndex: number,
  quality: PreviewFrameQuality,
): PreviewSpriteSheetInfo {
  const safeSheetIndex = Math.max(Math.floor(sheetIndex), 0)
  const startFrameIndex = safeSheetIndex * PREVIEW_SPRITE_FRAMES_PER_SHEET
  const startTime =
    startFrameIndex * PREVIEW_FRAME_SETTINGS[quality].timeBucketSeconds
  const versionKey = createPreviewMediaVersionKey(mediaId, stats)

  return {
    sheetIndex: safeSheetIndex,
    sheetPath: join(
      getPreviewSpriteCacheDirectory(mediaId, mediaPath, quality),
      `sheet-${String(safeSheetIndex).padStart(4, '0')}-${versionKey}.jpg`,
    ),
    startFrameIndex,
    startTime,
    versionKey,
  }
}

function createPreviewMediaVersionKey(mediaId: string, stats: Stats) {
  return createHash('sha256')
    .update([mediaId, String(stats.size), String(Math.floor(stats.mtimeMs))].join('\n'))
    .digest('hex')
    .slice(0, 12)
}

function getPreviewSpriteCacheDirectory(
  mediaId: string,
  mediaPath: string,
  quality: PreviewFrameQuality,
) {
  const relativePath = decodeMediaId(mediaId) ?? basename(mediaPath)
  const filename = basename(mediaPath)
  const extension = extname(mediaPath)
  const metadata = getMediaMetadata(relativePath, filename, extension)
  const sourceName = getSourceName(relativePath)
  const filenameTitle = cleanTitle(basename(filename, extension))

  if (metadata.category === 'show') {
    const seasonLabel = metadata.seasonNumber
      ? `Season ${String(metadata.seasonNumber).padStart(2, '0')}`
      : 'Season Unknown'
    const episodeCode =
      metadata.seasonNumber && metadata.episodeNumber
        ? `S${String(metadata.seasonNumber).padStart(2, '0')}E${String(
            metadata.episodeNumber,
          ).padStart(2, '0')}`
        : ''
    const episodeTitle =
      episodeCode && metadata.title === `Episode ${metadata.episodeNumber}`
        ? episodeCode
        : cleanTitle(`${episodeCode} ${metadata.title}`.trim()) || filenameTitle

    return join(
      getPreviewFrameCacheRoot(),
      'TV Shows',
      sanitizePreviewCacheSegment(metadata.showTitle ?? sourceName),
      sanitizePreviewCacheSegment(seasonLabel),
      sanitizePreviewCacheSegment(episodeTitle),
      quality,
    )
  }

  if (metadata.category === 'movie') {
    return join(
      getPreviewFrameCacheRoot(),
      'Movies',
      sanitizePreviewCacheSegment(metadata.title),
      sanitizePreviewCacheSegment(filenameTitle),
      quality,
    )
  }

  return join(
    getPreviewFrameCacheRoot(),
    'Other',
    sanitizePreviewCacheSegment(sourceName),
    sanitizePreviewCacheSegment(filenameTitle),
    quality,
  )
}

function getPreviewSpriteSheetUrl(
  mediaId: string,
  sheetIndex: number,
  quality: PreviewFrameQuality,
  versionKey: string,
) {
  const params = new URLSearchParams({
    quality,
    sheet: String(sheetIndex),
    v: versionKey,
  })

  return `/api/media/${encodeURIComponent(mediaId)}/preview-sheet?${params}`
}

function sanitizePreviewCacheSegment(value: string) {
  const sanitizedValue = cleanTitle(value)
    .replace(/[<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')

  return sanitizedValue || 'Untitled'
}

function getPreviewFramePath(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
  frameTime: number,
  quality: PreviewFrameQuality,
) {
  return join(
    getPreviewSpriteCacheDirectory(mediaId, mediaPath, quality),
    `frame-${formatFfmpegTime(frameTime)}-${createPreviewFrameCacheKey(
      mediaId,
      stats,
      frameTime,
      quality,
    ).slice(0, 12)}.jpg`,
  )
}

function assertSafePreviewCacheRoot(cacheRoot: string) {
  const resolvedCacheRoot = resolve(cacheRoot)
  const parent = dirname(resolvedCacheRoot)

  if (parent === resolvedCacheRoot) {
    throw new Error('Preview cache folder cannot be a filesystem root')
  }

  const protectedRoots = [
    homedir(),
    process.env.LOCALAPPDATA?.trim(),
  ].filter((value): value is string => Boolean(value))

  if (
    protectedRoots.some((protectedRoot) => {
      return resolve(protectedRoot) === resolvedCacheRoot
    })
  ) {
    throw new Error('Preview cache folder is too broad to clear')
  }

  const mediaRoot = resolve(getMediaRoot())

  if (isPathInside(resolvedCacheRoot, mediaRoot)) {
    throw new Error('Preview cache folder cannot contain the media library')
  }
}

function assertSafeTranscodeCacheRoot(cacheRoot: string) {
  const resolvedCacheRoot = resolve(cacheRoot)
  const parent = dirname(resolvedCacheRoot)

  if (parent === resolvedCacheRoot) {
    throw new Error('Encoded video cache folder cannot be a filesystem root')
  }

  const protectedRoots = [
    homedir(),
    process.env.LOCALAPPDATA?.trim(),
  ].filter((value): value is string => Boolean(value))

  if (
    protectedRoots.some((protectedRoot) => {
      return resolve(protectedRoot) === resolvedCacheRoot
    })
  ) {
    throw new Error('Encoded video cache folder is too broad to clear')
  }

  const mediaRoot = resolve(getMediaRoot())

  if (
    isPathInside(mediaRoot, resolvedCacheRoot) ||
    isPathInside(resolvedCacheRoot, mediaRoot)
  ) {
    throw new Error('Encoded video cache folder cannot overlap the media library')
  }
}

function getFfmpegExecutable() {
  return process.env.HOME_MEDIA_FFMPEG_PATH?.trim() || 'ffmpeg'
}

function getFfprobeExecutable() {
  const configuredPath = process.env.HOME_MEDIA_FFPROBE_PATH?.trim()

  if (configuredPath) {
    return configuredPath
  }

  const configuredFfmpegPath = process.env.HOME_MEDIA_FFMPEG_PATH?.trim()

  if (configuredFfmpegPath) {
    const executableName = basename(configuredFfmpegPath).toLowerCase()

    if (executableName === 'ffmpeg.exe') {
      return join(dirname(configuredFfmpegPath), 'ffprobe.exe')
    }

    if (executableName === 'ffmpeg') {
      return join(dirname(configuredFfmpegPath), 'ffprobe')
    }
  }

  return 'ffprobe'
}

function normalizeClientProfile(value: unknown): ClientProfile {
  if (!isRecord(value)) {
    throw createHttpError(400, 'Invalid client profile')
  }

  const videoProbes = Array.isArray(value.videoProbes)
    ? value.videoProbes
        .map(normalizeClientVideoProbe)
        .filter((probe): probe is ClientVideoProbe => Boolean(probe))
        .slice(0, 32)
    : []

  return {
    app: getClientProfileString(value.app) ?? 'unknown',
    avInfoVersion: getClientProfileString(value.avInfoVersion),
    firmware: getClientProfileString(value.firmware),
    is8K: getClientProfileBoolean(value.is8K),
    isHdrTvSupport: getClientProfileBoolean(value.isHdrTvSupport),
    isUhd: getClientProfileBoolean(value.isUhd),
    model: getClientProfileString(value.model),
    modelCode: getClientProfileString(value.modelCode),
    productInfoVersion: getClientProfileString(value.productInfoVersion),
    realModel: getClientProfileString(value.realModel),
    reportedAt: new Date().toISOString(),
    tizenVersion: getClientProfileString(value.tizenVersion),
    userAgent: getClientProfileString(value.userAgent, 512),
    videoProbes,
  }
}

function normalizeClientVideoProbe(value: unknown): ClientVideoProbe | null {
  if (!isRecord(value)) {
    return null
  }

  const label = getClientProfileString(value.label)
  const mimeType = getClientProfileString(value.mimeType, 256)
  const result = getClientProfileString(value.result, 32) ?? ''

  if (!label || !mimeType) {
    return null
  }

  return {
    label,
    mimeType,
    result,
  }
}

function getClientProfileString(value: unknown, maxLength = 120) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()

  return trimmedValue ? trimmedValue.slice(0, maxLength) : undefined
}

function getClientProfileBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : undefined
}

function normalizePlaybackActivityReport(
  value: unknown,
): PlaybackActivityReport {
  if (!isRecord(value)) {
    throw createHttpError(400, 'Invalid playback activity')
  }

  const clientId = getPlaybackActivityString(
    value.clientId,
    PLAYBACK_ACTIVITY_MAX_CLIENT_ID_LENGTH,
  )
  const state = getPlaybackActivityState(value.state)
  const mediaId = getPlaybackActivityString(
    value.mediaId,
    PLAYBACK_ACTIVITY_MAX_MEDIA_ID_LENGTH,
  )

  if (!clientId || !state) {
    throw createHttpError(400, 'Invalid playback activity')
  }

  if (state !== 'closed' && !mediaId) {
    throw createHttpError(400, 'Invalid playback activity media id')
  }

  return {
    clientId,
    mediaId,
    state,
  }
}

function getPlaybackActivityString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') {
    return undefined
  }

  const trimmedValue = value.trim()

  return trimmedValue ? trimmedValue.slice(0, maxLength) : undefined
}

function getPlaybackActivityState(
  value: unknown,
): PlaybackActivityState | undefined {
  return value === 'closed' || value === 'ended' || value === 'open'
    ? value
    : undefined
}

function updatePlaybackActivity(report: PlaybackActivityReport) {
  const now = Date.now()

  pruneExpiredPlaybackActivityLeases(now)

  if (report.state === 'closed') {
    playbackActivityLeases.delete(report.clientId)
  } else {
    playbackActivityLeases.set(report.clientId, {
      clientId: report.clientId,
      expiresAt:
        now +
        (report.state === 'ended'
          ? PLAYBACK_ACTIVITY_ENDED_GRACE_MS
          : PLAYBACK_ACTIVITY_HEARTBEAT_TTL_MS),
      lastReportedAt: now,
      mediaId: report.mediaId ?? '',
      state: report.state,
    })
  }

  updateSystemAwakeRequest(now)
}

function pruneExpiredPlaybackActivityLeases(now: number) {
  let removedLease = false

  for (const [clientId, lease] of playbackActivityLeases.entries()) {
    if (lease.expiresAt <= now) {
      playbackActivityLeases.delete(clientId)
      removedLease = true
    }
  }

  return removedLease
}

function getPlaybackActivityStatus(now: number) {
  const leases = Array.from(playbackActivityLeases.values()).sort(
    (first, second) => first.expiresAt - second.expiresAt,
  )
  const activeUntil = leases.reduce(
    (latest, lease) => Math.max(latest, lease.expiresAt),
    0,
  )

  return {
    activeClients: leases.length,
    activeUntil: activeUntil ? new Date(activeUntil).toISOString() : null,
    awakeRequired: leases.length > 0,
    clients: leases.map((lease) => ({
      clientId: lease.clientId,
      expiresAt: new Date(lease.expiresAt).toISOString(),
      lastReportedAt: new Date(lease.lastReportedAt).toISOString(),
      mediaId: lease.mediaId,
      secondsRemaining: Math.max(0, Math.ceil((lease.expiresAt - now) / 1000)),
      state: lease.state,
    })),
    endedGraceSeconds: PLAYBACK_ACTIVITY_ENDED_GRACE_MS / 1000,
    heartbeatSeconds: PLAYBACK_ACTIVITY_HEARTBEAT_TTL_MS / 1000,
    powerRequest: getSystemAwakeRequestState(),
  }
}

function updateSystemAwakeRequest(now = Date.now()) {
  pruneExpiredPlaybackActivityLeases(now)

  if (playbackActivityLeases.size > 0) {
    ensurePlaybackActivityCleanupTimer()
    startSystemAwakeRequest()
    return
  }

  clearPlaybackActivityCleanupTimer()
  stopSystemAwakeRequest()
}

function ensurePlaybackActivityCleanupTimer() {
  if (playbackActivityCleanupTimer) {
    return
  }

  playbackActivityCleanupTimer = setInterval(() => {
    updateSystemAwakeRequest()
  }, PLAYBACK_ACTIVITY_CLEANUP_INTERVAL_MS)
  playbackActivityCleanupTimer.unref()
}

function clearPlaybackActivityCleanupTimer() {
  if (!playbackActivityCleanupTimer) {
    return
  }

  clearInterval(playbackActivityCleanupTimer)
  playbackActivityCleanupTimer = null
}

function getSystemAwakeRequestState() {
  if (process.platform !== 'win32') {
    return 'unsupported'
  }

  return systemAwakeProcess ? 'active' : 'inactive'
}

function startSystemAwakeRequest() {
  if (process.platform !== 'win32' || systemAwakeProcess) {
    return
  }

  clearSystemAwakeRestartTimer()

  const command = getSystemAwakePowerShellCommand(process.pid)

  try {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command],
      {
        stdio: 'ignore',
        windowsHide: true,
      },
    )

    systemAwakeProcess = child
    systemAwakeStartErrorLogged = false
    child.unref()

    child.once('error', (error) => {
      if (systemAwakeProcess === child) {
        systemAwakeProcess = null
      }

      logSystemAwakeRequestIssue(error)
      scheduleSystemAwakeRestart()
    })

    child.once('exit', (code) => {
      if (systemAwakeProcess === child) {
        systemAwakeProcess = null
      }

      if (playbackActivityLeases.size > 0 && !systemAwakeProcess) {
        if (code && !systemAwakeStartErrorLogged) {
          logSystemAwakeRequestIssue(
            new Error(`Windows power request exited with code ${code}`),
          )
        }

        scheduleSystemAwakeRestart()
      }
    })
  } catch (error) {
    logSystemAwakeRequestIssue(error)
    scheduleSystemAwakeRestart()
  }
}

function stopSystemAwakeRequest() {
  clearSystemAwakeRestartTimer()
  systemAwakeStartErrorLogged = false

  if (!systemAwakeProcess) {
    return
  }

  const child = systemAwakeProcess

  systemAwakeProcess = null

  if (!child.killed) {
    child.kill()
  }
}

function scheduleSystemAwakeRestart() {
  if (
    process.platform !== 'win32' ||
    systemAwakeRestartTimer ||
    playbackActivityLeases.size === 0
  ) {
    return
  }

  systemAwakeRestartTimer = setTimeout(() => {
    systemAwakeRestartTimer = null

    if (playbackActivityLeases.size > 0) {
      startSystemAwakeRequest()
    }
  }, 1000)
  systemAwakeRestartTimer.unref()
}

function clearSystemAwakeRestartTimer() {
  if (!systemAwakeRestartTimer) {
    return
  }

  clearTimeout(systemAwakeRestartTimer)
  systemAwakeRestartTimer = null
}

function logSystemAwakeRequestIssue(error: unknown) {
  if (systemAwakeStartErrorLogged) {
    return
  }

  systemAwakeStartErrorLogged = true
  console.warn(
    `Home Media server could not keep the system awake: ${getErrorMessage(
      error,
    )}`,
  )
}

function getSystemAwakePowerShellCommand(parentProcessId: number) {
  return `
$ErrorActionPreference = 'Stop'
$parentProcessId = ${parentProcessId}
$refreshSeconds = ${PLAYBACK_ACTIVITY_POWER_REFRESH_SECONDS}
Add-Type -Namespace HomeMedia -Name NativePower -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError = true)]
public static extern uint SetThreadExecutionState(uint esFlags);
'@
$continuous = [uint32]2147483648
$systemRequired = [uint32]0x00000001
$required = $continuous -bor $systemRequired
try {
  while (Get-Process -Id $parentProcessId -ErrorAction SilentlyContinue) {
    [HomeMedia.NativePower]::SetThreadExecutionState($required) | Out-Null
    Start-Sleep -Seconds $refreshSeconds
  }
} finally {
  [HomeMedia.NativePower]::SetThreadExecutionState($continuous) | Out-Null
}
`
}

function formatFfmpegTime(seconds: number) {
  return seconds.toFixed(3)
}

function getArtworkUrl(mediaId: string, category: MediaCategory) {
  return isArtworkCategory(category)
    ? `/api/media/${encodeURIComponent(mediaId)}/artwork`
    : undefined
}

async function getArtworkTarget(
  mediaId: string,
): Promise<ArtworkTarget | null> {
  const mediaPath = getMediaPath(mediaId)

  if (!mediaPath) {
    return null
  }

  const extension = extname(mediaPath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(extension)) {
    return null
  }

  try {
    const stats = await fs.stat(mediaPath)

    if (!stats.isFile()) {
      return null
    }
  } catch {
    return null
  }

  const root = resolve(getMediaRoot())
  const relativePath = relative(root, mediaPath)
  const metadata = getMediaMetadata(relativePath, basename(mediaPath), extension)

  if (!isArtworkCategory(metadata.category)) {
    return null
  }

  const title =
    metadata.category === 'show'
      ? metadata.showTitle ?? metadata.title
      : metadata.title
  const search = getArtworkSearchTitle(title)
  const source = getSourceName(relativePath)

  return {
    cacheKey: createArtworkCacheKey(
      metadata.category,
      source,
      search.title,
      search.year,
    ),
    category: metadata.category,
    mediaPath,
    relativePath,
    searchTitle: search.title,
    source,
    title,
    year: search.year,
  }
}

async function resolveArtwork(
  target: ArtworkTarget,
  refresh: boolean,
): Promise<ResolvedArtwork | null> {
  const localArtwork = await resolveLocalArtwork(target)

  if (localArtwork) {
    return localArtwork
  }

  if (!refresh) {
    const cachedEntry = await readArtworkCacheEntry(target.cacheKey)

    if (cachedEntry?.status === 'ready') {
      const cachedArtwork = await resolveCachedArtwork(cachedEntry)

      if (cachedArtwork) {
        return cachedArtwork
      }
    }

    if (cachedEntry?.status === 'missing' && isFreshMissingCache(cachedEntry)) {
      return null
    }
  }

  return fetchAndCacheArtwork(target)
}

async function resolveLocalArtwork(
  target: ArtworkTarget,
): Promise<ResolvedArtwork | null> {
  const filePath = await findArtworkPath(target.mediaPath)

  if (!filePath) {
    return null
  }

  return {
    cacheControl: 'public, max-age=3600',
    contentType:
      IMAGE_MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ??
      'application/octet-stream',
    filePath,
  }
}

async function resolveCachedArtwork(
  entry: ArtworkCacheEntry,
): Promise<ResolvedArtwork | null> {
  if (!entry.fileName) {
    return null
  }

  const cacheRoot = getArtworkCacheRoot()
  const filePath = resolve(cacheRoot, entry.fileName)

  if (!isPathInside(cacheRoot, filePath) || !(await isFile(filePath))) {
    return null
  }

  return {
    cacheControl: 'public, max-age=604800, immutable',
    contentType:
      entry.contentType ??
      IMAGE_MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ??
      'application/octet-stream',
    filePath,
  }
}

async function fetchAndCacheArtwork(target: ArtworkTarget) {
  const existingFetch = artworkFetches.get(target.cacheKey)

  if (existingFetch) {
    return existingFetch
  }

  const fetchPromise = fetchAndCacheRemoteArtwork(target)

  artworkFetches.set(target.cacheKey, fetchPromise)

  try {
    return await fetchPromise
  } finally {
    if (artworkFetches.get(target.cacheKey) === fetchPromise) {
      artworkFetches.delete(target.cacheKey)
    }
  }
}

async function fetchAndCacheRemoteArtwork(
  target: ArtworkTarget,
): Promise<ResolvedArtwork | null> {
  const remoteArtwork = await findRemoteArtwork(target)

  if (!remoteArtwork) {
    if (canCheckRemoteArtwork(target)) {
      await writeMissingArtwork(target)
    }

    return null
  }

  const response = await fetchWithTimeout(remoteArtwork.imageUrl, {
    headers: {
      Accept: 'image/webp,image/png,image/jpeg,*/*',
      'User-Agent': REMOTE_METADATA_USER_AGENT,
    },
  })

  if (!response.ok) {
    throw new Error(`Artwork download failed (${response.status})`)
  }

  const contentLength = Number(response.headers.get('content-length') ?? 0)

  if (contentLength > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork download is too large')
  }

  const imageBytes = Buffer.from(await response.arrayBuffer())

  if (imageBytes.byteLength > MAX_ARTWORK_BYTES) {
    throw new Error('Artwork download is too large')
  }

  const contentType =
    normalizeImageContentType(response.headers.get('content-type')) ??
    'image/jpeg'
  const extension = IMAGE_EXTENSION_BY_MIME.get(contentType) ?? '.jpg'
  const cacheRoot = getArtworkCacheRoot()
  const fileName = `${target.cacheKey}${extension}`
  const filePath = join(cacheRoot, fileName)
  const tempPath = join(cacheRoot, `${fileName}.${Date.now()}.tmp`)

  await fs.mkdir(cacheRoot, { recursive: true })
  await fs.writeFile(tempPath, imageBytes)
  await fs.rename(tempPath, filePath)
  await writeArtworkCacheEntry({
    cacheKey: target.cacheKey,
    category: target.category,
    checkedAt: new Date().toISOString(),
    contentType,
    fileName,
    lookupVersion: ARTWORK_LOOKUP_VERSION,
    provider: remoteArtwork.provider,
    sourceUrl: remoteArtwork.sourceUrl,
    status: 'ready',
    title: target.title,
  })

  return {
    cacheControl: 'public, max-age=604800, immutable',
    contentType,
    filePath,
  }
}

async function findRemoteArtwork(target: ArtworkTarget) {
  const providers = [findTmdbArtwork, findImdbArtwork, findTvmazeArtwork]
  let lastError: unknown = null

  for (const provider of providers) {
    try {
      const artwork = await provider(target)

      if (artwork) {
        return artwork
      }
    } catch (error) {
      lastError = error
    }
  }

  if (lastError) {
    throw lastError
  }

  return null
}

async function findImdbArtwork(
  target: ArtworkTarget,
): Promise<RemoteArtwork | null> {
  if (target.category !== 'movie') {
    return null
  }

  const searchQuery = getImdbSearchQuery(target)
  const searchUrl = new URL(
    `${IMDB_SUGGESTION_BASE_URL}/${getImdbSuggestionBucket(
      searchQuery,
    )}/${encodeURIComponent(searchQuery)}.json`,
  )

  const response = await fetchWithTimeout(searchUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': REMOTE_METADATA_USER_AGENT,
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`IMDb artwork search failed (${response.status})`)
  }

  const payload = (await response.json()) as ImdbSuggestionResponse
  const result = selectImdbArtworkResult(payload.d ?? [], target)
  const imageUrl = normalizeImdbImageUrl(result?.i?.imageUrl)

  if (!result || !imageUrl) {
    return null
  }

  return {
    imageUrl,
    provider: 'imdb',
    sourceUrl: result.id
      ? `https://www.imdb.com/title/${result.id}/`
      : 'https://www.imdb.com/',
  }
}

async function findTmdbArtwork(
  target: ArtworkTarget,
): Promise<RemoteArtwork | null> {
  const credentials = getTmdbCredentials()

  if (!credentials) {
    return null
  }

  const mediaType = target.category === 'movie' ? 'movie' : 'tv'
  const searchUrl = new URL(`${TMDB_API_BASE_URL}/search/${mediaType}`)

  searchUrl.searchParams.set('query', target.searchTitle)
  searchUrl.searchParams.set('include_adult', 'false')

  if (target.year) {
    searchUrl.searchParams.set(
      target.category === 'movie' ? 'year' : 'first_air_date_year',
      String(target.year),
    )
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
  }

  if (credentials.bearerToken) {
    headers.Authorization = credentials.bearerToken.startsWith('Bearer ')
      ? credentials.bearerToken
      : `Bearer ${credentials.bearerToken}`
  } else if (credentials.apiKey) {
    searchUrl.searchParams.set('api_key', credentials.apiKey)
  } else {
    return null
  }

  const response = await fetchWithTimeout(searchUrl, { headers })

  if (!response.ok) {
    throw new Error(`Artwork search failed (${response.status})`)
  }

  const payload = (await response.json()) as TmdbSearchResponse
  const result = selectTmdbArtworkResult(payload.results ?? [], target)

  if (!result?.poster_path) {
    return null
  }

  return {
    imageUrl: `${TMDB_IMAGE_BASE_URL}${result.poster_path}`,
    provider: 'tmdb',
    sourceUrl: result.id
      ? `https://www.themoviedb.org/${mediaType}/${result.id}`
      : 'https://www.themoviedb.org/',
  }
}

async function findTvmazeArtwork(
  target: ArtworkTarget,
): Promise<RemoteArtwork | null> {
  if (target.category !== 'show') {
    return null
  }

  const searchUrl = new URL(`${TVMAZE_API_BASE_URL}/singlesearch/shows`)

  searchUrl.searchParams.set('q', target.searchTitle)

  const response = await fetchWithTimeout(searchUrl, {
    headers: {
      Accept: 'application/json',
      'User-Agent': REMOTE_METADATA_USER_AGENT,
    },
  })

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(`TVmaze artwork search failed (${response.status})`)
  }

  const show = (await response.json()) as TvmazeShow
  const imageUrl = normalizeRemoteImageUrl(
    show.image?.medium ?? show.image?.original,
  )

  if (
    !imageUrl ||
    !isAcceptableArtworkMatch(show.name, getYearFromDate(show.premiered), target)
  ) {
    return null
  }

  return {
    imageUrl,
    provider: 'tvmaze',
    sourceUrl: show.url ?? getTvmazeSourceUrl(show.id),
  }
}

async function fetchWithTimeout(url: string | URL, init: RequestInit = {}) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), ARTWORK_FETCH_TIMEOUT_MS)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

async function readArtworkCacheEntry(cacheKey: string) {
  try {
    const payload = JSON.parse(
      await fs.readFile(getArtworkCacheEntryPath(cacheKey), 'utf8'),
    ) as unknown

    return isArtworkCacheEntry(payload) ? payload : null
  } catch {
    return null
  }
}

async function writeArtworkCacheEntry(entry: ArtworkCacheEntry) {
  const cacheRoot = getArtworkCacheRoot()

  await fs.mkdir(cacheRoot, { recursive: true })
  await fs.writeFile(
    getArtworkCacheEntryPath(entry.cacheKey),
    JSON.stringify(entry, null, 2),
    'utf8',
  )
}

async function writeMissingArtwork(target: ArtworkTarget) {
  await writeArtworkCacheEntry({
    cacheKey: target.cacheKey,
    category: target.category,
    checkedAt: new Date().toISOString(),
    lookupVersion: ARTWORK_LOOKUP_VERSION,
    provider: 'remote',
    status: 'missing',
    title: target.title,
  })
}

function selectTmdbArtworkResult(
  results: TmdbSearchResult[],
  target: ArtworkTarget,
) {
  return results
    .filter((result) => typeof result.poster_path === 'string')
    .sort(
      (first, second) =>
        scoreTmdbResult(second, target) - scoreTmdbResult(first, target),
    )[0]
}

function selectImdbArtworkResult(
  results: ImdbSuggestionResult[],
  target: ArtworkTarget,
) {
  return results
    .filter((result) => {
      return (
        isImdbMovieResult(result) &&
        typeof result.i?.imageUrl === 'string' &&
        isAcceptableArtworkMatch(result.l, getImdbResultYear(result), target)
      )
    })
    .sort(
      (first, second) =>
        scoreImdbResult(second, target) - scoreImdbResult(first, target),
    )[0]
}

function scoreTmdbResult(result: TmdbSearchResult, target: ArtworkTarget) {
  const resultTitle = result.title ?? result.name ?? ''
  const normalizedResultTitle = normalizeArtworkMatchTitle(resultTitle)
  const normalizedTargetTitle = normalizeArtworkMatchTitle(target.searchTitle)
  const resultYear = getYearFromDate(result.release_date ?? result.first_air_date)
  let score = 1

  if (normalizedResultTitle === normalizedTargetTitle) {
    score += 8
  } else if (
    normalizedResultTitle.includes(normalizedTargetTitle) ||
    normalizedTargetTitle.includes(normalizedResultTitle)
  ) {
    score += 3
  }

  if (target.year && resultYear === target.year) {
    score += 4
  }

  return score
}

function scoreImdbResult(result: ImdbSuggestionResult, target: ArtworkTarget) {
  const normalizedResultTitle = normalizeArtworkMatchTitle(result.l ?? '')
  const normalizedTargetTitle = normalizeArtworkMatchTitle(target.searchTitle)
  const resultYear = getImdbResultYear(result)
  let score = 1

  if (normalizedResultTitle === normalizedTargetTitle) {
    score += 10
  } else if (
    normalizedResultTitle.includes(normalizedTargetTitle) ||
    normalizedTargetTitle.includes(normalizedResultTitle)
  ) {
    score += 4
  }

  if (target.year && resultYear === target.year) {
    score += 6
  }

  if (result.qid === 'movie' || result.q === 'feature') {
    score += 4
  }

  if (typeof result.rank === 'number' && result.rank > 0) {
    score += Math.max(0, 4 - Math.log10(result.rank))
  }

  return score
}

function getTmdbCredentials(): TmdbCredentials | null {
  const bearerToken = process.env.HOME_MEDIA_TMDB_BEARER_TOKEN?.trim()

  if (bearerToken) {
    return { bearerToken }
  }

  const apiKey = process.env.HOME_MEDIA_TMDB_API_KEY?.trim()

  return apiKey ? { apiKey } : null
}

function canCheckRemoteArtwork(target: ArtworkTarget) {
  return (
    Boolean(getTmdbCredentials()) ||
    target.category === 'movie' ||
    target.category === 'show'
  )
}

function getImdbSearchQuery(target: ArtworkTarget) {
  return [target.searchTitle, target.year].filter(Boolean).join(' ')
}

function getImdbSuggestionBucket(query: string) {
  return query.match(/[a-z0-9]/i)?.[0].toLowerCase() ?? 'x'
}

function getImdbResultYear(result: ImdbSuggestionResult): number | null {
  return Number.isInteger(result.y) ? Number(result.y) : null
}

function isImdbMovieResult(result: ImdbSuggestionResult) {
  return result.qid === 'movie' || result.q === 'feature'
}

function normalizeImdbImageUrl(value: string | undefined) {
  const imageUrl = normalizeRemoteImageUrl(value)

  if (!imageUrl) {
    return null
  }

  try {
    const url = new URL(imageUrl)

    if (url.hostname.endsWith('media-amazon.com')) {
      url.pathname = url.pathname.replace(
        /@\._V1_[^/]*\.jpg$/i,
        '@._V1_UX500.jpg',
      )
    }

    return url.toString()
  } catch {
    return imageUrl
  }
}

function getTvmazeSourceUrl(showId: number | undefined) {
  return showId
    ? `https://www.tvmaze.com/shows/${showId}`
    : 'https://www.tvmaze.com/'
}

function getArtworkCacheEntryPath(cacheKey: string) {
  return join(getArtworkCacheRoot(), `${cacheKey}.json`)
}

function isFreshMissingCache(entry: ArtworkCacheEntry) {
  return (
    entry.lookupVersion === ARTWORK_LOOKUP_VERSION &&
    Date.now() - new Date(entry.checkedAt).getTime() <
    ARTWORK_MISSING_CACHE_TTL_MS
  )
}

function isArtworkCacheEntry(value: unknown): value is ArtworkCacheEntry {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.cacheKey === 'string' &&
    (value.category === 'movie' || value.category === 'show') &&
    typeof value.checkedAt === 'string' &&
    (value.lookupVersion === undefined ||
      typeof value.lookupVersion === 'number') &&
    (value.provider === 'remote' ||
      value.provider === 'imdb' ||
      value.provider === 'tmdb' ||
      value.provider === 'tvmaze') &&
    (value.status === 'missing' || value.status === 'ready') &&
    typeof value.title === 'string' &&
    (value.contentType === undefined || typeof value.contentType === 'string') &&
    (value.fileName === undefined || typeof value.fileName === 'string') &&
    (value.sourceUrl === undefined || typeof value.sourceUrl === 'string')
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getArtworkSearchTitle(title: string) {
  const yearMatch = /\b(?:19|20)\d{2}\b/.exec(title)
  const searchTitle = cleanTitle(
    title
      .replace(/\((?:19|20)\d{2}\)/g, '')
      .replace(/\b(?:19|20)\d{2}\b/g, '')
      .replace(/\b(?:2160p|1080p|720p|4K|BluRay|WEBRip|WEB-DL)\b.*$/i, ''),
  )

  return {
    title: searchTitle || title,
    year: yearMatch ? Number(yearMatch[0]) : undefined,
  }
}

function createArtworkCacheKey(
  category: ArtworkCategory,
  source: string,
  title: string,
  year: number | undefined,
) {
  return createHash('sha256')
    .update([category, source, title, year ?? ''].join('\n'))
    .digest('hex')
}

function isArtworkCategory(category: MediaCategory): category is ArtworkCategory {
  return category === 'movie' || category === 'show'
}

function normalizeImageContentType(value: string | null) {
  const contentType = value?.split(';')[0]?.trim().toLowerCase()

  return contentType && IMAGE_EXTENSION_BY_MIME.has(contentType)
    ? contentType
    : null
}

function normalizeRemoteImageUrl(value: string | undefined) {
  if (!value) {
    return null
  }

  try {
    const url = new URL(value)

    if (url.protocol === 'http:') {
      url.protocol = 'https:'
    }

    return url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

function isAcceptableArtworkMatch(
  title: string | undefined,
  year: number | null,
  target: ArtworkTarget,
) {
  const normalizedResultTitle = normalizeArtworkMatchTitle(title ?? '')
  const normalizedTargetTitle = normalizeArtworkMatchTitle(target.searchTitle)

  if (!normalizedResultTitle || !normalizedTargetTitle) {
    return false
  }

  const titleMatches =
    normalizedResultTitle === normalizedTargetTitle ||
    normalizedResultTitle.includes(normalizedTargetTitle) ||
    normalizedTargetTitle.includes(normalizedResultTitle)

  if (!titleMatches) {
    return false
  }

  return !target.year || !year || year === target.year
}

function normalizeArtworkMatchTitle(title: string) {
  return title
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getYearFromDate(value: string | undefined) {
  const year = value ? Number(value.slice(0, 4)) : Number.NaN

  return Number.isInteger(year) ? year : null
}

async function streamMedia(
  mediaId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const filePath = getMediaPath(mediaId)

  if (!filePath) {
    sendError(res, 404, 'Media not found')
    return
  }

  const extension = extname(filePath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(extension)) {
    sendError(res, 415, 'Unsupported media type')
    return
  }

  let stats: Stats

  try {
    stats = await fs.stat(filePath)
  } catch {
    sendError(res, 404, 'Media not found')
    return
  }

  if (!stats.isFile()) {
    sendError(res, 404, 'Media not found')
    return
  }

  const mimeType = MIME_BY_EXTENSION.get(extension) ?? 'application/octet-stream'

  streamFileContent(filePath, stats, req, res, {
    cacheControl: 'no-store',
    contentType: mimeType,
  })
}

async function streamTranscodedMedia(
  mediaId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const target = await getTranscodeTarget(mediaId)

  if (await isFile(target.cachePath)) {
    const cacheStats = await fs.stat(target.cachePath)

    streamFileContent(target.cachePath, cacheStats, req, res, {
      cacheControl: 'public, max-age=604800, immutable',
      contentType: 'video/mp4',
    })
    return
  }

  streamFfmpegTranscode(target.mediaPath, req, res)
}

async function getTranscodeTarget(mediaId: string): Promise<TranscodeTarget> {
  const mediaPath = getMediaPath(mediaId)

  if (!mediaPath) {
    throw createHttpError(404, 'Media not found')
  }

  const extension = extname(mediaPath).toLowerCase()

  if (!VIDEO_EXTENSIONS.has(extension)) {
    throw createHttpError(415, 'Unsupported media type')
  }

  let stats: Stats

  try {
    stats = await fs.stat(mediaPath)
  } catch {
    throw createHttpError(404, 'Media not found')
  }

  if (!stats.isFile()) {
    throw createHttpError(404, 'Media not found')
  }

  return {
    cachePath: getTranscodeCachePath(mediaId, mediaPath, stats),
    mediaPath,
    stats,
  }
}

function getTranscodeCachePath(
  mediaId: string,
  mediaPath: string,
  stats: Stats,
) {
  return join(
    getTranscodeCacheDirectory(mediaId, mediaPath),
    `${createPreviewMediaVersionKey(mediaId, stats)}.mp4`,
  )
}

function getTranscodeCacheDirectory(mediaId: string, mediaPath: string) {
  const relativePath = decodeMediaId(mediaId) ?? basename(mediaPath)
  const filename = basename(mediaPath)
  const extension = extname(mediaPath)
  const metadata = getMediaMetadata(relativePath, filename, extension)
  const sourceName = getSourceName(relativePath)
  const filenameTitle = cleanTitle(basename(filename, extension))

  if (metadata.category === 'show') {
    const seasonLabel = metadata.seasonNumber
      ? `Season ${String(metadata.seasonNumber).padStart(2, '0')}`
      : 'Season Unknown'
    const episodeCode =
      metadata.seasonNumber && metadata.episodeNumber
        ? `S${String(metadata.seasonNumber).padStart(2, '0')}E${String(
            metadata.episodeNumber,
          ).padStart(2, '0')}`
        : ''
    const episodeTitle =
      episodeCode && metadata.title === `Episode ${metadata.episodeNumber}`
        ? episodeCode
        : cleanTitle(`${episodeCode} ${metadata.title}`.trim()) || filenameTitle

    return join(
      getTranscodeCacheRoot(),
      'TV Shows',
      sanitizePreviewCacheSegment(metadata.showTitle ?? sourceName),
      sanitizePreviewCacheSegment(seasonLabel),
      sanitizePreviewCacheSegment(episodeTitle),
    )
  }

  if (metadata.category === 'movie') {
    return join(
      getTranscodeCacheRoot(),
      'Movies',
      sanitizePreviewCacheSegment(metadata.title),
      sanitizePreviewCacheSegment(filenameTitle),
    )
  }

  return join(
    getTranscodeCacheRoot(),
    'Other',
    sanitizePreviewCacheSegment(sourceName),
    sanitizePreviewCacheSegment(filenameTitle),
  )
}

async function streamSharedFile(
  fileId: string,
  req: IncomingMessage,
  res: ServerResponse,
) {
  const filePath = getFileSharePath(fileId)

  if (!filePath) {
    sendError(res, 404, 'File not found')
    return
  }

  let stats: Stats

  try {
    stats = await fs.lstat(filePath)
  } catch {
    sendError(res, 404, 'File not found')
    return
  }

  if (!stats.isFile()) {
    sendError(res, 404, 'File not found')
    return
  }

  if (!(await isPathInsideRealRoot(getFileShareRoot(), filePath))) {
    sendError(res, 404, 'File not found')
    return
  }

  streamFileContent(filePath, stats, req, res, {
    cacheControl: 'no-store',
    contentDisposition: getAttachmentContentDisposition(basename(filePath)),
    contentType: getGenericFileMimeType(filePath),
  })
}

function streamFileContent(
  filePath: string,
  stats: Stats,
  req: IncomingMessage,
  res: ServerResponse,
  options: {
    cacheControl: string
    contentDisposition?: string
    contentType: string
  },
) {
  const range = parseRangeHeader(req.headers.range, stats.size)

  if (req.headers.range && !range) {
    res.writeHead(416, {
      ...API_CORS_HEADERS,
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${stats.size}`,
    })
    res.end()
    return
  }

  const baseHeaders: Record<string, number | string> = {
    ...API_CORS_HEADERS,
    'Accept-Ranges': 'bytes',
    'Cache-Control': options.cacheControl,
    'Content-Type': options.contentType,
    'Last-Modified': stats.mtime.toUTCString(),
  }

  if (options.contentDisposition) {
    baseHeaders['Content-Disposition'] = options.contentDisposition
  }

  if (!range) {
    res.writeHead(200, {
      ...baseHeaders,
      'Content-Length': stats.size,
    })

    if (req.method === 'HEAD') {
      res.end()
      return
    }

    createReadStream(filePath).pipe(res)
    return
  }

  const contentLength = range.end - range.start + 1

  res.writeHead(206, {
    ...baseHeaders,
    'Content-Length': contentLength,
    'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
  })

  if (req.method === 'HEAD') {
    res.end()
    return
  }

  createReadStream(filePath, {
    end: range.end,
    start: range.start,
  }).pipe(res)
}

function parseRangeHeader(
  rangeHeader: string | undefined,
  size: number,
): RangeRequest | null {
  if (!rangeHeader) {
    return null
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())

  if (!match) {
    return null
  }

  const [, startValue, endValue] = match

  if (!startValue && !endValue) {
    return null
  }

  if (!startValue) {
    const suffixLength = Number(endValue)

    if (!Number.isInteger(suffixLength) || suffixLength <= 0) {
      return null
    }

    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(startValue)
  const end = endValue ? Number(endValue) : size - 1

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return null
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

function upsertSource(
  sourceMap: Map<string, SourceSummary>,
  sourceName: string,
  sourcePath: string,
  item: MediaItem,
) {
  const existing = sourceMap.get(sourceName)

  if (existing) {
    existing.videoCount += 1
    existing.playableCount += item.browserPlayable ? 1 : 0
    existing.totalBytes += item.sizeBytes
    existing.sizeLabel = formatBytes(existing.totalBytes)
    return
  }

  sourceMap.set(sourceName, {
    name: sourceName,
    path: sourcePath,
    videoCount: 1,
    playableCount: item.browserPlayable ? 1 : 0,
    totalBytes: item.sizeBytes,
    sizeLabel: formatBytes(item.sizeBytes),
  })
}

function getMediaPath(mediaId: string) {
  const root = resolve(getMediaRoot())
  const relativePath = decodeMediaId(mediaId)

  if (!relativePath) {
    return null
  }

  const filePath = resolve(root, relativePath)

  if (!isPathInside(root, filePath)) {
    return null
  }

  return filePath
}

function getFileShareDirectoryPath(root: string, requestedPath: string) {
  const relativePath = normalizeFileSharePath(requestedPath)

  if (relativePath === null) {
    return null
  }

  const directory = resolve(root, relativePath)

  if (!isPathInside(root, directory)) {
    return null
  }

  return directory
}

function getFileSharePath(fileId: string) {
  const root = resolve(getFileShareRoot())
  const relativePath = decodeFileId(fileId)

  if (!relativePath) {
    return null
  }

  const filePath = resolve(root, relativePath)

  if (!isPathInside(root, filePath)) {
    return null
  }

  return filePath
}

async function findArtworkPath(mediaPath: string) {
  const root = resolve(getMediaRoot())
  const mediaDirectory = dirname(mediaPath)
  const mediaBasename = basename(mediaPath, extname(mediaPath))
  const directories = Array.from(
    new Set([mediaDirectory, dirname(mediaDirectory)]),
  ).filter((directory) => isPathInside(root, resolve(directory)))
  const names = [mediaBasename, ...ARTWORK_NAMES]

  for (const directory of directories) {
    for (const name of names) {
      for (const extension of IMAGE_EXTENSIONS) {
        const candidate = join(directory, `${name}${extension}`)

        if (await isFile(candidate)) {
          return candidate
        }
      }
    }
  }

  return null
}

async function isFile(path: string) {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

function encodeMediaId(relativePath: string) {
  return encodeRelativePathId(relativePath)
}

function decodeMediaId(mediaId: string) {
  return decodeRelativePathId(mediaId)
}

function encodeFileId(relativePath: string) {
  return encodeRelativePathId(relativePath)
}

function decodeFileId(fileId: string) {
  return decodeRelativePathId(fileId)
}

function encodeRelativePathId(relativePath: string) {
  return Buffer.from(relativePath, 'utf8').toString('base64url')
}

function decodeRelativePathId(pathId: string) {
  try {
    return Buffer.from(pathId, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function normalizeFileSharePath(requestedPath: string) {
  const normalizedPath = requestedPath.trim().replace(/[\\/]+$/g, '')

  if (!normalizedPath || normalizedPath === '.') {
    return ''
  }

  if (normalizedPath.split(/[\\/]/).some((part) => !part || part === '..')) {
    return null
  }

  return normalizedPath
}

function isPathInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}

async function isPathInsideRealRoot(root: string, candidate: string) {
  try {
    const realRoot = await fs.realpath(root)
    const realCandidate = await fs.realpath(candidate)

    return isPathInside(realRoot, realCandidate)
  } catch {
    return false
  }
}

function sortFileShareEntries(first: FileShareEntry, second: FileShareEntry) {
  if (first.kind !== second.kind) {
    return first.kind === 'directory' ? -1 : 1
  }

  return first.name.localeCompare(second.name, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function getGenericFileMimeType(filePath: string) {
  const extension = extname(filePath).toLowerCase()

  return (
    GENERIC_FILE_MIME_BY_EXTENSION.get(extension) ??
    IMAGE_MIME_BY_EXTENSION.get(extension) ??
    MIME_BY_EXTENSION.get(extension) ??
    'application/octet-stream'
  )
}

function getAttachmentContentDisposition(filename: string) {
  const fallbackFilename =
    filename.replace(/["\\\r\n]/g, '_').replace(/[^\x20-\x7e]/g, '_') ||
    'download'

  return `attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodeHeaderValue(
    filename,
  )}`
}

function encodeHeaderValue(value: string) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

function getSourceName(relativePath: string) {
  return relativePath.split(/[\\/]/)[0] || 'Library'
}

function getMediaMetadata(
  relativePath: string,
  filename: string,
  extension: string,
): Pick<
  MediaItem,
  | 'category'
  | 'episodeNumber'
  | 'episodeTitle'
  | 'seasonNumber'
  | 'showTitle'
  | 'title'
> {
  const sourceName = getSourceName(relativePath)
  const sourceKey = sourceName.toLowerCase()
  const pathParts = relativePath.split(/[\\/]/)

  if (sourceKey === 'tv shows' || sourceKey === 'tv') {
    const showTitle = cleanTitle(pathParts[1] ?? basename(filename, extension))
    const episodeNumbers = parseEpisodeNumbers(filename)
    const episodeTitle = getEpisodeTitle(
      basename(filename, extension),
      showTitle,
      episodeNumbers,
    )

    return {
      category: 'show',
      episodeNumber: episodeNumbers?.episodeNumber,
      episodeTitle,
      seasonNumber: episodeNumbers?.seasonNumber,
      showTitle,
      title: episodeTitle,
    }
  }

  if (sourceKey === 'movies' || sourceKey === 'movie') {
    return {
      category: 'movie',
      title: getMovieTitle(relativePath, filename, extension),
    }
  }

  return {
    category: 'other',
    title: cleanTitle(basename(filename, extension)),
  }
}

function getMediaItemDisplayTitle(item: MediaItem) {
  if (!item.showTitle) {
    return item.title
  }

  const episodeCode =
    item.seasonNumber && item.episodeNumber
      ? ` S${String(item.seasonNumber).padStart(2, '0')}E${String(
          item.episodeNumber,
        ).padStart(2, '0')}`
      : ''
  const genericEpisodeTitle = item.episodeNumber
    ? `Episode ${item.episodeNumber}`
    : ''
  const titleSuffix =
    episodeCode && item.title === genericEpisodeTitle ? '' : ` - ${item.title}`

  return `${item.showTitle}${episodeCode}${titleSuffix}`
}

function getMovieTitle(
  relativePath: string,
  filename: string,
  extension: string,
) {
  const pathParts = relativePath.split(/[\\/]/)

  if (pathParts.length > 2) {
    return cleanTitle(pathParts[1])
  }

  return cleanTitle(basename(filename, extension))
}

function parseEpisodeNumbers(filename: string) {
  const match =
    /(?:^|[.\s_-])(?<marker>S(?<season>\d{1,2})E(?<episode>\d{1,3}))(?=$|[.\s_-])/i.exec(
      filename,
    ) ??
    /(?:^|[.\s_-])(?<marker>(?<season>\d{1,2})x(?<episode>\d{1,3}))(?=$|[.\s_-])/i.exec(
      filename,
    ) ??
    /(?:^|[.\s_-])(?<marker>(?<season>\d)(?<episode>\d{2}))(?:[.\s_-]|$)/i.exec(
      filename,
    )

  if (!match?.groups) {
    return null
  }

  return {
    episodeNumber: Number(match.groups.episode),
    marker: match.groups.marker,
    seasonNumber: Number(match.groups.season),
  }
}

function getEpisodeTitle(
  filenameWithoutExtension: string,
  showTitle: string,
  episodeNumbers: ReturnType<typeof parseEpisodeNumbers>,
) {
  const cleanedFilename = cleanTitle(filenameWithoutExtension)
  let episodeTitle = cleanedFilename
    .replace(new RegExp(`^${escapeRegExp(showTitle)}\\s*`, 'i'), '')
    .replace(/\bS\d{1,2}E\d{1,3}\b/i, '')
    .replace(/\b\d{1,2}x\d{1,3}\b/i, '')
    .replace(
      episodeNumbers?.marker
        ? new RegExp(
            `(?:^|[\\s._-])${escapeRegExp(
              episodeNumbers.marker,
            )}(?:[\\s._-]|$)`,
            'i',
          )
        : /$^/,
      ' ',
    )
    .replace(/\b\d{3,4}p\b.*$/i, '')
    .replace(/\b(?:BluRay|WEBRip|WEB-DL|x264|x265|HEVC|AAC|DD5)\b.*$/i, '')
    .replace(/^(?:-\s*)+/, '')
    .replace(/(?:\s*-)+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!episodeTitle && episodeNumbers) {
    episodeTitle = `Episode ${episodeNumbers.episodeNumber}`
  }

  return episodeTitle || cleanedFilename
}

function cleanTitle(name: string) {
  return name
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+$/, '')
    .trim()
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }

  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${
    units[unitIndex]
  }`
}

function sendJson(
  res: ServerResponse,
  payload: unknown,
  options: JsonResponseOptions = {},
) {
  res.writeHead(200, {
    ...API_CORS_HEADERS,
    'Cache-Control': options.cacheControl ?? 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function sendNoContent(res: ServerResponse) {
  res.writeHead(204, API_CORS_HEADERS)
  res.end()
}

function sendMethodNotAllowed(res: ServerResponse, allowedMethods: string[]) {
  res.writeHead(405, {
    ...API_CORS_HEADERS,
    Allow: allowedMethods.join(', '),
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

function sendError(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, {
    ...API_CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify({ error: message }))
}

function readJsonBody(req: IncomingMessage) {
  return new Promise<unknown>((resolvePromise, rejectPromise) => {
    const chunks: Buffer[] = []
    let byteLength = 0
    let settled = false

    function rejectOnce(error: Error) {
      if (settled) {
        return
      }

      settled = true
      rejectPromise(error)
    }

    req.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)

      byteLength += buffer.byteLength

      if (byteLength > MAX_JSON_BODY_BYTES) {
        rejectOnce(createHttpError(413, 'Request body is too large'))
        req.destroy()
        return
      }

      chunks.push(buffer)
    })

    req.on('end', () => {
      if (settled) {
        return
      }

      settled = true

      const body = Buffer.concat(chunks, byteLength).toString('utf8').trim()

      if (!body) {
        resolvePromise(null)
        return
      }

      try {
        resolvePromise(JSON.parse(body))
      } catch {
        rejectPromise(createHttpError(400, 'Request body is not valid JSON'))
      }
    })

    req.on('error', rejectOnce)
  })
}

function decodeUrlSegment(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error'
}

function getErrorStatusCode(error: unknown) {
  return isRecord(error) && typeof error.statusCode === 'number'
    ? error.statusCode
    : 500
}

function createHttpError(statusCode: number, message: string) {
  const error = new Error(message) as Error & {
    statusCode: number
  }

  error.statusCode = statusCode

  return error
}
