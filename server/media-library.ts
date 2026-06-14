import { spawn } from 'node:child_process'
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

type ArtworkCacheEntry = {
  cacheKey: string
  category: ArtworkCategory
  checkedAt: string
  contentType?: string
  fileName?: string
  provider: 'tmdb'
  sourceUrl?: string
  status: 'missing' | 'ready'
  title: string
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

type PreviewFrameQuality = keyof typeof PREVIEW_FRAME_SETTINGS

type PreviewCacheWarmMode = 'background' | 'foreground'

type PreviewCacheWarmRequest = {
  library: LibraryResponse
  mode: PreviewCacheWarmMode
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

const DEFAULT_MEDIA_ROOT = 'F:/media'
const ARTWORK_CACHE_DIRECTORY_NAME = 'Home Media'
const PREVIEW_FRAME_CACHE_DIRECTORY_NAME = 'preview-frames'
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
const TMDB_API_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE_URL = 'https://image.tmdb.org/t/p/w500'
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
const PREVIEW_CACHE_BACKGROUND_FFMPEG_THREADS = 4
const PREVIEW_CACHE_FOREGROUND_CPU_BUDGET = 1
const PREVIEW_SPRITE_COLUMNS = 10
const PREVIEW_SPRITE_ROWS = 6
const PREVIEW_SPRITE_FRAMES_PER_SHEET =
  PREVIEW_SPRITE_COLUMNS * PREVIEW_SPRITE_ROWS

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
    'Accept-Ranges, Content-Length, Content-Range, Content-Type',
}
const MAX_JSON_BODY_BYTES = 64 * 1024
let libraryCache: LibraryCache | null = null
const artworkFetches = new Map<string, Promise<ResolvedArtwork | null>>()
const previewCacheActiveWarmFrames = new Set<Promise<void>>()
let previewCacheWarmMode: PreviewCacheWarmMode = 'background'
let previewCacheStatus = createInitialPreviewCacheStatus()
let previewCacheWarmRequest: PreviewCacheWarmRequest | null = null
let previewCacheWarmRunId = 0
let previewCacheWarmRunning = false
const previewFrameFetches = new Map<string, Promise<string>>()

export function getMediaRoot() {
  return process.env.HOME_MEDIA_ROOT ?? DEFAULT_MEDIA_ROOT
}

export function getArtworkCacheRoot() {
  const configuredRoot = process.env.HOME_MEDIA_ARTWORK_CACHE_ROOT?.trim()

  if (configuredRoot) {
    return resolve(configuredRoot)
  }

  const localAppData = process.env.LOCALAPPDATA?.trim()

  return localAppData
    ? resolve(localAppData, ARTWORK_CACHE_DIRECTORY_NAME, 'artwork')
    : resolve(homedir(), '.home-media', 'artwork')
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
    : resolve(homedir(), '.home-media', PREVIEW_FRAME_CACHE_DIRECTORY_NAME)
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

export async function handleMediaApi(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://home-media.local')
  const isApiPath =
    url.pathname === '/api/library' ||
    url.pathname === '/api/playback' ||
    url.pathname === '/api/preview-cache' ||
    /^\/api\/playback\/[^/]+$/.test(url.pathname) ||
    /^\/api\/media\/[^/]+\/(?:artwork|preview-frame|preview-sheet|preview-sprite|stream)$/.test(
      url.pathname,
    )

  if (isApiPath && req.method === 'OPTIONS') {
    res.writeHead(204, API_CORS_HEADERS)
    res.end()

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
          'background',
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
        sendJson(res, previewSprite)
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
    }
  }

  return {
    cpuBudget: PREVIEW_CACHE_BACKGROUND_CPU_BUDGET,
    ffmpegThreads: PREVIEW_CACHE_BACKGROUND_FFMPEG_THREADS,
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

  for (const sheetIndex of [...missingSheetIndexes].sort(
    (first, second) => first - second,
  )) {
    if (runId !== previewCacheWarmRunId) {
      return
    }

    const frameCount = missingFrameCountBySheet.get(sheetIndex) ?? 0

    if (frameCount <= 0) {
      continue
    }

    const sheetInfo = getPreviewSpriteSheetInfoForIndex(
      mediaId,
      mediaPath,
      stats,
      sheetIndex,
      PREVIEW_CACHE_QUALITY,
    )

    if (await isFile(sheetInfo.sheetPath)) {
      markPreviewCacheFramesCached(frameCount)
      continue
    }

    try {
      await trackActivePreviewFrameWarm(
        generatePreviewSpriteSheet(mediaPath, sheetInfo, PREVIEW_CACHE_QUALITY, {
          threads: settings.ffmpegThreads,
        }).then(() => undefined),
      )

      if (runId !== previewCacheWarmRunId) {
        return
      }

      markPreviewCacheFramesGenerated(frameCount)
      await throttlePreviewCacheWarm(runId)
    } catch (error) {
      if (runId !== previewCacheWarmRunId) {
        return
      }

      markPreviewCacheFramesFailed(frameCount, getErrorMessage(error))
    }
  }
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

  await resolvePreviewSpriteSheet(mediaPath, sheetInfo, quality)

  return {
    column: sheetInfo.column,
    columns: PREVIEW_SPRITE_COLUMNS,
    frameIndex: sheetInfo.frameIndex,
    frameWidth: PREVIEW_FRAME_SETTINGS[quality].width,
    quality,
    row: sheetInfo.row,
    rows: PREVIEW_SPRITE_ROWS,
    sheetIndex: sheetInfo.sheetIndex,
    sheetUrl: getPreviewSpriteSheetUrl(mediaId, sheetInfo.sheetIndex, quality),
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
) {
  const params = new URLSearchParams({
    quality,
    sheet: String(sheetIndex),
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
    if (getTmdbCredentials()) {
      await writeMissingArtwork(target)
    }

    return null
  }

  const response = await fetchWithTimeout(remoteArtwork.imageUrl, {
    headers: {
      Accept: 'image/webp,image/png,image/jpeg,*/*',
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
    provider: 'tmdb',
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
    sourceUrl: result.id
      ? `https://www.themoviedb.org/${mediaType}/${result.id}`
      : 'https://www.themoviedb.org/',
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
    provider: 'tmdb',
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

function getTmdbCredentials(): TmdbCredentials | null {
  const bearerToken = process.env.HOME_MEDIA_TMDB_BEARER_TOKEN?.trim()

  if (bearerToken) {
    return { bearerToken }
  }

  const apiKey = process.env.HOME_MEDIA_TMDB_API_KEY?.trim()

  return apiKey ? { apiKey } : null
}

function getArtworkCacheEntryPath(cacheKey: string) {
  return join(getArtworkCacheRoot(), `${cacheKey}.json`)
}

function isFreshMissingCache(entry: ArtworkCacheEntry) {
  return (
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
    value.provider === 'tmdb' &&
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

  if (!range) {
    res.writeHead(200, {
      ...API_CORS_HEADERS,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Content-Length': stats.size,
      'Content-Type': mimeType,
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
    ...API_CORS_HEADERS,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'Content-Length': contentLength,
    'Content-Range': `bytes ${range.start}-${range.end}/${stats.size}`,
    'Content-Type': mimeType,
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
  return Buffer.from(relativePath, 'utf8').toString('base64url')
}

function decodeMediaId(mediaId: string) {
  try {
    return Buffer.from(mediaId, 'base64url').toString('utf8')
  } catch {
    return null
  }
}

function isPathInside(root: string, candidate: string) {
  const relativePath = relative(root, candidate)

  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
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
    /\bS(?<season>\d{1,2})E(?<episode>\d{1,3})\b/i.exec(filename) ??
    /\b(?<season>\d{1,2})x(?<episode>\d{1,3})\b/i.exec(filename)

  if (!match?.groups) {
    return null
  }

  return {
    episodeNumber: Number(match.groups.episode),
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
    .replace(/\b\d{3,4}p\b.*$/i, '')
    .replace(/\b(?:BluRay|WEBRip|WEB-DL|x264|x265|HEVC|AAC|DD5)\b.*$/i, '')
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

function sendJson(res: ServerResponse, payload: unknown) {
  res.writeHead(200, {
    ...API_CORS_HEADERS,
    'Cache-Control': 'no-store',
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
