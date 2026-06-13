import { createReadStream, promises as fs } from 'node:fs'
import type { Stats } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

const DEFAULT_MEDIA_ROOT = 'F:/media'
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
const IGNORED_TOP_LEVEL_SOURCES = new Set(['mixes', 'music'])

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
const API_CORS_HEADERS = {
  'Access-Control-Allow-Headers': 'Content-Type, Range',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers':
    'Accept-Ranges, Content-Length, Content-Range, Content-Type',
}
let libraryCache: LibraryCache | null = null

export function getMediaRoot() {
  return process.env.HOME_MEDIA_ROOT ?? DEFAULT_MEDIA_ROOT
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
    url.pathname === '/api/library' || /^\/api\/media\/[^/]+\/stream$/.test(url.pathname)

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
    const item: MediaItem = {
      id: encodeMediaId(relativePath),
      title: mediaMetadata.title,
      category: mediaMetadata.category,
      container: extension.replace('.', '').toUpperCase(),
      browserPlayable,
      relativePath,
      folder: relative(root, dirname(fullPath)),
      source: sourceName,
      sizeBytes: stats.size,
      sizeLabel: formatBytes(stats.size),
      modifiedAt: stats.mtime.toISOString(),
      streamUrl: `/api/media/${encodeURIComponent(
        encodeMediaId(relativePath),
      )}/stream`,
      showTitle: mediaMetadata.showTitle,
      seasonNumber: mediaMetadata.seasonNumber,
      episodeNumber: mediaMetadata.episodeNumber,
      episodeTitle: mediaMetadata.episodeTitle,
    }

    items.push(item)
    upsertSource(sourceMap, sourceName, sourcePath, item)
  }
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
