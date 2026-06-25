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
  ChevronRight,
  Clapperboard,
  Database,
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
  type LucideIcon,
} from 'lucide-react'
import {
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

type NavItem = {
  label: string
  count: string
  icon: LucideIcon
  mode: MediaViewMode
}

type StatItem = {
  label: string
  value: string
  icon: LucideIcon
}

type MyHomeMediaServerWindow = Window & {
  HOME_MEDIA_CONFIG?: {
    apiBase?: string
  }
}

const apiBaseStorageKey = 'my-home-media-server-api-base-v1'
const legacyApiBaseStorageKey = 'home-media-api-base-v1'
const viewModes: MediaViewMode[] = ['Home', 'Movies', 'TV Shows']

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
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackHistory>(
    readLocalPlaybackHistory,
  )
  const [previewCacheActionRunning, setPreviewCacheActionRunning] =
    useState(false)
  const [previewCacheStatus, setPreviewCacheStatus] =
    useState<PreviewCacheStatus | null>(null)
  const [mediaQuery, setMediaQuery] = useState('')
  const [scanRunning, setScanRunning] = useState(false)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    null,
  )
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const playbackHistoryRef = useRef(playbackHistory)
  const lastPlaybackWriteRef = useRef<Record<string, number>>({})
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
      fetchPreviewCacheStatus(apiBase, controller.signal)
        .then((nextStatus) => {
          setPreviewCacheStatus(nextStatus)

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
  const visibleTitles =
    activeView === 'Files'
      ? []
      : getTitlesForView(collections, activeView, mediaQuery)
  const visibleFileEntries = filterFileEntries(
    fileShare?.entries ?? [],
    fileQuery,
  )
  const currentError = activeView === 'Files' ? fileError : error
  const titleOptions =
    selectedTitle &&
    !visibleTitles.some((title) => title.id === selectedTitle.id)
      ? [selectedTitle, ...visibleTitles]
      : visibleTitles

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

  const libraryStats: StatItem[] = [
    {
      label: 'Indexed titles',
      value: formatNumber(collections.all.length),
      icon: Database,
    },
    {
      label: 'Movies',
      value: formatNumber(collections.movies.length),
      icon: Video,
    },
    {
      label: 'TV shows',
      value: formatNumber(collections.shows.length),
      icon: Tv,
    },
    {
      label: 'Video files',
      value: formatNumber(library?.summary.totalVideos ?? 0),
      icon: FileVideo,
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

      setLibrary(nextLibrary)
      setSelectedTitleId(nextSelection?.id ?? null)
      setSelectedEpisodeId(
        nextSelection
          ? getResumeItem(nextSelection, playbackHistoryRef.current)?.id ?? null
          : null,
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setScanRunning(false)
    }
  }

  function selectTitle(
    title: LibraryTitle | null,
    availableCollections = collections,
  ) {
    if (!title) {
      setSelectedTitleId(null)
      setSelectedEpisodeId(null)
      return
    }

    const resolvedTitle =
      availableCollections.all.find((item) => item.id === title.id) ?? title

    setSelectedTitleId(resolvedTitle.id)
    setSelectedEpisodeId(getResumeItem(resolvedTitle, playbackHistoryRef.current)?.id ?? null)
  }

  function selectEpisode(episode: MediaItem) {
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

  function selectTitleById(titleId: string) {
    const nextTitle = titleOptions.find((title) => title.id === titleId)

    if (nextTitle) {
      selectTitle(nextTitle)
    }
  }

  function playSelectedItem() {
    void playerRef.current?.play()
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

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radio size={24} />
          </div>
          <div>
            <p className="eyebrow">Local server</p>
            <h1>My Home Media Server</h1>
          </div>
        </div>

        <nav className="nav-stack">
          {navItems.map((item) => {
            const Icon = item.icon

            return (
              <button
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
        </nav>

        <div className="utility-nav" aria-label="Utility navigation">
          <button
            className={activeView === 'Files' ? 'nav-item active' : 'nav-item'}
            onClick={openFileView}
            title="Files"
            type="button"
          >
            <FolderOpen size={18} />
            <span>Files</span>
          </button>
        </div>

        <div className="server-card">
          <div className="server-icon">
            <Server size={20} />
          </div>
          <div>
            <p className="muted">
              {activeView === 'Files' ? 'File root' : 'Source'}
            </p>
            <strong>
              {activeView === 'Files'
                ? fileShare?.summary.root ?? 'Desktop'
                : library?.summary.root ?? 'F:/media'}
            </strong>
          </div>
          <span className="status-dot" aria-label="Online" />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label={activeView === 'Files' ? 'Search files' : 'Search library'}
              onChange={(event) =>
                activeView === 'Files'
                  ? setFileQuery(event.target.value)
                  : changeMediaQuery(event.target.value)
              }
              placeholder={activeView === 'Files' ? 'Search files' : 'Search titles'}
              value={activeView === 'Files' ? fileQuery : mediaQuery}
            />
          </div>
          <div className="topbar-actions">
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

        {activeView === 'Files' ? null : (
          <section className="stat-grid" aria-label="Library status">
            {libraryStats.map((stat) => {
              const Icon = stat.icon

              return (
                <article className="stat-card" key={stat.label}>
                  <Icon size={18} />
                  <span>{stat.label}</span>
                  <strong>{isLoading ? '...' : stat.value}</strong>
                </article>
              )
            })}
          </section>
        )}

        <section className="content-layout">
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
                  {filesLoading ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : null}
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
          <section className="library-panel" aria-labelledby="library-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">
                  {library
                    ? `Scanned ${formatScanTime(library.summary.scannedAt)}`
                    : 'Scanning source'}
                </p>
                <h2 id="library-heading">{activeView}</h2>
              </div>
              <div className="segmented-control" aria-label="Library view">
                {viewModes.map((mode) => (
                  <button
                    aria-pressed={activeView === mode}
                    className={activeView === mode ? 'selected' : ''}
                    key={mode}
                    onClick={() => changeView(mode)}
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {selectedTitle && selectedItem ? (
              <section className="main-player" aria-label="Selected title">
                <div className="main-player-heading">
                  <div>
                    <p className="eyebrow">
                      {getTitleKindLabel(selectedTitle)}
                    </p>
                    <h3>{selectedTitle.title}</h3>
                    <span>{getPlaybackLabel(selectedTitle, selectedItem)}</span>
                  </div>
                  <div className="title-picker">
                    <select
                      aria-label="Select title"
                      onChange={(event) => selectTitleById(event.target.value)}
                      value={selectedTitle.id}
                    >
                      {titleOptions.map((title) => (
                        <option key={title.id} value={title.id}>
                          {title.title}
                        </option>
                      ))}
                    </select>
                    <span>{formatNumber(visibleTitles.length)} titles</span>
                  </div>
                  <div className="main-player-actions">
                    <button
                      className="secondary-button"
                      disabled={!selectedItem.browserPlayable}
                      onClick={playSelectedItem}
                      type="button"
                    >
                      <Play fill="currentColor" size={17} />
                      Play
                    </button>
                    <button
                      className="icon-button"
                      disabled={!selectedItem.browserPlayable}
                      onClick={fullscreenSelectedItem}
                      title="Fullscreen"
                      type="button"
                    >
                      <Maximize2 size={18} />
                    </button>
                  </div>
                </div>

                <div className="main-player-body">
                  <MediaArtwork
                    apiBase={apiBase}
                    artworkUrl={selectedTitle.artworkUrl ?? selectedItem.artworkUrl}
                    className="main-title-artwork"
                    title={selectedTitle.title}
                  />
                  <div className="main-player-stage">
                    {selectedItem.browserPlayable ? (
                      <video
                        className="main-media-player"
                        controls
                        key={selectedItem.id}
                        onEnded={(event) =>
                          recordPlayback(selectedItem, event.currentTarget, true)
                        }
                        onLoadedMetadata={(event) =>
                          handleLoadedMetadata(selectedItem, event)
                        }
                        onPause={(event) =>
                          recordPlayback(selectedItem, event.currentTarget, true)
                        }
                        onTimeUpdate={(event) =>
                          recordPlayback(selectedItem, event.currentTarget)
                        }
                        preload="metadata"
                        ref={playerRef}
                        src={resolveMediaUrl(selectedItem.streamUrl, apiBase)}
                      />
                    ) : (
                      <div className="player-frame unavailable wide">
                        <Clapperboard size={42} />
                        <p>{selectedItem.container} indexed</p>
                        <span>Firefox needs a playable container</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="main-player-meta">
                  <span>{selectedItem.relativePath}</span>
                  {selectedPlayback ? (
                    <strong>
                      {selectedPlayback.completed
                        ? 'Watched'
                        : `Resume at ${formatDuration(
                            selectedPlayback.position,
                          )}`}
                    </strong>
                  ) : null}
                </div>

                {selectedTitle.kind === 'show' ? (
                  <div className="main-episodes">
                    <div className="section-heading">
                      <h3>Episodes</h3>
                      <span>{formatNumber(selectedTitle.episodeCount)}</span>
                    </div>
                    <div className="episode-list">
                      {selectedTitle.seasons.map((season) => (
                        <div
                          className="season-group"
                          key={season.seasonNumber}
                        >
                          <p className="eyebrow">
                            Season {season.seasonNumber || 'Unknown'}
                          </p>
                          {season.episodes.map((episode) => {
                            const episodeRecord = playbackHistory[episode.id]

                            return (
                              <button
                                className={
                                  selectedItem.id === episode.id
                                    ? 'episode-row selected'
                                    : 'episode-row'
                                }
                                key={episode.id}
                                onClick={() => selectEpisode(episode)}
                                type="button"
                              >
                                <span>
                                  {formatEpisodeNumber(episode)}
                                  {episode.browserPlayable ? '' : ' indexed'}
                                </span>
                                <strong>
                                  {episode.episodeTitle ?? episode.title}
                                </strong>
                                <p>
                                  {episodeRecord
                                    ? episodeRecord.completed
                                      ? 'Watched'
                                      : formatDuration(episodeRecord.position)
                                    : episode.container}
                                </p>
                              </button>
                            )
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}

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
          </section>
          )}
        </section>
      </section>
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
  const nextEpisode = sortedEpisodes
    .slice(watchedIndex + 1)
    .find((episode) => episode.browserPlayable)

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
  if (event.key !== 'MediaPlayPause' || !player) {
    return false
  }

  event.preventDefault()

  if (player.paused) {
    void player.play()
  } else {
    player.pause()
  }

  return true
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

function getPlaybackLabel(title: LibraryTitle, item: MediaItem | null) {
  if (title.kind === 'show' && item) {
    return formatEpisodeNumber(item)
  }

  return item?.container ?? 'Indexed'
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

function formatNumber(value: number) {
  return new Intl.NumberFormat().format(value)
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
