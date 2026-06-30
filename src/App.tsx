import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from 'react'
import {
  AlertCircle,
  ArrowUp,
  Check,
  ChevronRight,
  Clapperboard,
  Download,
  File as FileIcon,
  FileVideo,
  Folder,
  FolderOpen,
  LayoutGrid,
  LoaderCircle,
  Maximize2,
  Play,
  Radio,
  RefreshCcw,
  Search,
  Server,
  Settings,
  Trash2,
  Tv,
  Video,
  X,
  type LucideIcon,
} from 'lucide-react'
import {
  playbackActivityHeartbeatMs,
  readPlaybackActivityClientId,
  reportPlaybackActivity,
  sendPlaybackActivityBeacon,
  type PlaybackActivityState,
} from './playback-activity'
import {
  deletePlaybackRecord,
  fetchPlaybackHistory,
  mergePlaybackHistories,
  readLocalPlaybackHistory,
  savePlaybackRecord,
  writeLocalPlaybackHistory,
  type PlaybackHistory,
  type PlaybackRecord,
} from './playback-metadata'
import './App.css'

type MediaCategory = 'movie' | 'show' | 'other'
type MediaViewMode = 'Home' | 'Movies' | 'TV Shows'
type QuickJumpDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type ViewMode = MediaViewMode | 'Files'

type MediaItem = {
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

type SourceSummary = {
  name: string
  path: string
  videoCount: number
  playableCount: number
  totalBytes: number
  sizeLabel: string
}

type LibraryResponse = {
  summary: {
    root: string
    scannedAt: string
    totalVideos: number
    playableVideos: number
    totalBytes: number
    sizeLabel: string
    sources: number
  }
  sources: SourceSummary[]
  items: MediaItem[]
}

type FileShareEntry = {
  id: string
  name: string
  kind: 'directory' | 'file'
  relativePath: string
  sizeBytes: number
  sizeLabel: string
  modifiedAt: string
  downloadUrl?: string
}

type FileShareResponse = {
  summary: {
    root: string
    relativePath: string
    parentPath: string | null
    scannedAt: string
    directories: number
    files: number
    totalBytes: number
    sizeLabel: string
  }
  entries: FileShareEntry[]
}

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
  quality: 'high' | 'low'
  state: 'clearing' | 'idle' | 'warming'
  totalFrames: number
  totalVideos: number
  updatedAt: string
  width: number
  warmMode: 'background' | 'foreground'
}

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
  state: 'clearing' | 'idle' | 'warming'
  target: string
  totalVideos: number
  updatedAt: string
}

type MovieTitle = {
  id: string
  kind: 'movie'
  title: string
  artworkUrl?: string
  item: MediaItem
  lastWatchedAt: number | null
  resumeItem: MediaItem
}

type SeasonGroup = {
  seasonNumber: number
  episodes: MediaItem[]
}

type ShowTitle = {
  id: string
  kind: 'show'
  title: string
  artworkUrl?: string
  source: string
  episodes: MediaItem[]
  seasons: SeasonGroup[]
  episodeCount: number
  playableCount: number
  totalBytes: number
  sizeLabel: string
  lastWatchedAt: number | null
  resumeItem: MediaItem | null
}

type LibraryTitle = MovieTitle | ShowTitle

type LibraryCollections = {
  movies: MovieTitle[]
  shows: ShowTitle[]
  all: LibraryTitle[]
}

type BrowseSection = {
  id: 'continue' | 'movies' | 'results' | 'shows'
  label: string
  titles: LibraryTitle[]
}

type NavItem = {
  label: string
  count: string
  icon: LucideIcon
  mode: MediaViewMode
}

type MyHomeMediaServerWindow = Window & {
  HOME_MEDIA_CONFIG?: {
    apiBase?: string
  }
}

const apiBaseStorageKey = 'my-home-media-server-api-base-v1'
const autoEncodeStorageKey = 'my-home-media-server-auto-encode-v1'
const legacyApiBaseStorageKey = 'home-media-api-base-v1'
const quickJumpLastDigit = 9

async function fetchLibrary(
  apiBase: string,
  signal?: AbortSignal,
  refresh = false,
) {
  const response = await fetch(
    buildApiUrl(`/api/library${refresh ? '?refresh=1' : ''}`, apiBase),
    {
      cache: 'no-store',
      signal,
    },
  )

  if (!response.ok) {
    throw new Error(`Library scan failed (${response.status})`)
  }

  return (await response.json()) as LibraryResponse
}

async function fetchFileShare(
  apiBase: string,
  path: string,
  signal?: AbortSignal,
) {
  const searchParams = new URLSearchParams()

  if (path) {
    searchParams.set('path', path)
  }

  const queryString = searchParams.toString()
  const response = await fetch(
    buildApiUrl(
      `/api/files${queryString ? `?${queryString}` : ''}`,
      apiBase,
    ),
    {
      cache: 'no-store',
      signal,
    },
  )

  if (!response.ok) {
    throw new Error(`File list failed (${response.status})`)
  }

  return (await response.json()) as FileShareResponse
}

async function fetchPreviewCacheStatus(
  apiBase: string,
  signal?: AbortSignal,
) {
  const response = await fetch(buildApiUrl('/api/preview-cache', apiBase), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Preview cache status failed (${response.status})`)
  }

  return (await response.json()) as PreviewCacheStatus
}

async function fetchTranscodeCacheStatus(
  apiBase: string,
  signal?: AbortSignal,
) {
  const response = await fetch(buildApiUrl('/api/transcode-cache', apiBase), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Encoded video cache status failed (${response.status})`)
  }

  return (await response.json()) as TranscodeCacheStatus
}

