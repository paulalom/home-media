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
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Length, Content-Range, Content-Type',
}
let libraryCache: LibraryCache | null = null
const artworkFetches = new Map<string, Promise<ResolvedArtwork | null>>()

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
    /^\/api\/media\/[^/]+\/(?:artwork|stream)$/.test(url.pathname)

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
        await getCachedLibrary(url.searchParams.get('refresh') === '1'),
      )
    } catch (error) {
      sendError(res, 500, getErrorMessage(error))
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

  return false
}

async function getCachedLibrary(refresh: boolean) {
  const root = getMediaRoot()

  if (!refresh && libraryCache?.root === root) {
    return libraryCache.data
  }

  const data = await scanMediaLibrary(root)
  libraryCache = {
    data,
    root,
  }

  return data
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error'
}
