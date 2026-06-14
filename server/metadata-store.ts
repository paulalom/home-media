import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, resolve } from 'node:path'

export type PlaybackRecord = {
  completed: boolean
  duration: number
  position: number
  updatedAt: number
}

export type PlaybackHistory = Record<string, PlaybackRecord>

type MetadataStore = {
  playback: PlaybackHistory
  updatedAt: string
  version: 1
}

const METADATA_DIRECTORY_NAME = 'Home Media'
const METADATA_FILE_NAME = 'metadata.json'

let metadataWriteQueue = Promise.resolve()

export function getMetadataStorePath() {
  const configuredPath = process.env.HOME_MEDIA_METADATA_PATH?.trim()

  if (configuredPath) {
    return resolve(configuredPath)
  }

  const localAppData = process.env.LOCALAPPDATA?.trim()

  return localAppData
    ? resolve(localAppData, METADATA_DIRECTORY_NAME, METADATA_FILE_NAME)
    : resolve(homedir(), '.home-media', METADATA_FILE_NAME)
}

export async function readPlaybackHistory() {
  const store = await readMetadataStore()

  return store.playback
}

export async function upsertPlaybackRecord(
  mediaId: string,
  record: PlaybackRecord,
) {
  return queueMetadataWrite(async () => {
    const store = await readMetadataStore()
    const existingRecord = store.playback[mediaId]

    if (existingRecord && existingRecord.updatedAt > record.updatedAt) {
      return existingRecord
    }

    store.playback[mediaId] = record
    store.updatedAt = new Date().toISOString()
    await writeMetadataStore(store)

    return record
  })
}

export async function removePlaybackRecord(mediaId: string) {
  return queueMetadataWrite(async () => {
    const store = await readMetadataStore()

    if (!(mediaId in store.playback)) {
      return
    }

    delete store.playback[mediaId]
    store.updatedAt = new Date().toISOString()
    await writeMetadataStore(store)
  })
}

export function parsePlaybackRecord(value: unknown): PlaybackRecord | null {
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

function queueMetadataWrite<T>(operation: () => Promise<T>) {
  const nextWrite = metadataWriteQueue.catch(() => undefined).then(operation)

  metadataWriteQueue = nextWrite.then(
    () => undefined,
    () => undefined,
  )

  return nextWrite
}

async function readMetadataStore(): Promise<MetadataStore> {
  try {
    const payload = JSON.parse(
      await fs.readFile(getMetadataStorePath(), 'utf8'),
    ) as unknown

    return normalizeMetadataStore(payload)
  } catch {
    return createEmptyMetadataStore()
  }
}

async function writeMetadataStore(store: MetadataStore) {
  const storePath = getMetadataStorePath()
  const tempPath = `${storePath}.${Date.now()}.${Math.random()
    .toString(16)
    .slice(2)}.tmp`

  await fs.mkdir(dirname(storePath), { recursive: true })
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), 'utf8')
  await fs.rename(tempPath, storePath)
}

function normalizeMetadataStore(value: unknown): MetadataStore {
  if (!isRecord(value)) {
    return createEmptyMetadataStore()
  }

  return {
    playback: normalizePlaybackHistory(value.playback),
    updatedAt:
      typeof value.updatedAt === 'string'
        ? value.updatedAt
        : new Date().toISOString(),
    version: 1,
  }
}

function normalizePlaybackHistory(value: unknown): PlaybackHistory {
  if (!isRecord(value)) {
    return {}
  }

  const history: PlaybackHistory = {}

  for (const [mediaId, record] of Object.entries(value)) {
    const playbackRecord = parsePlaybackRecord(record)

    if (playbackRecord) {
      history[mediaId] = playbackRecord
    }
  }

  return history
}

function createEmptyMetadataStore(): MetadataStore {
  return {
    playback: {},
    updatedAt: new Date(0).toISOString(),
    version: 1,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