async function startPreviewCacheWarm(apiBase: string) {
  const response = await fetch(buildApiUrl('/api/preview-cache', apiBase), {
    cache: 'no-store',
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Preview cache warm failed (${response.status})`)
  }

  return (await response.json()) as PreviewCacheStatus
}

async function startTranscodeCacheWarm(apiBase: string) {
  const response = await fetch(buildApiUrl('/api/transcode-cache', apiBase), {
    cache: 'no-store',
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error(`Encoded video cache warm failed (${response.status})`)
  }

  return (await response.json()) as TranscodeCacheStatus
}

async function clearPreviewCache(apiBase: string) {
  const response = await fetch(buildApiUrl('/api/preview-cache', apiBase), {
    cache: 'no-store',
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`Preview cache clear failed (${response.status})`)
  }

  return (await response.json()) as PreviewCacheStatus
}

async function clearTranscodeCache(apiBase: string) {
  const response = await fetch(buildApiUrl('/api/transcode-cache', apiBase), {
    cache: 'no-store',
    method: 'DELETE',
  })

  if (!response.ok) {
    throw new Error(`Encoded video cache clear failed (${response.status})`)
  }

  return (await response.json()) as TranscodeCacheStatus
}

function App() {
  const [apiBase, setApiBase] = useState(readInitialApiBase)
  const [apiBaseDraft, setApiBaseDraft] = useState(apiBase)
  const [activeView, setActiveView] = useState<ViewMode>('Home')
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [filePath, setFilePath] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [fileReloadKey, setFileReloadKey] = useState(0)
  const [fileShare, setFileShare] = useState<FileShareResponse | null>(null)
  const [filesLoading, setFilesLoading] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [autoEncodeEnabled, setAutoEncodeEnabled] = useState(
    readAutoEncodeEnabled,
  )
  const [activePlaybackMediaId, setActivePlaybackMediaId] = useState<
    string | null
  >(null)
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackHistory>(
    readLocalPlaybackHistory,
  )
  const [playerItem, setPlayerItem] = useState<MediaItem | null>(null)
  const [previewCacheActionRunning, setPreviewCacheActionRunning] =
    useState(false)
  const [previewCacheStatus, setPreviewCacheStatus] =
    useState<PreviewCacheStatus | null>(null)
  const [transcodeCacheActionRunning, setTranscodeCacheActionRunning] =
    useState(false)
  const [transcodeCacheStatus, setTranscodeCacheStatus] =
    useState<TranscodeCacheStatus | null>(null)
  const [mediaQuery, setMediaQuery] = useState('')
  const [scanRunning, setScanRunning] = useState(false)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    null,
  )
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const playbackHistoryRef = useRef(playbackHistory)
  const playbackActivityClientIdRef = useRef(readPlaybackActivityClientId())
  const playbackActivityCleanupStateRef =
    useRef<PlaybackActivityState>('closed')
  const lastPlaybackWriteRef = useRef<Record<string, number>>({})
  const lastAutoEncodeWarmKeyRef = useRef('')
  const playerRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    playbackHistoryRef.current = playbackHistory
    writeLocalPlaybackHistory(playbackHistory)
  }, [playbackHistory])

  useEffect(() => {
    const controller = new AbortController()

    fetchPlaybackHistory(apiBase, controller.signal)
      .then((serverHistory) => {
        if (controller.signal.aborted) {
          return
        }

        const nextHistory = mergePlaybackHistories(
          playbackHistoryRef.current,
          serverHistory,
        )

        setPlaybackHistory(nextHistory)

        for (const [mediaId, record] of Object.entries(nextHistory)) {
          if (serverHistory[mediaId]?.updatedAt !== record.updatedAt) {
            void savePlaybackRecord(apiBase, mediaId, record).catch(() => undefined)
          }
        }
      })
      .catch(() => undefined)

    return () => controller.abort()
  }, [apiBase])

  useEffect(() => {
    if (apiBase) {
      window.localStorage.setItem(apiBaseStorageKey, apiBase)
      window.localStorage.removeItem(legacyApiBaseStorageKey)
    } else {
      window.localStorage.removeItem(apiBaseStorageKey)
      window.localStorage.removeItem(legacyApiBaseStorageKey)
    }
  }, [apiBase])

  useEffect(() => {
    window.localStorage.setItem(
      autoEncodeStorageKey,
      autoEncodeEnabled ? '1' : '0',
    )
  }, [autoEncodeEnabled])

  useEffect(() => {
    const controller = new AbortController()

    fetchLibrary(apiBase, controller.signal)
      .then((nextLibrary) => {
        const nextCollections = buildCollections(
          nextLibrary.items,
          playbackHistoryRef.current,
        )
        const initialTitle = getInitialSelection(nextCollections)

        setLibrary(nextLibrary)
        setSelectedTitleId(initialTitle?.id ?? null)
        setSelectedEpisodeId(
          initialTitle
            ? getResumeItem(initialTitle, playbackHistoryRef.current)?.id ?? null
            : null,
        )
        setError(null)
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(requestError))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsLoading(false)
        }
      })

    return () => controller.abort()
  }, [apiBase])

  useEffect(() => {
    if (!autoEncodeEnabled || !library) {
      return
    }

    const unplayableCount = library.items.filter(
      (item) => !item.browserPlayable,
    ).length

    if (unplayableCount === 0) {
      return
    }

    const warmKey = [
      apiBase,
      library.summary.scannedAt,
      library.summary.totalVideos,
      unplayableCount,
    ].join(':')

    if (lastAutoEncodeWarmKeyRef.current === warmKey) {
      return
    }

    lastAutoEncodeWarmKeyRef.current = warmKey

    void startTranscodeCacheWarm(apiBase)
      .then(setTranscodeCacheStatus)
      .catch((requestError: unknown) => setError(getErrorMessage(requestError)))
  }, [apiBase, autoEncodeEnabled, library])

  useEffect(() => {
    if (activeView !== 'Files') {
      return
    }

    const controller = new AbortController()

    void Promise.resolve().then(() => {
      if (!controller.signal.aborted) {
        setFilesLoading(true)
        setFileError(null)
      }
    })

    fetchFileShare(apiBase, filePath, controller.signal)
      .then((nextFileShare) => {
        if (!controller.signal.aborted) {
          setFileShare(nextFileShare)
        }
      })
      .catch((requestError: unknown) => {
        if (!controller.signal.aborted) {
          setFileError(getErrorMessage(requestError))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setFilesLoading(false)
        }
      })

    return () => controller.abort()
  }, [activeView, apiBase, filePath, fileReloadKey])

  useEffect(() => {
    if (!showSettings) {
      return
    }

    const controller = new AbortController()
    let timeoutId: number | null = null

    function scheduleRefresh() {
      timeoutId = window.setTimeout(loadStatus, 1500)
    }

    function loadStatus() {
      Promise.all([
        fetchPreviewCacheStatus(apiBase, controller.signal),
        fetchTranscodeCacheStatus(apiBase, controller.signal),
      ])
        .then(([nextPreviewStatus, nextTranscodeStatus]) => {
          setPreviewCacheStatus(nextPreviewStatus)
          setTranscodeCacheStatus(nextTranscodeStatus)

          if (!controller.signal.aborted) {
            scheduleRefresh()
          }
        })
        .catch((requestError: unknown) => {
          if (!controller.signal.aborted) {
            setError(getErrorMessage(requestError))
          }
        })
    }

    loadStatus()

    return () => {
      controller.abort()

      if (timeoutId !== null) {
        window.clearTimeout(timeoutId)
      }
    }
  }, [apiBase, showSettings])

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (handleMediaKey(event, playerRef.current)) {
        return
      }

      if (handleBackKey(event, showSettings, setShowSettings)) {
        return
      }

      handleDirectionalFocus(event)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSettings])

  useEffect(() => {
    requestAnimationFrame(() => {
      if (!document.activeElement || document.activeElement === document.body) {
        getFocusableElements()[0]?.focus()
      }
    })
  }, [isLoading])

  const collections = useMemo(
    () => buildCollections(library?.items ?? [], playbackHistory),
    [library?.items, playbackHistory],
  )

  const selectedTitle = useMemo(
    () =>
      selectedTitleId
        ? collections.all.find((title) => title.id === selectedTitleId) ?? null
        : null,
    [collections, selectedTitleId],
  )

  const selectedItem = getSelectedItem(selectedTitle, selectedEpisodeId)
  const selectedPlayback = selectedItem
    ? playbackHistory[selectedItem.id] ?? null
    : null
  const playerPlayback = playerItem
    ? playbackHistory[playerItem.id] ?? null
    : null

  useEffect(() => {
    if (!activePlaybackMediaId) {
      return
    }

    const clientId = playbackActivityClientIdRef.current

    function sendOpenHeartbeat() {
      void reportPlaybackActivity(
        apiBase,
        clientId,
        activePlaybackMediaId,
        'open',
      ).catch(() => undefined)
    }

    function handlePageHide() {
      sendPlaybackActivityBeacon(
        apiBase,
        clientId,
        activePlaybackMediaId,
        'closed',
      )
    }

    sendOpenHeartbeat()

    const intervalId = window.setInterval(
      sendOpenHeartbeat,
      playbackActivityHeartbeatMs,
    )

    window.addEventListener('pagehide', handlePageHide)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('pagehide', handlePageHide)

      const cleanupState = playbackActivityCleanupStateRef.current

      playbackActivityCleanupStateRef.current = 'closed'
      sendPlaybackActivityBeacon(
        apiBase,
        clientId,
        activePlaybackMediaId,
        cleanupState,
      )
    }
  }, [activePlaybackMediaId, apiBase])

  const visibleTitles =
    activeView === 'Files'
      ? []
      : getTitlesForView(collections, activeView, mediaQuery)
  const browseSections = useMemo(
    () =>
      activeView === 'Files'
        ? []
        : buildBrowseSections(collections, activeView, mediaQuery),
    [activeView, collections, mediaQuery],
  )
  const visibleFileEntries = filterFileEntries(
    fileShare?.entries ?? [],
    fileQuery,
  )
  const currentError = activeView === 'Files' ? fileError : error

  const navItems: NavItem[] = [
    {
      label: 'Home',
      count: formatNumber(collections.all.length),
      icon: LayoutGrid,
      mode: 'Home',
    },
    {
      label: 'Movies',
      count: formatNumber(collections.movies.length),
      icon: Video,
      mode: 'Movies',
    },
    {
      label: 'TV Shows',
      count: formatNumber(collections.shows.length),
      icon: Tv,
      mode: 'TV Shows',
    },
  ]

  async function startScan() {
    setScanRunning(true)
    setError(null)

    try {
      const nextLibrary = await fetchLibrary(apiBase, undefined, true)
      const nextCollections = buildCollections(
        nextLibrary.items,
        playbackHistoryRef.current,
      )
      const preservedSelection = nextCollections.all.find(
        (title) => title.id === selectedTitleId,
      )
      const nextSelection = preservedSelection ?? getInitialSelection(nextCollections)
      const nextResumeItem = nextSelection
        ? getResumeItem(nextSelection, playbackHistoryRef.current)
        : null

      if (
        activePlaybackMediaId &&
        (!nextResumeItem || nextResumeItem.id !== activePlaybackMediaId)
      ) {
        closeActivePlaybackActivity()
      }

      setLibrary(nextLibrary)
      setSelectedTitleId(nextSelection?.id ?? null)
      setSelectedEpisodeId(nextResumeItem?.id ?? null)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setScanRunning(false)
    }
  }

  function closeActivePlaybackActivity() {
    if (!activePlaybackMediaId) {
      return
    }

    playbackActivityCleanupStateRef.current = 'closed'
    setActivePlaybackMediaId(null)
  }

  function selectTitle(
    title: LibraryTitle | null,
    availableCollections = collections,
  ) {
    if (!title) {
      closeActivePlaybackActivity()
      setSelectedTitleId(null)
      setSelectedEpisodeId(null)
      return
    }

    const resolvedTitle =
      availableCollections.all.find((item) => item.id === title.id) ?? title
    const nextResumeItem = getResumeItem(
      resolvedTitle,
      playbackHistoryRef.current,
    )

    if (
      activePlaybackMediaId &&
      (!nextResumeItem || nextResumeItem.id !== activePlaybackMediaId)
    ) {
      closeActivePlaybackActivity()
    }

    setSelectedTitleId(resolvedTitle.id)
    setSelectedEpisodeId(nextResumeItem?.id ?? null)
  }

  function selectEpisode(episode: MediaItem) {
    if (activePlaybackMediaId && episode.id !== activePlaybackMediaId) {
      closeActivePlaybackActivity()
    }

    setSelectedEpisodeId(episode.id)
  }

  function changeView(nextView: MediaViewMode) {
    setActiveView(nextView)

    const nextTitle = getTitlesForView(collections, nextView, mediaQuery)[0]

    if (nextTitle) {
      selectTitle(nextTitle)
    } else {
      selectTitle(null)
    }
  }

  function openFileView() {
    closeActivePlaybackActivity()

    if (activeView === 'Files') {
      refreshFileShare()
      return
    }

    setFilesLoading(true)
    setFileError(null)
    setActiveView('Files')
  }

  function changeMediaQuery(nextQuery: string) {
    setMediaQuery(nextQuery)

    const currentMediaView = activeView === 'Files' ? 'Home' : activeView
    const nextTitle = getTitlesForView(collections, currentMediaView, nextQuery)[0]

    if (nextTitle) {
      selectTitle(nextTitle)
    } else if (nextQuery.trim()) {
      selectTitle(null)
    }
  }

  function openFileDirectory(nextPath: string) {
    setFilesLoading(true)
    setFileError(null)
    setFilePath(nextPath)
    setFileQuery('')
  }

  function refreshFileShare() {
    setFilesLoading(true)
    setFileError(null)
    setFileReloadKey((currentKey) => currentKey + 1)
  }

  function openPlaybackActivity(item: MediaItem) {
    playbackActivityCleanupStateRef.current = 'closed'
    setActivePlaybackMediaId(item.id)
  }

  function endPlaybackActivity(item: MediaItem) {
    if (activePlaybackMediaId === item.id) {
      playbackActivityCleanupStateRef.current = 'ended'
      setActivePlaybackMediaId(null)
      return
    }

    sendPlaybackActivityBeacon(
      apiBase,
      playbackActivityClientIdRef.current,
      item.id,
      'ended',
    )
  }

  function closePlaybackActivity(item: MediaItem) {
    if (activePlaybackMediaId === item.id) {
      playbackActivityCleanupStateRef.current = 'closed'
      setActivePlaybackMediaId(null)
    }
  }

  function playSelectedItem() {
    startPlayback(selectedItem)
  }

  function startPlayback(item: MediaItem | null) {
    if (!item) {
      return
    }

    setSelectedEpisodeId(item.id)
    setPlayerItem(item)
    openPlaybackActivity(item)
  }

  function fullscreenSelectedItem() {
    const player = playerRef.current

    if (!player) {
      return
    }

    void player
      .requestFullscreen()
      .then(() => player.play())
      .catch(() => player.play())
  }

  function closePlayer() {
    if (playerItem && playerRef.current) {
      recordPlayback(playerItem, playerRef.current, true)
      closePlaybackActivity(playerItem)
    }

    setPlayerItem(null)
  }

  function markItemsWatched(items: MediaItem[]) {
    if (!items.length) {
      return
    }

    const now = getCurrentTimestamp()
    const records = items.map((item, itemIndex) => {
      const existingRecord = playbackHistoryRef.current[item.id]
      const duration =
        existingRecord?.duration && existingRecord.duration > 0
          ? existingRecord.duration
          : 1
      const record: PlaybackRecord = {
        completed: true,
        duration,
        position: duration,
        updatedAt: now + itemIndex,
      }

      return { item, record }
    })

    setPlaybackHistory((currentHistory) => {
      const nextHistory = { ...currentHistory }

      for (const { item, record } of records) {
        nextHistory[item.id] = record
      }

      return nextHistory
    })

    for (const { item, record } of records) {
      void savePlaybackRecord(apiBase, item.id, record).catch(() => undefined)
    }
  }

  function markItemsUnwatched(items: MediaItem[]) {
    if (!items.length) {
      return
    }

    setPlaybackHistory((currentHistory) => {
      const nextHistory = { ...currentHistory }

      for (const item of items) {
        delete nextHistory[item.id]
      }

      return nextHistory
    })

    for (const item of items) {
      void deletePlaybackRecord(apiBase, item.id).catch(() => undefined)
    }
  }

  function markSelectedTitleWatched() {
    if (selectedTitle) {
      markItemsWatched(getTitleItems(selectedTitle))
    }
  }

  function clearSelectedTitleProgress() {
    if (selectedTitle) {
      markItemsUnwatched(getTitleItems(selectedTitle))
    }
  }

  function handleLoadedMetadata(
    item: MediaItem,
    event: SyntheticEvent<HTMLVideoElement>,
  ) {
    const record = playbackHistoryRef.current[item.id]
    const video = event.currentTarget
    const resumePosition = getResumePosition(record, video.duration)

    if (resumePosition > 0) {
      video.currentTime = resumePosition
    }
  }

  function recordPlayback(
    item: MediaItem,
    video: HTMLVideoElement,
    force = false,
  ) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const position = Number.isFinite(video.currentTime) ? video.currentTime : 0

    if (!duration || position < 1) {
      return
    }

    const now = getCurrentTimestamp()

    if (!force && now - (lastPlaybackWriteRef.current[item.id] ?? 0) < 5000) {
      return
    }

    lastPlaybackWriteRef.current[item.id] = now
    const record = {
      completed: position / duration >= 0.95,
      duration,
      position,
      updatedAt: now,
    }

    setPlaybackHistory((currentHistory) => ({
      ...currentHistory,
      [item.id]: record,
    }))
    void savePlaybackRecord(apiBase, item.id, record).catch(() => undefined)
  }

  function saveApiSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextApiBase = normalizeApiBase(apiBaseDraft)

    setIsLoading(true)
    setApiBase(nextApiBase)
    setShowSettings(false)
  }

  async function warmPreviewCache() {
    setPreviewCacheActionRunning(true)
    setError(null)

    try {
      setPreviewCacheStatus(await startPreviewCacheWarm(apiBase))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPreviewCacheActionRunning(false)
    }
  }

  async function removePreviewCache() {
    setPreviewCacheActionRunning(true)
    setError(null)

    try {
      setPreviewCacheStatus(await clearPreviewCache(apiBase))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setPreviewCacheActionRunning(false)
    }
  }

  async function warmTranscodeCache() {
    setTranscodeCacheActionRunning(true)
    setError(null)

    try {
      setTranscodeCacheStatus(await startTranscodeCacheWarm(apiBase))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setTranscodeCacheActionRunning(false)
    }
  }

  async function removeTranscodeCache() {
    setTranscodeCacheActionRunning(true)
    setError(null)

    try {
      setTranscodeCacheStatus(await clearTranscodeCache(apiBase))
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setTranscodeCacheActionRunning(false)
    }
  }

  return (
    <main className="app-shell">
      {playerItem ? (
        <section className="browser-player-shell" aria-label="Now playing">
          <video
            autoPlay
            className="browser-player"
            controls
            key={playerItem.id}
            onEnded={(event) => {
              recordPlayback(playerItem, event.currentTarget, true)
              endPlaybackActivity(playerItem)
              setPlayerItem(null)
            }}
            onError={() => closePlaybackActivity(playerItem)}
            onLoadedMetadata={(event) => handleLoadedMetadata(playerItem, event)}
            onPause={(event) =>
              recordPlayback(playerItem, event.currentTarget, true)
            }
            onPlay={() => openPlaybackActivity(playerItem)}
            onPlaying={() => openPlaybackActivity(playerItem)}
            onTimeUpdate={(event) =>
              recordPlayback(playerItem, event.currentTarget)
            }
            preload={playerItem.browserPlayable ? 'auto' : 'metadata'}
            ref={playerRef}
            src={getPlaybackStreamUrl(playerItem, apiBase)}
          />
          <div className="browser-player-info">
            <div>
              <p className="eyebrow">{getPlayerSubtitle(playerItem)}</p>
              <h2>{getPlayerTitle(playerItem)}</h2>
              <span>
                {playerPlayback && !playerPlayback.completed
                  ? `Resume ${formatDuration(playerPlayback.position)}`
                  : getMediaContainerLabel(playerItem)}
              </span>
            </div>
            <button
              className="icon-button"
              onClick={fullscreenSelectedItem}
              title="Fullscreen"
              type="button"
            >
              <Maximize2 size={20} />
            </button>
            <button
              className="icon-button"
              onClick={closePlayer}
              title="Close player"
              type="button"
            >
              <X size={21} />
            </button>
          </div>
        </section>
      ) : null}

      <header className="app-topbar">
        <button
          className="brand-lockup"
          onClick={() => changeView('Home')}
          type="button"
        >
          <span className="brand-mark">
            <Radio size={24} />
          </span>
          <span>
            <p className="eyebrow">Local server</p>
            <h1>My Home Media Server</h1>
          </span>
        </button>

        <nav className="nav-stack" aria-label="Library navigation">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <button
                aria-pressed={activeView === item.mode}
                className={
                  activeView === item.mode ? 'nav-item active' : 'nav-item'
                }
                key={item.label}
                onClick={() => changeView(item.mode)}
                title={item.label}
                type="button"
              >
                <Icon size={18} />
                <span>{item.label}</span>
                <strong>{isLoading ? '...' : item.count}</strong>
              </button>
            )
          })}
          <button
            aria-pressed={activeView === 'Files'}
            className={activeView === 'Files' ? 'nav-item active' : 'nav-item'}
            onClick={openFileView}
            title="Files"
            type="button"
          >
            <FolderOpen size={18} />
            <span>Files</span>
          </button>
        </nav>

        <div className="topbar-actions">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label={
                activeView === 'Files' ? 'Search files' : 'Search library'
              }
              onChange={(event) =>
                activeView === 'Files'
                  ? setFileQuery(event.target.value)
                  : changeMediaQuery(event.target.value)
              }
              placeholder={
                activeView === 'Files' ? 'Search files' : 'Search titles'
              }
              value={activeView === 'Files' ? fileQuery : mediaQuery}
            />
          </div>
          <button
            className="icon-button"
            onClick={() => {
              setApiBaseDraft(apiBase)
              setShowSettings((isOpen) => !isOpen)
            }}
            title="Server settings"
            type="button"
          >
            <Settings size={19} />
          </button>
          {activeView === 'Files' ? (
            <button
              className="primary-button"
              disabled={filesLoading}
              onClick={refreshFileShare}
              type="button"
            >
              <RefreshCcw size={18} />
              {filesLoading ? 'Loading' : 'Refresh'}
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={scanRunning}
              onClick={startScan}
              type="button"
            >
              <RefreshCcw size={18} />
              {scanRunning ? 'Scanning' : 'Scan'}
            </button>
          )}
          {showSettings ? (
            <form className="server-settings" onSubmit={saveApiSettings}>
              <label htmlFor="server-url">Server URL</label>
              <input
                id="server-url"
                onChange={(event) => setApiBaseDraft(event.target.value)}
                placeholder="http://192.168.1.25:23232"
                value={apiBaseDraft}
              />
              <div className="settings-actions">
                <button className="secondary-button" type="submit">
                  Save
                </button>
                <button
                  className="secondary-button subtle"
                  onClick={() => setApiBaseDraft('')}
                  type="button"
                >
                  This host
                </button>
              </div>
              <section
                className="settings-section"
                aria-label="Encoded video cache"
              >
                <div className="settings-heading">
                  <span>Encoded video cache</span>
                  <strong>
                    {transcodeCacheStatus
                      ? formatTranscodeCacheState(transcodeCacheStatus)
                      : 'Loading'}
                  </strong>
                </div>
                <label className="settings-toggle">
                  <input
                    checked={autoEncodeEnabled}
                    onChange={(event) =>
                      setAutoEncodeEnabled(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>Automatically encode unsupported videos</span>
                </label>
                <p
                  className="settings-path"
                  title={transcodeCacheStatus?.cacheRoot}
                >
                  {transcodeCacheStatus?.cacheRoot ?? 'Checking cache folder'}
                </p>
                <div className="settings-metrics">
                  <span>
                    {transcodeCacheStatus?.cacheSizeLabel ?? '0 B'} /{' '}
                    {formatNumber(transcodeCacheStatus?.cacheFiles ?? 0)} files
                  </span>
                  <span>
                    {formatNumber(
                      (transcodeCacheStatus?.cachedVideos ?? 0) +
                        (transcodeCacheStatus?.generatedVideos ?? 0),
                    )}{' '}
                    / {formatNumber(transcodeCacheStatus?.totalVideos ?? 0)}{' '}
                    videos
                  </span>
                  <span>
                    Target: {transcodeCacheStatus?.target ?? 'MP4 H.264/AAC'}
                  </span>
                </div>
                {transcodeCacheStatus?.currentTitle ? (
                  <p className="settings-note">
                    {transcodeCacheStatus.currentTitle}
                  </p>
                ) : null}
                {transcodeCacheStatus?.lastError ? (
                  <p className="settings-error">
                    {transcodeCacheStatus.lastError}
                  </p>
                ) : null}
                <div className="settings-actions">
                  <button
                    className="secondary-button subtle"
                    disabled={
                      transcodeCacheActionRunning ||
                      transcodeCacheStatus?.state === 'clearing'
                    }
                    onClick={warmTranscodeCache}
                    type="button"
                  >
                    <RefreshCcw size={16} />
                    Encode
                  </button>
                  <button
                    className="secondary-button danger"
                    disabled={transcodeCacheActionRunning}
                    onClick={removeTranscodeCache}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Clear
                  </button>
                </div>
              </section>
              <section className="settings-section" aria-label="Preview cache">
                <div className="settings-heading">
                  <span>Preview cache</span>
                  <strong>
                    {previewCacheStatus
                      ? formatPreviewCacheState(previewCacheStatus)
                      : 'Loading'}
                  </strong>
                </div>
                <p
                  className="settings-path"
                  title={previewCacheStatus?.cacheRoot}
                >
                  {previewCacheStatus?.cacheRoot ?? 'Checking cache folder'}
                </p>
                <div className="settings-metrics">
                  <span>
                    {previewCacheStatus?.cacheSizeLabel ?? '0 B'} /{' '}
                    {formatNumber(previewCacheStatus?.cacheFiles ?? 0)} files
                  </span>
                  <span>
                    {formatNumber(
                      (previewCacheStatus?.cachedFrames ?? 0) +
                        (previewCacheStatus?.generatedFrames ?? 0),
                    )}{' '}
                    / {formatNumber(previewCacheStatus?.totalFrames ?? 0)}{' '}
                    frames
                  </span>
                  <span>
                    {formatNumber(previewCacheStatus?.completedVideos ?? 0)} /{' '}
                    {formatNumber(previewCacheStatus?.totalVideos ?? 0)} videos
                  </span>
                </div>
                {previewCacheStatus?.currentTitle ? (
                  <p className="settings-note">
                    {previewCacheStatus.currentTitle}
                  </p>
                ) : null}
                {previewCacheStatus?.lastError ? (
                  <p className="settings-error">
                    {previewCacheStatus.lastError}
                  </p>
                ) : null}
                <div className="settings-actions">
                  <button
                    className="secondary-button subtle"
                    disabled={
                      previewCacheActionRunning ||
                      previewCacheStatus?.state === 'clearing'
                    }
                    onClick={warmPreviewCache}
                    type="button"
                  >
                    <RefreshCcw size={16} />
                    Warm
                  </button>
                  <button
                    className="secondary-button danger"
                    disabled={previewCacheActionRunning}
                    onClick={removePreviewCache}
                    type="button"
                  >
                    <Trash2 size={16} />
                    Clear
                  </button>
                </div>
              </section>
            </form>
          ) : null}
        </div>
      </header>

      {currentError ? (
        <section className="error-banner" role="alert">
          <AlertCircle size={18} />
          <span>
            {currentError}. Server: {apiBase || 'this host'}
          </span>
        </section>
      ) : null}

      {activeView === 'Files' ? (
        <section className="file-panel" aria-labelledby="files-heading">
          <div className="panel-heading file-heading">
            <div>
              <p className="eyebrow">
                {fileShare
                  ? `Scanned ${formatScanTime(fileShare.summary.scannedAt)}`
                  : 'Shared files'}
              </p>
              <h2 id="files-heading">Files</h2>
            </div>
            <div className="file-summary">
              {filesLoading ? <LoaderCircle className="spin" size={16} /> : null}
              <span>
                {formatNumber(fileShare?.summary.directories ?? 0)} folders
              </span>
              <span>{formatNumber(fileShare?.summary.files ?? 0)} files</span>
              <strong>{fileShare?.summary.sizeLabel ?? '0 B'}</strong>
            </div>
          </div>

          <div className="file-breadcrumb" aria-label="Current folder">
            <button
              className="secondary-button subtle"
              disabled={!fileShare || !fileShare.summary.relativePath}
              onClick={() =>
                openFileDirectory(fileShare?.summary.parentPath ?? '')
              }
              type="button"
            >
              <ArrowUp size={16} />
              Up
            </button>
            <span title={fileShare?.summary.root}>
              {getFileDirectoryLabel(fileShare)}
            </span>
          </div>

          {filesLoading && !fileShare ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={28} />
              <p>Loading files</p>
            </div>
          ) : visibleFileEntries.length ? (
            <div className="file-list">
              {visibleFileEntries.map((entry) =>
                entry.kind === 'directory' ? (
                  <button
                    className="file-row directory"
                    key={entry.id}
                    onClick={() => openFileDirectory(entry.relativePath)}
                    title={entry.relativePath}
                    type="button"
                  >
                    <Folder className="file-row-icon" size={22} />
                    <span className="file-name">
                      <strong>{entry.name}</strong>
                      <span>{formatFileModifiedTime(entry.modifiedAt)}</span>
                    </span>
                    <span className="file-meta">Folder</span>
                    <ChevronRight size={18} />
                  </button>
                ) : (
                  <a
                    className="file-row"
                    download
                    href={resolveFileDownloadUrl(entry, apiBase)}
                    key={entry.id}
                    title={entry.relativePath}
                  >
                    <FileIcon className="file-row-icon" size={22} />
                    <span className="file-name">
                      <strong>{entry.name}</strong>
                      <span>{entry.relativePath}</span>
                    </span>
                    <span className="file-meta">
                      <span>{entry.sizeLabel}</span>
                      <span className="file-modified">
                        {formatFileModifiedTime(entry.modifiedAt)}
                      </span>
                    </span>
                    <Download size={18} />
                  </a>
                ),
              )}
            </div>
          ) : (
            <div className="empty-state">
              <FileIcon size={30} />
              <p>{fileQuery ? 'No matching files' : 'No files here'}</p>
            </div>
          )}
        </section>
      ) : (
        <section className="media-workspace" aria-labelledby="library-heading">
          <section className="media-hero" aria-live="polite">
            <MediaArtwork
              apiBase={apiBase}
              artworkUrl={selectedTitle?.artworkUrl ?? selectedItem?.artworkUrl}
              className="hero-artwork"
              title={selectedTitle?.title ?? 'My Home Media Server'}
            />
            <div className="media-hero-copy">
              <p className="eyebrow">
                {library
                  ? `Scanned ${formatScanTime(library.summary.scannedAt)}`
                  : 'Scanning source'}
              </p>
              <h2 id="library-heading">
                {selectedTitle?.title ?? 'My Home Media Server'}
              </h2>
              <div className="media-hero-meta">
                <span>{selectedTitle ? getTitleKindLabel(selectedTitle) : activeView}</span>
                <span>
                  {selectedTitle
                    ? getTitleSubtitle(selectedTitle)
                    : `${formatNumber(library?.summary.totalVideos ?? 0)} files`}
                </span>
                <span>
                  {selectedTitle
                    ? getTitleSourceLabel(selectedTitle)
                    : library?.summary.root ?? 'Server'}
                </span>
                {selectedPlayback && !selectedPlayback.completed ? (
                  <span>{formatDuration(selectedPlayback.position)}</span>
                ) : null}
              </div>
              <div className="media-hero-actions">
                <button
                  className="primary-button hero-action"
                  disabled={!selectedItem}
                  onClick={playSelectedItem}
                  type="button"
                >
                  <Play fill="currentColor" size={18} />
                  {getPrimaryActionLabel(
                    selectedTitle,
                    selectedItem,
                    selectedPlayback,
                  )}
                </button>
                <button
                  className="secondary-button subtle"
                  disabled={!selectedTitle}
                  onClick={markSelectedTitleWatched}
                  type="button"
                >
                  <Check size={17} />
                  Mark watched
                </button>
                <button
                  className="secondary-button subtle"
                  disabled={!selectedTitle}
                  onClick={clearSelectedTitleProgress}
                  type="button"
                >
                  Clear progress
                </button>
              </div>
            </div>
            <div className="hero-status">
              <Server size={18} />
              <span>{apiBase || 'This host'}</span>
              <strong>{formatNumber(visibleTitles.length)} titles</strong>
            </div>
          </section>

          {isLoading ? (
            <div className="empty-state">
              <LoaderCircle className="spin" size={28} />
              <p>Scanning F:/media</p>
            </div>
          ) : !selectedTitle ? (
            <div className="empty-state">
              <FileVideo size={30} />
              <p>No titles found</p>
            </div>
          ) : null}

          {!isLoading && browseSections.length ? (
            <section className="media-rows" aria-label="Media rows">
              {browseSections.map((section) => (
                <section className="media-row" key={section.id}>
                  <div className="section-heading">
                    <h3>{section.label}</h3>
                    <span>{formatNumber(section.titles.length)}</span>
                  </div>
                  <div className="media-card-row">
                    {section.titles.map((title) => {
                      const isSelected = selectedTitle?.id === title.id
                      const playback = getTitleProgressRecord(
                        title,
                        playbackHistory,
                      )

                      return (
                        <button
                          className={
                            isSelected ? 'media-card selected' : 'media-card'
                          }
                          key={`${section.id}:${title.id}`}
                          onClick={() => {
                            selectTitle(title)

                            if (section.id === 'continue') {
                              startPlayback(title.resumeItem)
                            }
                          }}
                          type="button"
                        >
                          <MediaArtwork
                            apiBase={apiBase}
                            artworkUrl={title.artworkUrl}
                            className="media-card-art"
                            title={title.title}
                          />
                          <span>{title.kind === 'show' ? 'TV' : 'Movie'}</span>
                          <strong>{title.title}</strong>
                          <p>
                            {section.id === 'continue'
                              ? getPlaybackLabel(title, title.resumeItem)
                              : getTitleSubtitle(title)}
                          </p>
                          {playback && playback.duration > 0 ? (
                            <div className="tv-progress" aria-hidden="true">
                              <i
                                style={{
                                  width: `${getTitleProgressPercent(playback)}%`,
                                }}
                              />
                            </div>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </section>
          ) : null}

          {selectedTitle ? (
            <section className="title-detail" aria-label="Selected title detail">
              <div className="detail-heading">
                <div>
                  <p className="eyebrow">
                    {selectedTitle.kind === 'show'
                      ? selectedTitle.source
                      : selectedTitle.item.source}
                  </p>
                  <h2>{selectedTitle.title}</h2>
                </div>
                <span>{getDetailItemsCountLabel(selectedTitle)}</span>
              </div>

              <div className="detail-list">
                {selectedTitle.kind === 'show' ? (
                  selectedTitle.seasons.map((season) => (
                    <section className="season-group" key={season.seasonNumber}>
                      <p className="eyebrow">
                        Season {season.seasonNumber || 'Unknown'}
                      </p>
                      {season.episodes.map((episode) => {
                        const episodeRecord = playbackHistory[episode.id] ?? null
                        const isSelected = selectedItem?.id === episode.id

                        return (
                          <div
                            className={
                              isSelected
                                ? 'episode-row selected'
                                : 'episode-row'
                            }
                            key={episode.id}
                          >
                            <button
                              className="episode-play"
                              onClick={() => {
                                selectEpisode(episode)
                                startPlayback(episode)
                              }}
                              type="button"
                            >
                              <span>{formatEpisodeNumber(episode)}</span>
                              <strong>{getDetailItemTitle(episode)}</strong>
                              <p>{getDetailPlaybackLabel(episode, episodeRecord)}</p>
                              {episodeRecord && episodeRecord.duration > 0 ? (
                                <div className="tv-progress" aria-hidden="true">
                                  <i
                                    style={{
                                      width: `${getTitleProgressPercent(
                                        episodeRecord,
                                      )}%`,
                                    }}
                                  />
                                </div>
                              ) : null}
                            </button>
                            <div className="episode-actions">
                              <button
                                className="icon-button"
                                onClick={() => markItemsWatched([episode])}
                                title="Mark watched"
                                type="button"
                              >
                                <Check size={17} />
                              </button>
                              <button
                                className="icon-button"
                                onClick={() => markItemsUnwatched([episode])}
                                title="Clear progress"
                                type="button"
                              >
                                <X size={17} />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </section>
                  ))
                ) : (
                  <div className="episode-row selected">
                    <button
                      className="episode-play"
                      onClick={() => startPlayback(selectedTitle.item)}
                      type="button"
                    >
                      <span>{selectedTitle.item.container}</span>
                      <strong>{selectedTitle.title}</strong>
                      <p>
                        {getDetailPlaybackLabel(selectedTitle.item, selectedPlayback)}
                      </p>
                      {selectedPlayback && selectedPlayback.duration > 0 ? (
                        <div className="tv-progress" aria-hidden="true">
                          <i
                            style={{
                              width: `${getTitleProgressPercent(
                                selectedPlayback,
                              )}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </button>
                    <div className="episode-actions">
                      <button
                        className="icon-button"
                        onClick={() => markItemsWatched([selectedTitle.item])}
                        title="Mark watched"
                        type="button"
                      >
                        <Check size={17} />
                      </button>
                      <button
                        className="icon-button"
                        onClick={() => markItemsUnwatched([selectedTitle.item])}
                        title="Clear progress"
                        type="button"
                      >
                        <X size={17} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </section>
      )}
    </main>
  )
}

