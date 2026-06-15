export type PlaybackRecord = {
  completed: boolean
  duration: number
  position: number
  updatedAt: number
}

export type PlaybackHistory = Record<string, PlaybackRecord>

export const playbackStorageKey = 'my-home-media-server-playback-v1'
const legacyPlaybackStorageKey = 'home-media-playback-v1'

export function readLocalPlaybackHistory(): PlaybackHistory {
  try {
    const value =
      window.localStorage.getItem(playbackStorageKey) ??
      window.localStorage.getItem(legacyPlaybackStorageKey)

    return value ? normalizePlaybackHistory(JSON.parse(value)) : {}
  } catch {
    return {}
  }
}

export function writeLocalPlaybackHistory(history: PlaybackHistory) {
  window.localStorage.setItem(playbackStorageKey, JSON.stringify(history))
  window.localStorage.removeItem(legacyPlaybackStorageKey)
}

export async function fetchPlaybackHistory(
  apiBase: string,
  signal?: AbortSignal,
) {
  const response = await fetch(buildApiUrl('/api/playback', apiBase), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Playback metadata failed (${response.status})`)
  }

  return normalizePlaybackHistory(await response.json())
}

export async function savePlaybackRecord(
  apiBase: string,
  mediaId: string,
  record: PlaybackRecord,
) {
  const response = await fetch(
    buildApiUrl(`/api/playback/${encodeURIComponent(mediaId)}`, apiBase),
    {
      body: JSON.stringify(record),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'PUT',
    },
  )

  if (!response.ok) {
    throw new Error(`Playback metadata save failed (${response.status})`)
  }
}

export async function deletePlaybackRecord(apiBase: string, mediaId: string) {
  const response = await fetch(
    buildApiUrl(`/api/playback/${encodeURIComponent(mediaId)}`, apiBase),
    {
      method: 'DELETE',
    },
  )

  if (!response.ok) {
    throw new Error(`Playback metadata delete failed (${response.status})`)
  }
}

export function mergePlaybackHistories(
  ...histories: PlaybackHistory[]
): PlaybackHistory {
  const mergedHistory: PlaybackHistory = {}

  for (const history of histories) {
    for (const [mediaId, record] of Object.entries(history)) {
      const existingRecord = mergedHistory[mediaId]

      if (!existingRecord || record.updatedAt > existingRecord.updatedAt) {
        mergedHistory[mediaId] = record
      }
    }
  }

  return mergedHistory
}

function normalizePlaybackHistory(value: unknown): PlaybackHistory {
  if (!isRecord(value)) {
    return {}
  }

  const history: PlaybackHistory = {}

  for (const [mediaId, record] of Object.entries(value)) {
    const playbackRecord = normalizePlaybackRecord(record)

    if (playbackRecord) {
      history[mediaId] = playbackRecord
    }
  }

  return history
}

function normalizePlaybackRecord(value: unknown): PlaybackRecord | null {
  if (!isRecord(value) || typeof value.completed !== 'boolean') {
    return null
  }

  const duration = Number(value.duration)
  const position = Number(value.position)
  const updatedAt = Number(value.updatedAt)

  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(position) ||
    !Number.isFinite(updatedAt) ||
    duration < 0 ||
    position < 0 ||
    updatedAt <= 0
  ) {
    return null
  }

  return {
    completed: value.completed,
    duration,
    position,
    updatedAt,
  }
}

function buildApiUrl(path: string, apiBase: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return apiBase ? `${apiBase}${normalizedPath}` : normalizedPath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
