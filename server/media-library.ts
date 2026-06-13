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

  if (url.pathname === '/api/library') {
    if (req.method !== 'GET') {
      sendMethodNotAllowed(res, ['GET'])
      return true
    }

    try {
      sendJson(res, await scanMediaLibrary())
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
    const item: MediaItem = {
      id: encodeMediaId(relativePath),
      title: cleanTitle(basename(entry.name, extension)),
      category: classifyMedia(relativePath),
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
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${stats.size}`,
    })
    res.end()
    return
  }

  if (!range) {
    res.writeHead(200, {
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

function classifyMedia(relativePath: string): MediaCategory {
  const lowerPath = relativePath.toLowerCase()

  if (lowerPath.includes('tv show') || lowerPath.includes('season ')) {
    return 'show'
  }

  if (lowerPath.includes('movie')) {
    return 'movie'
  }

  return 'other'
}

function cleanTitle(name: string) {
  return name
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+-\s+$/, '')
    .trim()
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
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify(payload))
}

function sendMethodNotAllowed(res: ServerResponse, allowedMethods: string[]) {
  res.writeHead(405, {
    Allow: allowedMethods.join(', '),
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify({ error: 'Method not allowed' }))
}

function sendError(res: ServerResponse, statusCode: number, message: string) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  })
  res.end(JSON.stringify({ error: message }))
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected server error'
}