function MediaArtwork({
  apiBase,
  artworkUrl,
  className = '',
  title,
}: {
  apiBase: string
  artworkUrl?: string
  className?: string
  title: string
}) {
  const classNames = ['media-artwork', className].filter(Boolean).join(' ')
  const candidateArtworkUrl = artworkUrl
    ? resolveMediaUrl(artworkUrl, apiBase)
    : null
  const [failedArtworkUrl, setFailedArtworkUrl] = useState<string | null>(null)
  const resolvedArtworkUrl =
    candidateArtworkUrl && failedArtworkUrl !== candidateArtworkUrl
      ? candidateArtworkUrl
      : null

  return (
    <div
      aria-label={resolvedArtworkUrl ? `${title} poster` : 'No image found'}
      className={classNames}
      role="img"
    >
      {resolvedArtworkUrl ? (
        <img
          alt=""
          decoding="async"
          loading="lazy"
          onError={() => setFailedArtworkUrl(candidateArtworkUrl)}
          src={resolvedArtworkUrl}
        />
      ) : (
        <div className="media-artwork-placeholder">
          <Clapperboard size={30} />
          <span>No image found</span>
        </div>
      )}
    </div>
  )
}

function buildBrowseSections(
  collections: LibraryCollections,
  activeView: MediaViewMode,
  query: string,
): BrowseSection[] {
  if (query.trim()) {
    const sections: BrowseSection[] = [
      {
        id: 'results',
        label: 'Search results',
        titles: filterTitles(collections.all, query).sort(sortByTitle),
      },
    ]

    return sections.filter((section) => section.titles.length)
  }

  if (activeView === 'Movies') {
    const sections: BrowseSection[] = [
      {
        id: 'movies',
        label: 'Movies',
        titles: collections.movies,
      },
    ]

    return sections.filter((section) => section.titles.length)
  }

  if (activeView === 'TV Shows') {
    const sections: BrowseSection[] = [
      {
        id: 'shows',
        label: 'TV Shows',
        titles: collections.shows,
      },
    ]

    return sections.filter((section) => section.titles.length)
  }

  const continueTitles = collections.all
    .filter((title) => title.lastWatchedAt)
    .sort(sortByLastWatched)

  const sections: BrowseSection[] = [
    {
      id: 'continue',
      label: 'Continue',
      titles: continueTitles,
    },
    {
      id: 'shows',
      label: 'TV Shows',
      titles: collections.shows,
    },
    {
      id: 'movies',
      label: 'Movies',
      titles: collections.movies,
    },
  ]

  return sections.filter((section) => section.titles.length)
}

