export type PlaybackActivityState = 'closed' | 'ended' | 'open'

export const playbackActivityHeartbeatMs = 30_000

const playbackActivityClientIdStorageKey =
  'my-home-media-server-playback-activity-client-v1'

let memoryPlaybackActivityClientId: string | null = null

export function readPlaybackActivityClientId() {
  try {
    const storedClientId = window.localStorage.getItem(
      playbackActivityClientIdStorageKey,
    )

    if (storedClientId) {
      return storedClientId
    }

    const nextClientId = createPlaybackActivityClientId()

    window.localStorage.setItem(
      playbackActivityClientIdStorageKey,
      nextClientId,
    )

    return nextClientId
  } catch {
    memoryPlaybackActivityClientId ??= createPlaybackActivityClientId()

    return memoryPlaybackActivityClientId
  }
}

export async function reportPlaybackActivity(
  apiBase: string,
  clientId: string,
  mediaId: string | null,
  state: PlaybackActivityState,
  signal?: AbortSignal,
) {
  const response = await fetch(buildApiUrl('/api/playback-activity', apiBase), {
    body: JSON.stringify(createPlaybackActivityPayload(clientId, mediaId, state)),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Playback activity failed (${response.status})`)
  }
}

export function sendPlaybackActivityBeacon(
  apiBase: string,
  clientId: string,
  mediaId: string | null,
  state: PlaybackActivityState,
) {
  const url = buildApiUrl('/api/playback-activity', apiBase)
  const body = JSON.stringify(createPlaybackActivityPayload(clientId, mediaId, state))

  try {
    if (
      navigator.sendBeacon(
        url,
        new Blob([body], { type: 'application/json' }),
      )
    ) {
      return
    }
  } catch {
    // Fall back to fetch below when a browser does not support beacon payloads.
  }

  void fetch(url, {
    body,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    keepalive: true,
    method: 'POST',
  }).catch(() => undefined)
}

function createPlaybackActivityPayload(
  clientId: string,
  mediaId: string | null,
  state: PlaybackActivityState,
) {
  return mediaId
    ? {
        clientId,
        mediaId,
        state,
      }
    : {
        clientId,
        state,
      }
}

function createPlaybackActivityClientId() {
  const randomUUID = globalThis.crypto?.randomUUID

  if (randomUUID) {
    return randomUUID.call(globalThis.crypto)
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

function buildApiUrl(path: string, apiBase: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return apiBase ? `${apiBase}${normalizedPath}` : normalizedPath
}