function buildCollections(
  items: MediaItem[],
  history: PlaybackHistory,
): LibraryCollections {
  const movies = items
    .filter((item) => item.category === 'movie')
    .map<MovieTitle>((item) => ({
      artworkUrl: item.artworkUrl,
      id: `movie:${item.id}`,
      item,
      kind: 'movie',
      lastWatchedAt: history[item.id]?.updatedAt ?? null,
      resumeItem: item,
      title: item.title,
    }))
    .sort(sortByTitle)

  const showMap = new Map<string, MediaItem[]>()

  for (const item of items) {
    if (item.category !== 'show') {
      continue
    }

    const showTitle = item.showTitle ?? item.title
    const key = `${item.source}:${showTitle.toLowerCase()}`
    const episodes = showMap.get(key) ?? []

    episodes.push(item)
    showMap.set(key, episodes)
  }

  const shows = Array.from(showMap.entries())
    .map<ShowTitle>(([key, episodes]) => {
      const sortedEpisodes = [...episodes].sort(sortEpisodes)
      const seasons = groupSeasons(sortedEpisodes)
      const title = sortedEpisodes[0]?.showTitle ?? key.split(':').slice(1).join(':')
      const totalBytes = sortedEpisodes.reduce(
        (sum, episode) => sum + episode.sizeBytes,
        0,
      )
      const lastWatchedAt = sortedEpisodes.reduce<number | null>(
        (latest, episode) => {
          const watchedAt = history[episode.id]?.updatedAt ?? null

          return latest && watchedAt
            ? Math.max(latest, watchedAt)
            : watchedAt ?? latest
        },
        null,
      )

      return {
        artworkUrl: sortedEpisodes.find((episode) => episode.artworkUrl)
          ?.artworkUrl,
        episodeCount: sortedEpisodes.length,
        episodes: sortedEpisodes,
        id: `show:${key}`,
        kind: 'show',
        lastWatchedAt,
        playableCount: sortedEpisodes.filter((episode) => episode.browserPlayable)
          .length,
        resumeItem: getShowResumeItem(sortedEpisodes, history),
        seasons,
        sizeLabel: formatBytes(totalBytes),
        source: sortedEpisodes[0]?.source ?? 'TV Shows',
        title,
        totalBytes,
      }
    })
    .sort(sortByTitle)

  return {
    all: [...movies, ...shows].sort(sortByTitle),
    movies,
    shows,
  }
}

function groupSeasons(episodes: MediaItem[]) {
  const seasonMap = new Map<number, MediaItem[]>()

  for (const episode of episodes) {
    const seasonNumber = episode.seasonNumber ?? 0
    const seasonEpisodes = seasonMap.get(seasonNumber) ?? []

    seasonEpisodes.push(episode)
    seasonMap.set(seasonNumber, seasonEpisodes)
  }

  return Array.from(seasonMap.entries())
    .map(([seasonNumber, seasonEpisodes]) => ({
      episodes: seasonEpisodes.sort(sortEpisodes),
      seasonNumber,
    }))
    .sort((first, second) => first.seasonNumber - second.seasonNumber)
}

function getInitialSelection(collections: LibraryCollections) {
  const recentTitle = [...collections.all].filter((title) => title.lastWatchedAt).sort(sortByLastWatched)[0]

  return recentTitle ?? collections.movies[0] ?? collections.shows[0] ?? null
}

function getSelectedItem(
  title: LibraryTitle | null,
  selectedEpisodeId: string | null,
) {
  if (!title) {
    return null
  }

  if (title.kind === 'movie') {
    return title.item
  }

  return (
    title.episodes.find((episode) => episode.id === selectedEpisodeId) ??
    title.resumeItem ??
    title.episodes[0] ??
    null
  )
}

function getResumeItem(title: LibraryTitle, history: PlaybackHistory) {
  if (title.kind === 'movie') {
    return title.item
  }

  return getShowResumeItem(title.episodes, history)
}

function getShowResumeItem(episodes: MediaItem[], history: PlaybackHistory) {
  if (!episodes.length) {
    return null
  }

  const sortedEpisodes = [...episodes].sort(sortEpisodes)
  const watchedEpisode = sortedEpisodes
    .filter((episode) => history[episode.id])
    .sort(
      (first, second) =>
        history[second.id].updatedAt - history[first.id].updatedAt,
    )[0]

  if (!watchedEpisode) {
    return sortedEpisodes.find((episode) => episode.browserPlayable) ?? sortedEpisodes[0]
  }

  const watchedRecord = history[watchedEpisode.id]

  if (!watchedRecord.completed) {
    return watchedEpisode
  }

  const watchedIndex = sortedEpisodes.findIndex(
    (episode) => episode.id === watchedEpisode.id,
  )
  const nextEpisode = sortedEpisodes[watchedIndex + 1]

  return nextEpisode ?? watchedEpisode
}

function getTitlesForView(
  collections: LibraryCollections,
  activeView: MediaViewMode,
  query: string,
) {
  if (query.trim()) {
    return filterTitles(collections.all, query).sort(sortByTitle)
  }

  if (activeView === 'Movies') {
    return collections.movies
  }

  if (activeView === 'TV Shows') {
    return collections.shows
  }

  const recentTitles = collections.all
    .filter((title) => title.lastWatchedAt)
    .sort(sortByLastWatched)
  const recentIds = new Set(recentTitles.map((title) => title.id))

  return [
    ...recentTitles,
    ...collections.all.filter((title) => !recentIds.has(title.id)),
  ]
}

function filterTitles<T extends LibraryTitle>(titles: T[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return titles
  }

  return titles.filter((title) => {
    if (title.title.toLowerCase().includes(normalizedQuery)) {
      return true
    }

    if (title.kind === 'movie') {
      return title.item.relativePath.toLowerCase().includes(normalizedQuery)
    }

    return title.episodes.some((episode) =>
      `${episode.title} ${episode.relativePath} ${episode.container}`
        .toLowerCase()
        .includes(normalizedQuery),
    )
  })
}

function filterFileEntries(entries: FileShareEntry[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()

  if (!normalizedQuery) {
    return entries
  }

  return entries.filter((entry) =>
    `${entry.name} ${entry.relativePath}`.toLowerCase().includes(normalizedQuery),
  )
}

function sortByTitle(first: LibraryTitle, second: LibraryTitle) {
  return first.title.localeCompare(second.title, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortByLastWatched(first: LibraryTitle, second: LibraryTitle) {
  return (second.lastWatchedAt ?? 0) - (first.lastWatchedAt ?? 0)
}

function sortEpisodes(first: MediaItem, second: MediaItem) {
  return (
    (first.seasonNumber ?? 0) - (second.seasonNumber ?? 0) ||
    (first.episodeNumber ?? 0) - (second.episodeNumber ?? 0) ||
    first.title.localeCompare(second.title, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  )
}

function readInitialApiBase() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryApiBase = params.get('api') ?? params.get('server')
    const storedApiBase =
      window.localStorage.getItem(apiBaseStorageKey) ??
      window.localStorage.getItem(legacyApiBaseStorageKey)

    return normalizeApiBase(
      queryApiBase ??
        getRuntimeApiBase() ??
        storedApiBase ??
        import.meta.env.VITE_HOME_MEDIA_API_BASE,
    )
  } catch {
    return normalizeApiBase(
      getRuntimeApiBase() ?? import.meta.env.VITE_HOME_MEDIA_API_BASE,
    )
  }
}

function readAutoEncodeEnabled() {
  try {
    return window.localStorage.getItem(autoEncodeStorageKey) === '1'
  } catch {
    return false
  }
}

function getRuntimeApiBase() {
  return (window as MyHomeMediaServerWindow).HOME_MEDIA_CONFIG?.apiBase
}

function normalizeApiBase(value: string | null | undefined) {
  const trimmedValue = value?.trim() ?? ''

  if (!trimmedValue) {
    return ''
  }

  const valueWithProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `http://${trimmedValue}`

  try {
    const url = new URL(valueWithProtocol)

    return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
  } catch {
    return valueWithProtocol.replace(/\/+$/, '')
  }
}

function buildApiUrl(path: string, apiBase: string) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  return apiBase ? `${apiBase}${normalizedPath}` : normalizedPath
}

function resolveMediaUrl(streamUrl: string, apiBase: string) {
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(streamUrl)) {
    return streamUrl
  }

  return buildApiUrl(streamUrl, apiBase)
}

function getPlaybackStreamUrl(item: MediaItem, apiBase: string) {
  if (item.browserPlayable) {
    return resolveMediaUrl(item.streamUrl, apiBase)
  }

  return resolveMediaUrl(
    `/api/media/${encodeURIComponent(item.id)}/transcode`,
    apiBase,
  )
}

function resolveFileDownloadUrl(entry: FileShareEntry, apiBase: string) {
  return entry.downloadUrl ? buildApiUrl(entry.downloadUrl, apiBase) : '#'
}

function getFileDirectoryLabel(fileShare: FileShareResponse | null) {
  if (!fileShare) {
    return 'Desktop'
  }

  return fileShare.summary.relativePath || fileShare.summary.root
}

function handleMediaKey(event: KeyboardEvent, player: HTMLVideoElement | null) {
  if (!player) {
    return false
  }

  const quickJumpDigit = getQuickJumpDigit(event)

  if (quickJumpDigit !== null && !isTextInput(document.activeElement)) {
    event.preventDefault()
    seekPlayerToQuickJump(player, quickJumpDigit)

    return true
  }

  if (event.key === 'MediaPlayPause') {
    event.preventDefault()

    if (player.paused) {
      void player.play()
    } else {
      player.pause()
    }

    return true
  }

  return false
}

function handleBackKey(
  event: KeyboardEvent,
  showSettings: boolean,
  setShowSettings: (value: boolean) => void,
) {
  if (!['BrowserBack', 'Escape', 'XF86Back'].includes(event.key)) {
    return false
  }

  if (showSettings) {
    event.preventDefault()
    setShowSettings(false)

    return true
  }

  return false
}

function handleDirectionalFocus(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp'].includes(event.key)) {
    return
  }

  if (isTextInput(document.activeElement)) {
    return
  }

  const focusableElements = getFocusableElements()

  if (!focusableElements.length) {
    return
  }

  event.preventDefault()

  const currentIndex = focusableElements.findIndex(
    (element) => element === document.activeElement,
  )
  const offset =
    event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
  const nextIndex =
    currentIndex === -1
      ? 0
      : (currentIndex + offset + focusableElements.length) %
        focusableElements.length

  focusableElements[nextIndex]?.focus()
}

function getFocusableElements() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), video[controls]',
    ),
  ).filter((element) => element.getClientRects().length > 0)
}

function isTextInput(element: Element | null) {
  return (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement
  )
}

function getQuickJumpDigit(event: KeyboardEvent): QuickJumpDigit | null {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
    return null
  }

  if (/^\d$/.test(event.key)) {
    return toQuickJumpDigit(Number(event.key))
  }

  const keyCode = event.keyCode || event.which

  if (keyCode >= 48 && keyCode <= 57) {
    return toQuickJumpDigit(keyCode - 48)
  }

  if (keyCode >= 96 && keyCode <= 105) {
    return toQuickJumpDigit(keyCode - 96)
  }

  return null
}

function toQuickJumpDigit(value: number): QuickJumpDigit | null {
  return Number.isInteger(value) && value >= 0 && value <= quickJumpLastDigit
    ? (value as QuickJumpDigit)
    : null
}

function seekPlayerToQuickJump(
  player: HTMLVideoElement,
  digit: QuickJumpDigit,
) {
  const duration = getFiniteVideoDuration(player)

  if (!duration) {
    return
  }

  player.currentTime = getQuickJumpPosition(digit, duration)
}

function getQuickJumpPosition(digit: QuickJumpDigit, duration: number) {
  return (duration * digit) / quickJumpLastDigit
}

function getFiniteVideoDuration(video: HTMLVideoElement) {
  return Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : 0
}

function getResumePosition(record: PlaybackRecord | null, duration: number) {
  if (!record || record.completed || !Number.isFinite(duration)) {
    return 0
  }

  if (record.position >= duration - 8) {
    return 0
  }

  return Math.max(record.position - 3, 0)
}

function getTitleKindLabel(title: LibraryTitle) {
  return title.kind === 'show' ? 'TV Show' : 'Movie'
}

function getTitleItems(title: LibraryTitle) {
  return title.kind === 'movie' ? [title.item] : title.episodes
}

function getTitleSubtitle(title: LibraryTitle) {
  if (title.kind === 'movie') {
    return title.item.sizeLabel
  }

  const seasonCount = title.seasons.length

  return `${formatCountLabel(title.episodeCount, 'episode')}, ${formatCountLabel(
    seasonCount,
    'season',
  )}`
}

function getTitleSourceLabel(title: LibraryTitle) {
  return title.kind === 'movie' ? title.item.source : title.source
}

function getTitleProgressRecord(
  title: LibraryTitle,
  history: PlaybackHistory,
) {
  const item = title.kind === 'movie' ? title.item : title.resumeItem

  return item ? history[item.id] ?? null : null
}

function getTitleProgressPercent(record: PlaybackRecord) {
  if (record.duration <= 0) {
    return 0
  }

  return Math.min((record.position / record.duration) * 100, 100)
}

function getPlaybackLabel(title: LibraryTitle, item: MediaItem | null) {
  if (title.kind === 'show' && item) {
    return `${formatEpisodeNumber(item)} · ${getMediaContainerLabel(item)}`
  }

  return item ? getMediaContainerLabel(item) : 'Indexed'
}

function getPrimaryActionLabel(
  title: LibraryTitle | null,
  item: MediaItem | null,
  playback: PlaybackRecord | null,
) {
  if (!title || !item) {
    return 'Play'
  }

  const actionLabel = playback && !playback.completed ? 'Resume' : 'Play'

  if (title.kind === 'show') {
    return `${actionLabel} ${formatEpisodeNumber(item)}`
  }

  return actionLabel
}

function getDetailItemsCountLabel(title: LibraryTitle) {
  return title.kind === 'show'
    ? formatCountLabel(title.episodeCount, 'episode')
    : '1 file'
}

function getDetailItemTitle(item: MediaItem) {
  return item.episodeTitle ?? item.title
}

function getDetailPlaybackLabel(
  item: MediaItem,
  playback: PlaybackRecord | null,
) {
  if (!playback) {
    return getMediaContainerLabel(item)
  }

  return playback.completed
    ? 'Watched'
    : `Resume ${formatDuration(playback.position)}`
}

function getPlayerTitle(item: MediaItem) {
  return item.showTitle ?? item.title
}

function getPlayerSubtitle(item: MediaItem) {
  return item.category === 'show'
    ? `${formatEpisodeNumber(item)} · ${getMediaContainerLabel(item)}`
    : getMediaContainerLabel(item)
}

function getMediaContainerLabel(item: MediaItem) {
  return item.browserPlayable ? item.container : `${item.container} transcode`
}

function formatEpisodeNumber(item: MediaItem) {
  if (!item.seasonNumber && !item.episodeNumber) {
    return item.container
  }

  return `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(
    item.episodeNumber ?? 0,
  ).padStart(2, '0')}`
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

function formatTranscodeCacheState(status: TranscodeCacheStatus) {
  if (status.state === 'clearing') {
    return 'Clearing'
  }

  if (status.state === 'warming') {
    return status.pendingVideos > 0
      ? `Encoding ${formatNumber(status.pendingVideos)}`
      : 'Encoding'
  }

  return 'Idle'
}

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
}

function formatCountLabel(count: number, label: string) {
  return `${formatNumber(count)} ${label}${count === 1 ? '' : 's'}`
}

function formatPreviewCacheState(status: PreviewCacheStatus) {
  if (status.state === 'warming') {
    const modeLabel =
      status.warmMode === 'background'
        ? `${Math.round(status.cpuBudget * 100)}%`
        : 'Fast'

    return status.pendingFrames > 0
      ? `Warming ${formatNumber(status.pendingFrames)} (${modeLabel})`
      : `Warming (${modeLabel})`
  }

  if (status.state === 'clearing') {
    return 'Clearing'
  }

  return 'Idle'
}

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatFileModifiedTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(new Date(value))
}

function formatDuration(seconds: number) {
  const wholeSeconds = Math.max(Math.floor(seconds), 0)
  const hours = Math.floor(wholeSeconds / 3600)
  const minutes = Math.floor((wholeSeconds % 3600) / 60)
  const remainingSeconds = wholeSeconds % 60

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(
      remainingSeconds,
    ).padStart(2, '0')}`
  }

  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
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

function getCurrentTimestamp() {
  return Date.now()
}

export default App
