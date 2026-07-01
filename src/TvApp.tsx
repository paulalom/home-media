import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type SyntheticEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { Check, ChevronLeft, ChevronRight, Settings } from 'lucide-react'
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

declare const __HOME_MEDIA_APP_VERSION__: string

type MediaCategory = 'movie' | 'show' | 'other'
type QuickJumpDigit = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9
type LibraryConnectionPhase = 'idle' | 'loading' | 'polling'
type LibraryErrorState = {
  diagnostics: string[]
  message: string
}
type RemoteAction =
  | 'back'
  | 'down'
  | 'enter'
  | 'left'
  | 'pause'
  | 'play'
  | 'playPause'
  | 'right'
  | 'up'
type TvUiRecoveryTrigger = RemoteAction | 'quickJump'

type PlaybackStrategy = 'native' | 'transcode'
type PlayerEngine = 'avplay' | 'html'

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
  items: MediaItem[]
}

type TvTitle = {
  id: string
  kind: 'movie' | 'show'
  title: string
  artworkUrl?: string
  subtitle: string
  source: string
  items: MediaItem[]
  resumeItem: MediaItem
  lastWatchedAt: number | null
}

type TvSection = {
  id: string
  label: string
  titles: TvTitle[]
}

type BrowseFocusArea = 'hero' | 'rows' | 'settings'

type FocusPosition = {
  area: BrowseFocusArea
  itemIndex: number
  sectionIndex: number
}

type DetailState = {
  focusArea: 'episode' | 'episodeMenu' | 'titleMenu'
  itemIndex: number
  title: TvTitle
}

type PlayerClock = {
  duration: number
  position: number
}

type ScanDirection = -1 | 1

type ScanPreview = {
  direction: ScanDirection
  position: number
  scanning: boolean
  speedIndex: number
}

type ShortSeekPreview = {
  position: number
}

type ScanPreviewVisualRequest = {
  kind: 'image' | 'sprite'
  key: string
  url: string
}

type ScanPreviewVisual =
  | {
      kind: 'image'
      key: string
      url: string
    }
  | {
      column: number
      columns: number
      kind: 'sprite'
      key: string
      row: number
      rows: number
      sheetUrl: string
    }

type PreviewSpriteResponse = {
  column: number
  columns: number
  row: number
  rows: number
  sheetUrl: string
}

type ScanPreviewResourceMetrics = {
  bodyBytes: number
  durationMs: number
  networkBytes: number
}

type ScanPreviewCacheStats = {
  appHeapLimitMiB: number | null
  appHeapMiB: number | null
  bandwidthMiBps: number | null
  budgetMiB: number
  decodedCacheMiB: number
  estimatedTotalMiB: number | null
  estimatedSheetTransferKiB: number
  loadMs: number
  retainedSheetsPerDirection: number
  sheetIndex: number
  title: string
  warmSheetsPerDirection: number
}

type ScanPreviewRetainedWindow = {
  firstSheetIndex: number
  itemId: string
  lastSheetIndex: number
  version: string
}

type PlayerEpisodeSwitchOptions = {
  next: MediaItem | null
  previous: MediaItem | null
  target: MediaItem | null
}

type ActionMenuState =
  | {
      kind: 'episode'
      itemIndex: number
      title: TvTitle
    }
  | {
      kind: 'settings'
      preventSleepWhilePaused: boolean
    }
  | {
      kind: 'title'
      title: TvTitle
    }

type ActionMenuEntry = {
  disabled?: boolean
  id:
    | 'mark-all-unwatched'
    | 'mark-all-watched'
    | 'mark-previous-unwatched'
    | 'mark-previous-watched'
    | 'mark-unwatched'
    | 'mark-watched'
    | 'toggle-prevent-sleep-while-paused'
  label: string
}

type ClientVideoProbe = {
  label: string
  mimeType: string
  result: string
}

type ClientDeviceProfile = {
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
  tizenVersion?: string
  userAgent: string
  videoProbes: ClientVideoProbe[]
}

type AvPlayPlaybackCallback = {
  onbufferingcomplete?: () => void
  onbufferingprogress?: (percent: number) => void
  onbufferingstart?: () => void
  oncurrentplaytime?: (currentTime: number) => void
  onerror?: (eventType: string) => void
  onerrormsg?: (eventType: string, eventMessage: string) => void
  onevent?: (eventType: string, eventData: string) => void
  onstreamcompleted?: () => void
}

type AvPlayManager = {
  close: () => void
  getCurrentTime?: () => number
  getDuration?: () => number
  getState?: () => string
  open: (url: string) => void
  pause: () => void
  play: () => void
  prepareAsync: (
    successCallback?: () => void,
    errorCallback?: (error?: unknown) => void,
  ) => void
  seekTo?: (
    milliseconds: number,
    successCallback?: () => void,
    errorCallback?: (error?: unknown) => void,
  ) => void
  setBufferingParam?: (option: string, unit: string, amount: number) => void
  setDisplayMethod?: (displayMethod: string) => void
  setDisplayRect: (
    x: number,
    y: number,
    width: number,
    height: number,
  ) => void
  setListener: (playbackCallback: AvPlayPlaybackCallback) => void
  setTimeoutForBuffering?: (seconds: number) => void
  stop: () => void
}

type ActivePlaybackSnapshot = {
  duration: number
  ended: boolean
  paused: boolean
  position: number
}

type AvPlayPlaybackSnapshot = ActivePlaybackSnapshot & {
  itemId: string | null
}

type TvDiagnosticDetail = Record<string, unknown>

type TvDiagnosticOptions = {
  immediate?: boolean
  includeDom?: boolean
}

type TvDiagnosticEvent = {
  appVersion: string
  at: string
  clientId: string
  detail: TvDiagnosticDetail
  dom: TvDiagnosticDetail
  env: TvDiagnosticDetail
  kind: string
  pageAgeMs: number
  player: TvDiagnosticDetail
  sequence: number
  sessionId: string
  ui: TvDiagnosticDetail
}

type MyHomeMediaServerWindow = Window & {
  HOME_MEDIA_CONFIG?: {
    apiBase?: string
    debug?: boolean
    preventSleepWhilePaused?: boolean
    tvDiagnostics?: boolean
    tvDebug?: boolean
  }
  HOME_MEDIA_SCAN_CACHE_STATS?: ScanPreviewCacheStats
  webapis?: {
    avplay?: AvPlayManager
    avinfo?: {
      getVersion?: () => string
      isHdrTvSupport?: () => boolean
    }
    productinfo?: {
      getFirmware?: () => string
      getModel?: () => string
      getModelCode?: () => string
      getRealModel?: () => string
      getVersion?: () => string
      is8KPanelSupported?: () => boolean
      isUHDAModel?: () => boolean
    }
    appcommon?: {
      AppCommonScreenSaverState?: {
        SCREEN_SAVER_OFF?: number | string
        SCREEN_SAVER_ON?: number | string
      }
      setScreenSaver?: (
        state: number | string,
        onSuccess?: () => void,
        onError?: (error: unknown) => void,
      ) => void
    }
  }
  tizen?: {
    application?: {
      getCurrentApplication?: () => {
        exit?: () => void
        hide?: () => void
      }
    }
    tvinputdevice?: {
      registerKey?: (key: string) => void
      registerKeyBatch?: (keys: string[]) => void
    }
    power?: {
      release?: (resource: string) => void
      request?: (resource: string, state: string) => void
    }
  }
}

const apiBaseStorageKey = 'my-home-media-server-api-base-v1'
const legacyApiBaseStorageKey = 'home-media-api-base-v1'
const preventSleepWhilePausedStorageKey =
  'my-home-media-server-tv-prevent-sleep-while-paused-v1'
const clientProfileRequestTimeoutMs = 5000
const libraryArtworkRowLoadRadius = 2
const libraryConnectionPollIntervalMs = 5000
const libraryConnectionPollTimeoutMs = 4500
const libraryRequestTimeoutMs = 15000
const maxRowItems = 28
const playerHudHideDelayMs = 3000
const playerLongPauseSurfaceRecoveryMs = 30 * 60 * 1000
const playerNativeStartupTimeoutMs = 12000
const playerQuickJumpLastDigit = 9
const playerQuickJumpRemoteKeys = [
  '0',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
]
const playerSeekStepSeconds = 5
const playerShortSeekPreviewHoldMs = 250
const playerShortSeekPreviewBackgroundClicks = 5
const playerShortSeekPreviewDirectionalClicks = 10
const scanHoldDelayMs = 320
const scanPreviewCommitBacktrackSeconds = 1
const scanPreviewHighFrameBucketSeconds = 1
const scanPreviewLowFrameBucketSeconds = 5
const scanPreviewBaseSecondsPerSecond = 5
const scanPreviewTickMs = 80
const scanPreviewPreloadLookaheadSeconds = 3
const scanPreviewPreloadMinimumFrames = 8
const scanPreviewPreloadMaximumFrames = 40
const scanPreviewClientCacheBudgetBytes = 30 * 1024 * 1024
const scanPreviewFallbackSheetBytes = 8 * 1024 * 1024
const scanPreviewFallbackSheetTransferBytes = 768 * 1024
const scanPreviewLoadFallbackMs = 1000
const scanPreviewLoadSafetyMultiplier = 2
const scanPreviewMaximumBufferedSheetsPerDirection = 12
const scanPreviewMinimumBufferedSheetsPerDirection = 1
const scanPreviewMinimumRetainedSheetsPerDirection = 2
const scanPreviewSpriteFramesPerSheet = 60
const scanSpeedMultipliers = [2, 4, 6, 8, 10] as const
const samsungMediaKeys = ['MediaPlayPause', 'MediaPlay', 'MediaPause']
const tvDiagnosticsFlushDelayMs = 1200
const tvDiagnosticsHeartbeatMs = 60_000
const tvDiagnosticsLocalPersistDelayMs = 5000
const tvDiagnosticsMaxBatchEvents = 6
const tvDiagnosticsMaxLocalEvents = 250
const tvDiagnosticsStorageKey = 'my-home-media-server-tv-diagnostics-v1'
const tvUiCompositorIdlePulseAfterMs = 2 * 60 * 1000
const tvUiCompositorIdlePulseIntervalMs = 60_000
const tvPlayerInputIdleRecoveryMs = 60_000
const tvUiStallRecoveryCooldownMs = 15_000
const tvUiStallRecoveryMs = 5_000
const tvNativePlaybackContainers = new Set([
  'ASF',
  'AVI',
  'DIVX',
  'FLV',
  'M2TS',
  'M4V',
  'MKV',
  'MOV',
  'MP4',
  'MPEG',
  'MPG',
  'MTS',
  'OGV',
  'TS',
  'VOB',
  'WEBM',
  'WMV',
])
const clientVideoProbeMimeTypes: ClientVideoProbe[] = [
  {
    label: 'MP4 H.264/AAC',
    mimeType: 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"',
    result: '',
  },
  {
    label: 'MP4 HEVC/AAC',
    mimeType: 'video/mp4; codecs="hvc1.1.6.L93.B0, mp4a.40.2"',
    result: '',
  },
  {
    label: 'WebM VP9/Opus',
    mimeType: 'video/webm; codecs="vp9, opus"',
    result: '',
  },
  {
    label: 'AVI container',
    mimeType: 'video/x-msvideo',
    result: '',
  },
  {
    label: 'AVI MPEG-4 ASP/MP3',
    mimeType: 'video/x-msvideo; codecs="mp4v.20.3, mp3"',
    result: '',
  },
  {
    label: 'Matroska H.264/AAC',
    mimeType: 'video/x-matroska; codecs="avc1.42E01E, mp4a.40.2"',
    result: '',
  },
]

async function fetchLibrary(apiBase: string, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl('/api/library', apiBase), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Library failed (${response.status})`)
  }

  return (await response.json()) as LibraryResponse
}

async function fetchServerConnection(apiBase: string, signal?: AbortSignal) {
  const response = await fetch(buildApiUrl('/api/client-profile', apiBase), {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Server connection failed (${response.status})`)
  }
}

function TvApp() {
  const [actionMenu, setActionMenu] = useState<ActionMenuState | null>(null)
  const [actionMenuIndex, setActionMenuIndex] = useState(0)
  const [apiBase] = useState(readInitialApiBase)
  const [tvDiagnosticsEnabled] = useState(readInitialTvDiagnosticsMode)
  const [tvDiagnosticsSessionId] = useState(createTvDiagnosticsSessionId)
  const [tvDebugMode] = useState(readInitialTvDebugMode)
  const [canLoadArtwork, setCanLoadArtwork] = useState(false)
  const [clientProfile] = useState(readClientDeviceProfile)
  const [detailState, setDetailState] = useState<DetailState | null>(null)
  const [error, setError] = useState<LibraryErrorState | null>(null)
  const [focus, setFocus] = useState<FocusPosition>({
    area: 'rows',
    itemIndex: 0,
    sectionIndex: 0,
  })
  const [isAppVisible, setIsAppVisible] = useState(() => !document.hidden)
  const [isLoading, setIsLoading] = useState(true)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [libraryConnectionPhase, setLibraryConnectionPhase] =
    useState<LibraryConnectionPhase>('loading')
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackHistory>(
    readLocalPlaybackHistory,
  )
  const [preventSleepWhilePaused, setPreventSleepWhilePaused] = useState(
    readInitialPreventSleepWhilePaused,
  )
  const [playerClock, setPlayerClock] = useState<PlayerClock>({
    duration: 0,
    position: 0,
  })
  const [playerBlackoutVisible, setPlayerBlackoutVisible] = useState(false)
  const [playerEpisodeSwitchTargetId, setPlayerEpisodeSwitchTargetId] =
    useState<string | null>(null)
  const [htmlPlayerShouldAutoPlay, setHtmlPlayerShouldAutoPlay] =
    useState(true)
  const [htmlPlayerSurfaceVersion, setHtmlPlayerSurfaceVersion] = useState(0)
  const [playerShellSurfaceVersion, setPlayerShellSurfaceVersion] = useState(0)
  const [playerHudVisible, setPlayerHudVisible] = useState(true)
  const [playerItem, setPlayerItem] = useState<MediaItem | null>(null)
  const [playerPlaybackPaused, setPlayerPlaybackPaused] = useState(true)
  const [playerStatus, setPlayerStatus] = useState<string | null>(null)
  const [playbackStrategyById, setPlaybackStrategyById] = useState<
    Record<string, PlaybackStrategy>
  >({})
  const [scanPreview, setScanPreview] = useState<ScanPreview | null>(null)
  const [scanPreviewVisibleVisual, setScanPreviewVisibleVisual] =
    useState<ScanPreviewVisual | null>(null)
  const [scanCacheStats, setScanCacheStats] =
    useState<ScanPreviewCacheStats | null>(null)
  const [shortSeekPreview, setShortSeekPreview] =
    useState<ShortSeekPreview | null>(null)
  const [shortSeekPreviewVisibleVisual, setShortSeekPreviewVisibleVisual] =
    useState<ScanPreviewVisual | null>(null)
  const [resumeRefreshKey, setResumeRefreshKey] = useState(0)
  const playbackHistoryRef = useRef(playbackHistory)
  const playbackActivityClientIdRef = useRef(readPlaybackActivityClientId())
  const playbackActivityCleanupStateRef =
    useRef<PlaybackActivityState>('closed')
  const recordTvDiagnosticRef = useRef<
    (
      kind: string,
      detail?: TvDiagnosticDetail,
      options?: TvDiagnosticOptions,
    ) => void
  >(() => undefined)
  const detailListRef = useRef<HTMLDivElement | null>(null)
  const detailSelectedItemRef = useRef<HTMLDivElement | null>(null)
  const lastPlaybackWriteRef = useRef<Record<string, number>>({})
  const pendingHtmlResumePositionRef = useRef(0)
  const pendingHtmlResumeShouldPlayRef = useRef(true)
  const avPlayPlaybackRef = useRef<AvPlayPlaybackSnapshot>({
    duration: 0,
    ended: false,
    itemId: null,
    paused: true,
    position: 0,
  })
  const avPlayProgressIntervalRef = useRef<number | null>(null)
  const playerHudTimeoutRef = useRef<number | null>(null)
  const playerScanCommitCleanupRef = useRef<(() => void) | null>(null)
  const playerScanHeldDirectionRef = useRef<ScanDirection | null>(null)
  const playerScanHoldTimeoutRef = useRef<number | null>(null)
  const playerScanImageBytesRef = useRef<Map<string, number>>(new Map())
  const playerScanIntervalRef = useRef<number | null>(null)
  const playerScanLastTickRef = useRef<number | null>(null)
  const playerStartupTimeoutRef = useRef<number | null>(null)
  const playerScanAmbientWarmKeyRef = useRef('')
  const playerScanFrameLoadTokenRef = useRef(0)
  const playerScanLoadedFrameUrlsRef = useRef<Set<string>>(new Set())
  const playerScanSheetBandwidthBytesPerSecondRef = useRef<number | null>(null)
  const playerScanSheetTransferBytesRef = useRef(
    scanPreviewFallbackSheetTransferBytes,
  )
  const playerScanVisualLoadMsRef = useRef(scanPreviewLoadFallbackMs)
  const playerScanPreloadImagesRef = useRef<Map<string, HTMLImageElement>>(
    new Map(),
  )
  const playerScanPreloadKeyRef = useRef('')
  const playerScanRetainedWindowRef =
    useRef<ScanPreviewRetainedWindow | null>(null)
  const playerScanPreviewRef = useRef<ScanPreview | null>(null)
  const playerScanVisualCacheRef = useRef<Map<string, ScanPreviewVisual>>(
    new Map(),
  )
  const playerScanVisualCacheGenerationRef = useRef(0)
  const playerScanVisualPromisesRef = useRef<
    Map<string, Promise<ScanPreviewVisual>>
  >(new Map())
  const playerScanWasPlayingRef = useRef(false)
  const playerPausedAtRef = useRef<number | null>(null)
  const playerPlaybackPausedRef = useRef(true)
  const playerShortSeekPreviewLoadTokenRef = useRef(0)
  const playerShortSeekPreviewTimeoutRef = useRef<number | null>(null)
  const playerShortSeekWarmKeyRef = useRef('')
  const playerShortSeekWarmRunIdRef = useRef(0)
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const rowsRef = useRef<HTMLElement | null>(null)
  const selectedCardRef = useRef<HTMLButtonElement | null>(null)
  const selectedRowRef = useRef<HTMLElement | null>(null)
  const tvDiagnosticsFlushTimeoutRef = useRef<number | null>(null)
  const tvDiagnosticsHeartbeatIntervalRef = useRef<number | null>(null)
  const tvDiagnosticsInFlightRef = useRef(false)
  const tvDiagnosticsLocalPersistTimeoutRef = useRef<number | null>(null)
  const tvDiagnosticsQueueRef = useRef<TvDiagnosticEvent[]>([])
  const tvDiagnosticsSequenceRef = useRef(0)
  const tvLastClockRenderAtRef = useRef(getCurrentTimestamp())
  const tvLastClockUpdateAtRef = useRef(getCurrentTimestamp())
  const tvLastDiagnosticsHeartbeatAtRef = useRef(getCurrentTimestamp())
  const tvLastPlayerInputAtRef = useRef(getCurrentTimestamp())
  const tvLastRenderAtRef = useRef(getCurrentTimestamp())
  const tvLastUiRecoveryAtRef = useRef(0)
  const tvUiRecoveryCountRef = useRef(0)
  const scanPreviewVisualRequest =
    playerItem && scanPreview
      ? getScanPreviewVisualRequest(playerItem, scanPreview, apiBase)
      : null
  const scanPreviewVisualRequestKey = scanPreviewVisualRequest?.key ?? ''
  const scanPreviewVisualRequestKind = scanPreviewVisualRequest?.kind ?? null
  const scanPreviewVisualRequestUrl = scanPreviewVisualRequest?.url ?? ''

  const markScanPreviewFrameReady = useCallback(
    (
      image: HTMLImageElement,
      url: string,
      onReady?: () => void,
    ) => {
      const markReady = () => {
        playerScanLoadedFrameUrlsRef.current.add(url)
        playerScanPreloadImagesRef.current.set(url, image)
        playerScanImageBytesRef.current.set(
          url,
          estimateDecodedImageBytes(image),
        )
        onReady?.()
      }

      if (typeof image.decode !== 'function') {
        markReady()
        return
      }

      void image.decode().then(markReady, markReady)
    },
    [],
  )

  const cacheScanPreviewVisual = useCallback(
    (request: ScanPreviewVisualRequest, visual: ScanPreviewVisual) => {
      playerScanVisualCacheRef.current.set(visual.key, visual)

      if (visual.kind !== 'sprite') {
        return
      }

      for (const expandedVisual of getExpandedScanPreviewSpriteVisuals(
        request,
        visual,
      )) {
        playerScanVisualCacheRef.current.set(expandedVisual.key, expandedVisual)
      }
    },
    [],
  )

  const loadCachedScanPreviewVisual = useCallback(
    (request: ScanPreviewVisualRequest): Promise<ScanPreviewVisual> => {
      const cachedVisual = playerScanVisualCacheRef.current.get(request.key)

      if (cachedVisual) {
        return Promise.resolve(cachedVisual)
      }

      const pendingVisual = playerScanVisualPromisesRef.current.get(request.key)

      if (pendingVisual) {
        return pendingVisual
      }

      const cacheGeneration = playerScanVisualCacheGenerationRef.current
      const startedAt = window.performance.now()
      const markReady = (
        image: HTMLImageElement,
        url: string,
        onReady?: () => void,
      ) => {
        if (
          playerScanVisualCacheGenerationRef.current !== cacheGeneration ||
          !isPreviewVisualInActiveRetainedWindow(
            request.key,
            playerScanRetainedWindowRef.current,
          )
        ) {
          onReady?.()
          return
        }

        markScanPreviewFrameReady(image, url, onReady)
      }
      const loadPromise = loadScanPreviewVisual(
        request,
        apiBase,
        markReady,
      )
        .then((visual) => {
          if (request.kind === 'sprite') {
            updateScanPreviewLoadMs(
              playerScanVisualLoadMsRef,
              window.performance.now() - startedAt,
            )
            updateScanPreviewBandwidthEstimate(
              playerScanSheetTransferBytesRef,
              playerScanSheetBandwidthBytesPerSecondRef,
              getScanPreviewResourceMetrics(request, visual, startedAt),
            )
          }

          if (
            playerScanVisualCacheGenerationRef.current === cacheGeneration &&
            isPreviewVisualInActiveRetainedWindow(
              visual.key,
              playerScanRetainedWindowRef.current,
            )
          ) {
            cacheScanPreviewVisual(request, visual)
          }

          return visual
        })
        .finally(() => {
          if (
            playerScanVisualPromisesRef.current.get(request.key) === loadPromise
          ) {
            playerScanVisualPromisesRef.current.delete(request.key)
          }
        })

      playerScanVisualPromisesRef.current.set(request.key, loadPromise)

      return loadPromise
    },
    [apiBase, cacheScanPreviewVisual, markScanPreviewFrameReady],
  )

  const prunePlaybackScanCache = useCallback(
    (item: MediaItem, currentSheetIndex: number, duration: number) => {
      const version = getMediaPreviewVersion(item)
      const retainedRadius = getScanPreviewRetainedSheetRadius(
        playerScanImageBytesRef.current,
        playerScanVisualLoadMsRef.current,
        playerScanSheetTransferBytesRef.current,
        playerScanSheetBandwidthBytesPerSecondRef.current,
      )
      const retainedWindow = {
        firstSheetIndex: Math.max(
          currentSheetIndex - retainedRadius,
          0,
        ),
        itemId: item.id,
        lastSheetIndex: Math.min(
          currentSheetIndex + retainedRadius,
          getScanPreviewSheetIndex(duration),
        ),
        version,
      }

      playerScanRetainedWindowRef.current = retainedWindow

      for (const key of playerScanVisualPromisesRef.current.keys()) {
        if (!isPreviewVisualInRetainedWindow(key, retainedWindow)) {
          playerScanVisualPromisesRef.current.delete(key)
        }
      }

      for (const key of playerScanVisualCacheRef.current.keys()) {
        if (!isPreviewVisualInRetainedWindow(key, retainedWindow)) {
          playerScanVisualCacheRef.current.delete(key)
        }
      }

      const retainedImageUrls = new Set<string>()

      for (const visual of playerScanVisualCacheRef.current.values()) {
        retainedImageUrls.add(getScanPreviewVisualImageUrl(visual))
      }

      for (const imageUrl of playerScanPreloadImagesRef.current.keys()) {
        if (!retainedImageUrls.has(imageUrl)) {
          playerScanPreloadImagesRef.current.delete(imageUrl)
          playerScanImageBytesRef.current.delete(imageUrl)
        }
      }
    },
    [],
  )

  const primePlaybackScanCache = useCallback(
    (item: MediaItem, position: number, duration: number) => {
      if (!duration) {
        return
      }

      const currentSheetIndex = getScanPreviewSheetIndex(position)
      const warmRadius = getScanPreviewWarmSheetRadius(
        playerScanImageBytesRef.current,
        playerScanVisualLoadMsRef.current,
        playerScanSheetTransferBytesRef.current,
        playerScanSheetBandwidthBytesPerSecondRef.current,
      )
      const retainedRadius = getScanPreviewRetainedSheetRadius(
        playerScanImageBytesRef.current,
        playerScanVisualLoadMsRef.current,
        playerScanSheetTransferBytesRef.current,
        playerScanSheetBandwidthBytesPerSecondRef.current,
      )
      const warmKey = [
        item.id,
        getMediaPreviewVersion(item),
        currentSheetIndex,
        warmRadius,
      ].join(':')

      prunePlaybackScanCache(item, currentSheetIndex, duration)
      setScanCacheStats(
        publishScanPreviewCacheStats(
          item,
          currentSheetIndex,
          warmRadius,
          retainedRadius,
          playerScanImageBytesRef.current,
          playerScanVisualLoadMsRef.current,
          playerScanSheetTransferBytesRef.current,
          playerScanSheetBandwidthBytesPerSecondRef.current,
        ),
      )

      if (playerScanAmbientWarmKeyRef.current === warmKey) {
        return
      }

      playerScanAmbientWarmKeyRef.current = warmKey

      const cacheGeneration = playerScanVisualCacheGenerationRef.current
      const currentPreview: ScanPreview = {
        direction: 1,
        position: clamp(position, 0, duration),
        scanning: true,
        speedIndex: 0,
      }
      const currentRequest = getScanPreviewVisualRequest(
        item,
        currentPreview,
        apiBase,
      )

      void loadCachedScanPreviewVisual(currentRequest)
        .catch(() => undefined)
        .then(() => {
          if (
            playerScanVisualCacheGenerationRef.current !== cacheGeneration ||
            playerScanAmbientWarmKeyRef.current !== warmKey
          ) {
            return
          }

          for (const sheetOffset of getScanPreviewWarmSheetOffsets(warmRadius)) {
            const sheetPosition = getScanPreviewSheetStartPosition(
              currentSheetIndex + sheetOffset,
            )

            if (sheetPosition < 0 || sheetPosition > duration) {
              continue
            }

            const preview: ScanPreview = {
              direction: sheetOffset > 0 ? 1 : -1,
              position: sheetPosition,
              scanning: true,
              speedIndex: 0,
            }

            void loadCachedScanPreviewVisual(
              getScanPreviewVisualRequest(item, preview, apiBase),
            ).catch(() => undefined)
          }
        })
    },
    [apiBase, loadCachedScanPreviewVisual, prunePlaybackScanCache],
  )

  useEffect(() => {
    playbackHistoryRef.current = playbackHistory
    writeLocalPlaybackHistory(playbackHistory)
  }, [playbackHistory])

  useEffect(() => {
    if (!isAppVisible) {
      return
    }

    const controller = new AbortController()
    const timeoutId = window.setTimeout(
      () => controller.abort(),
      clientProfileRequestTimeoutMs,
    )

    reportClientProfile(apiBase, clientProfile, controller.signal)
      .catch(() => undefined)
      .finally(() => window.clearTimeout(timeoutId))

    return () => {
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [apiBase, clientProfile, isAppVisible])

  useEffect(() => {
    if (!isAppVisible) {
      return
    }

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
  }, [apiBase, isAppVisible, resumeRefreshKey])

  useEffect(() => {
    const loadedFrameUrls = playerScanLoadedFrameUrlsRef.current
    const imageBytes = playerScanImageBytesRef.current
    const preloadImages = playerScanPreloadImagesRef.current
    const visualCache = playerScanVisualCacheRef.current
    const visualPromises = playerScanVisualPromisesRef.current

    return () => {
      if (playerHudTimeoutRef.current !== null) {
        window.clearTimeout(playerHudTimeoutRef.current)
      }

      if (playerScanHoldTimeoutRef.current !== null) {
        window.clearTimeout(playerScanHoldTimeoutRef.current)
      }

      if (playerShortSeekPreviewTimeoutRef.current !== null) {
        window.clearTimeout(playerShortSeekPreviewTimeoutRef.current)
      }

      if (playerStartupTimeoutRef.current !== null) {
        window.clearTimeout(playerStartupTimeoutRef.current)
      }

      if (playerScanIntervalRef.current !== null) {
        window.clearInterval(playerScanIntervalRef.current)
      }

      if (playerScanCommitCleanupRef.current) {
        playerScanCommitCleanupRef.current()
      }

      playerScanCommitCleanupRef.current = null
      playerScanHeldDirectionRef.current = null
      playerScanHoldTimeoutRef.current = null
      playerScanIntervalRef.current = null
      playerScanLastTickRef.current = null
      playerStartupTimeoutRef.current = null
      playerScanAmbientWarmKeyRef.current = ''
      playerScanFrameLoadTokenRef.current += 1
      playerScanVisualCacheGenerationRef.current += 1
      imageBytes.clear()
      loadedFrameUrls.clear()
      preloadImages.clear()
      playerScanPreloadKeyRef.current = ''
      playerScanRetainedWindowRef.current = null
      playerScanSheetTransferBytesRef.current = scanPreviewFallbackSheetTransferBytes
      visualCache.clear()
      visualPromises.clear()
      playerScanPreviewRef.current = null
      playerScanWasPlayingRef.current = false
      playerShortSeekPreviewLoadTokenRef.current += 1
      playerShortSeekPreviewTimeoutRef.current = null
      playerShortSeekWarmKeyRef.current = ''
      playerShortSeekWarmRunIdRef.current += 1
    }
  }, [])

  useEffect(() => {
    playerScanPreviewRef.current = scanPreview
  }, [scanPreview])

  useEffect(() => {
    if (!scanPreviewVisualRequestKind || !scanPreviewVisualRequestUrl) {
      playerScanFrameLoadTokenRef.current += 1
      return
    }

    const loadToken = playerScanFrameLoadTokenRef.current + 1
    const request: ScanPreviewVisualRequest = {
      key: scanPreviewVisualRequestKey,
      kind: scanPreviewVisualRequestKind,
      url: scanPreviewVisualRequestUrl,
    }
    let isCurrent = true

    playerScanFrameLoadTokenRef.current = loadToken

    loadCachedScanPreviewVisual(request)
      .then((visual) => {
        if (isCurrent && playerScanFrameLoadTokenRef.current === loadToken) {
          setScanPreviewVisibleVisual(visual)
        }
      })
      .catch(() => undefined)

    return () => {
      isCurrent = false
    }
  }, [
    apiBase,
    loadCachedScanPreviewVisual,
    scanPreviewVisualRequestKey,
    scanPreviewVisualRequestKind,
    scanPreviewVisualRequestUrl,
  ])

  useEffect(() => {
    if (!playerItem) {
      playerScanPreloadImagesRef.current.clear()
      playerScanPreloadKeyRef.current = ''
      playerScanRetainedWindowRef.current = null
      return
    }

    if (!scanPreview?.scanning) {
      playerScanPreloadKeyRef.current = ''
      return
    }

    const bucketSeconds = getScanPreviewFrameBucketSeconds(scanPreview)
    const framePosition = getScanPreviewFramePosition(
      scanPreview.position,
      bucketSeconds,
    )
    const preloadKey = [
      playerItem.id,
      scanPreview.direction,
      bucketSeconds,
      framePosition,
    ].join(':')

    if (playerScanPreloadKeyRef.current === preloadKey) {
      return
    }

    playerScanPreloadKeyRef.current = preloadKey
    const nextPreloadImages = new Map(playerScanPreloadImagesRef.current)

    for (const request of getScanPreviewPreloadVisualRequests(
      playerItem,
      scanPreview,
      apiBase,
      playerClock.duration,
    )) {
      const cachedVisual = playerScanVisualCacheRef.current.get(request.key)

      if (cachedVisual) {
        const imageUrl = getScanPreviewVisualImageUrl(cachedVisual)
        const existingImage = playerScanPreloadImagesRef.current.get(imageUrl)

        if (existingImage) {
          nextPreloadImages.set(imageUrl, existingImage)
        }

        continue
      }

      void loadCachedScanPreviewVisual(request).catch(() => undefined)
    }

    playerScanPreloadImagesRef.current = nextPreloadImages
  }, [
    apiBase,
    loadCachedScanPreviewVisual,
    playerClock.duration,
    playerItem,
    scanPreview,
  ])

  useEffect(() => {
    registerSamsungRemoteKeys()
  }, [])

  useEffect(() => {
    const idleWindow = window as Window & {
      cancelIdleCallback?: (handle: number) => void
      requestIdleCallback?: (
        callback: () => void,
        options?: { timeout: number },
      ) => number
    }

    if (idleWindow.requestIdleCallback) {
      const idleId = idleWindow.requestIdleCallback(
        () => setCanLoadArtwork(true),
        {
          timeout: 1400,
        },
      )

      return () => idleWindow.cancelIdleCallback?.(idleId)
    }

    const timeoutId = window.setTimeout(() => setCanLoadArtwork(true), 800)

    return () => window.clearTimeout(timeoutId)
  }, [])

  useEffect(() => {
    let isCurrent = true
    let pollTimeoutId: number | null = null
    let requestController: AbortController | null = null

    function clearConnectionPoll() {
      if (pollTimeoutId !== null) {
        window.clearTimeout(pollTimeoutId)
        pollTimeoutId = null
      }
    }

    function scheduleConnectionPoll(startedAt = window.performance.now()) {
      if (!isCurrent) {
        return
      }

      clearConnectionPoll()
      setLibraryConnectionPhase('polling')

      const elapsedMs = window.performance.now() - startedAt
      const retryDelayMs = Math.max(
        libraryConnectionPollIntervalMs - elapsedMs,
        0,
      )

      pollTimeoutId = window.setTimeout(() => {
        pollTimeoutId = null
        pollForServerConnection()
      }, retryDelayMs)
    }

    function pollForServerConnection() {
      const controller = new AbortController()
      const startedAt = window.performance.now()
      let didTimeOut = false
      let settled = false
      requestController = controller
      setLibraryConnectionPhase('polling')

      const timeoutId = window.setTimeout(() => {
        if (!isCurrent || settled) {
          return
        }

        didTimeOut = true
        settled = true
        controller.abort()
        scheduleConnectionPoll(startedAt)
      }, libraryConnectionPollTimeoutMs)

      fetchServerConnection(apiBase, controller.signal)
        .then(() => {
          if (!isCurrent || settled) {
            return
          }

          settled = true
          window.clearTimeout(timeoutId)
          loadLibrary()
        })
        .catch(() => {
          if (!isCurrent || settled) {
            return
          }

          settled = true
          window.clearTimeout(timeoutId)

          if (!controller.signal.aborted || didTimeOut) {
            scheduleConnectionPoll(startedAt)
          }
        })
        .finally(() => {
          window.clearTimeout(timeoutId)

          if (requestController === controller) {
            requestController = null
          }
        })
    }

    function loadLibrary() {
      const controller = new AbortController()
      let didTimeOut = false
      let settled = false
      requestController = controller
      setLibraryConnectionPhase('loading')

      const timeoutId = window.setTimeout(() => {
        if (!isCurrent || settled) {
          return
        }

        didTimeOut = true
        settled = true
        controller.abort()
        setError(getLibraryRequestTimeoutError(apiBase))
        setIsLoading(false)
        scheduleConnectionPoll()
      }, libraryRequestTimeoutMs)

      fetchLibrary(apiBase, controller.signal)
        .then((nextLibrary) => {
          if (!isCurrent || settled) {
            return
          }

          settled = true
          window.clearTimeout(timeoutId)
          clearConnectionPoll()
          setLibrary(nextLibrary)
          setLibraryConnectionPhase('idle')
          setError(null)
          setIsLoading(false)
        })
        .catch((requestError: unknown) => {
          if (
            !isCurrent ||
            settled ||
            (controller.signal.aborted && !didTimeOut)
          ) {
            return
          }

          settled = true
          window.clearTimeout(timeoutId)
          setError(
            didTimeOut
              ? getLibraryRequestTimeoutError(apiBase)
              : getLibraryRequestError(requestError, apiBase),
          )
          setIsLoading(false)

          if (isLibraryConnectionFailure(requestError, didTimeOut)) {
            scheduleConnectionPoll()
          } else {
            setLibraryConnectionPhase('idle')
          }
        })
        .finally(() => {
          window.clearTimeout(timeoutId)

          if (requestController === controller) {
            requestController = null
          }
        })
    }

    loadLibrary()

    return () => {
      isCurrent = false
      clearConnectionPoll()
      requestController?.abort()
    }
  }, [apiBase, resumeRefreshKey])

  const sections = useMemo(
    () => buildTvSections(library?.items ?? [], playbackHistory),
    [library?.items, playbackHistory],
  )
  const safeFocus = clampFocus(focus, sections)
  const activeSection =
    sections[safeFocus.sectionIndex] ?? sections[0] ?? null
  const selectedTitle =
    activeSection?.titles[safeFocus.itemIndex] ??
    activeSection?.titles[0] ??
    null
  const selectedItem = selectedTitle?.resumeItem ?? null
  const selectedPlayback = selectedItem
    ? playbackHistory[selectedItem.id] ?? null
    : null
  const libraryConnectionStatus = getLibraryConnectionStatus(
    libraryConnectionPhase,
    apiBase,
  )
  const selectedTitleIsContinue = activeSection?.id === 'continue'
  const detailTitle = detailState?.title ?? null
  const detailItemIndex = detailTitle
    ? clamp(
        detailState?.itemIndex ?? 0,
        0,
        Math.max(detailTitle.items.length - 1, 0),
      )
    : 0
  const detailFocusArea = detailState?.focusArea ?? 'episode'
  const detailItem = detailTitle?.items[detailItemIndex] ?? null
  const detailPlayback = detailItem ? playbackHistory[detailItem.id] ?? null : null
  const actionMenuEntries = actionMenu
    ? getActionMenuEntries(actionMenu)
    : []
  const safeActionMenuIndex = clamp(
    actionMenuIndex,
    0,
    Math.max(actionMenuEntries.length - 1, 0),
  )
  const playerEpisodeSwitchOptions = useMemo(
    () =>
      getPlayerEpisodeSwitchOptions(
        library?.items ?? [],
        playerItem,
        playerEpisodeSwitchTargetId,
      ),
    [library?.items, playerEpisodeSwitchTargetId, playerItem],
  )
  const hasPlayerEpisodeSwitchOptions = Boolean(
    playerEpisodeSwitchOptions.previous || playerEpisodeSwitchOptions.next,
  )
  const playerPlaybackStrategy = playerItem
    ? getPlaybackStrategy(playerItem, playbackStrategyById)
    : 'native'
  const playerEngine = playerItem
    ? getPlaybackEngine(playerItem, playerPlaybackStrategy)
    : 'html'
  const activePlayerItemId = playerItem?.id ?? null
  const shouldKeepTvPlayerAwake = Boolean(
    activePlayerItemId &&
      (!playerPlaybackPaused || preventSleepWhilePaused),
  )

  function recordTvDiagnostic(
    kind: string,
    detail: TvDiagnosticDetail = {},
    options: TvDiagnosticOptions = {},
  ) {
    if (!tvDiagnosticsEnabled) {
      return
    }

    try {
      const event = buildTvDiagnosticEvent(
        kind,
        detail,
        options.includeDom === true,
      )
      const queue = tvDiagnosticsQueueRef.current

      queue.push(event)

      if (queue.length > tvDiagnosticsMaxLocalEvents) {
        queue.splice(0, queue.length - tvDiagnosticsMaxLocalEvents)
      }

      scheduleLocalTvDiagnosticsPersist()
      scheduleTvDiagnosticsFlush(
        options.immediate ? 0 : tvDiagnosticsFlushDelayMs,
      )
    } catch {
      // Diagnostics must never interrupt playback or remote handling.
    }
  }

  function recordTvDiagnosticAfterPaint(
    kind: string,
    detail: TvDiagnosticDetail = {},
    options: TvDiagnosticOptions = {},
  ) {
    window.setTimeout(() => {
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          recordTvDiagnostic(kind, detail, options)
        })
        return
      }

      recordTvDiagnostic(kind, detail, options)
    }, 0)
  }

  function buildTvDiagnosticEvent(
    kind: string,
    detail: TvDiagnosticDetail,
    includeDom: boolean,
  ): TvDiagnosticEvent {
    const snapshot = readActivePlaybackSnapshot()
    const player = playerRef.current
    const avPlay = getAvPlay()
    const memoryStats = getBrowserMemoryStats()
    const sequence = tvDiagnosticsSequenceRef.current + 1

    tvDiagnosticsSequenceRef.current = sequence

    return {
      appVersion: __HOME_MEDIA_APP_VERSION__,
      at: new Date().toISOString(),
      clientId: playbackActivityClientIdRef.current,
      detail,
      dom: includeDom ? readTvDomDiagnostics() : { skipped: true },
      env: {
        apiBase,
        documentHidden: document.hidden,
        documentVisibility: document.visibilityState,
        hasFocus: document.hasFocus(),
        href: window.location.href,
        isAppVisible,
        memory: memoryStats,
        online: navigator.onLine,
        userAgent: navigator.userAgent,
      },
      kind,
      pageAgeMs: Math.round(window.performance.now()),
      player: {
        activeSnapshot: snapshot,
        avPlayState: safelyReadString(() => avPlay?.getState?.()),
        currentSrc: player?.currentSrc,
        htmlAutoPlay: htmlPlayerShouldAutoPlay,
        htmlNetworkState: player?.networkState,
        htmlReadyState: player?.readyState,
        htmlSurfaceVersion: htmlPlayerSurfaceVersion,
        item: playerItem
          ? {
              browserPlayable: playerItem.browserPlayable,
              container: playerItem.container,
              id: playerItem.id,
              title: getItemDisplayTitle(playerItem),
            }
          : null,
        pausedForMs:
          playerPausedAtRef.current === null
            ? null
            : Math.max(0, getCurrentTimestamp() - playerPausedAtRef.current),
        playbackStrategy: playerPlaybackStrategy,
        playerClock,
        playerEngine,
        playerShellSurfaceVersion,
        playerStatus,
      },
      sequence,
      sessionId: tvDiagnosticsSessionId,
      ui: {
        actionMenu: actionMenu?.kind ?? null,
        detailOpen: Boolean(detailTitle),
        htmlPlayerShouldAutoPlay,
        playerBlackoutVisible,
        playerHudVisible,
        scanPreview,
        scanPreviewVisibleVisualKind: scanPreviewVisibleVisual?.kind ?? null,
        shortSeekPreview,
        shortSeekPreviewVisibleVisualKind:
          shortSeekPreviewVisibleVisual?.kind ?? null,
      },
    }
  }

  function scheduleTvDiagnosticsFlush(delayMs: number) {
    try {
      if (delayMs <= 0) {
        flushTvDiagnosticsBeacon()
        return
      }

      if (tvDiagnosticsFlushTimeoutRef.current !== null) {
        window.clearTimeout(tvDiagnosticsFlushTimeoutRef.current)
      }

      tvDiagnosticsFlushTimeoutRef.current = window.setTimeout(() => {
        tvDiagnosticsFlushTimeoutRef.current = null
        void flushTvDiagnostics()
      }, delayMs)
    } catch {
      // Best-effort telemetry only.
    }
  }

  function scheduleLocalTvDiagnosticsPersist() {
    if (tvDiagnosticsLocalPersistTimeoutRef.current !== null) {
      return
    }

    try {
      tvDiagnosticsLocalPersistTimeoutRef.current = window.setTimeout(() => {
        tvDiagnosticsLocalPersistTimeoutRef.current = null
        persistLocalTvDiagnostics(tvDiagnosticsQueueRef.current)
      }, tvDiagnosticsLocalPersistDelayMs)
    } catch {
      // Local storage backup is optional.
    }
  }

  async function flushTvDiagnostics() {
    if (!tvDiagnosticsEnabled || tvDiagnosticsInFlightRef.current) {
      return
    }

    const events = tvDiagnosticsQueueRef.current.splice(
      0,
      tvDiagnosticsMaxBatchEvents,
    )

    if (!events.length) {
      return
    }

    tvDiagnosticsInFlightRef.current = true

    try {
      const response = await fetch(buildApiUrl('/api/tv-diagnostics', apiBase), {
        body: JSON.stringify({
          clientId: playbackActivityClientIdRef.current,
          events,
          sessionId: tvDiagnosticsSessionId,
        }),
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      })

      if (!response.ok) {
        throw new Error(`TV diagnostics failed (${response.status})`)
      }

      scheduleLocalTvDiagnosticsPersist()
    } catch {
      tvDiagnosticsQueueRef.current.unshift(...events)

      if (tvDiagnosticsQueueRef.current.length > tvDiagnosticsMaxLocalEvents) {
        tvDiagnosticsQueueRef.current.splice(
          0,
          tvDiagnosticsQueueRef.current.length - tvDiagnosticsMaxLocalEvents,
        )
      }

      scheduleLocalTvDiagnosticsPersist()
    } finally {
      tvDiagnosticsInFlightRef.current = false

      if (tvDiagnosticsQueueRef.current.length > 0) {
        scheduleTvDiagnosticsFlush(tvDiagnosticsFlushDelayMs)
      }
    }
  }

  function flushTvDiagnosticsBeacon() {
    if (!tvDiagnosticsEnabled || tvDiagnosticsQueueRef.current.length === 0) {
      return
    }

    try {
      const startIndex = Math.max(
        0,
        tvDiagnosticsQueueRef.current.length - tvDiagnosticsMaxBatchEvents,
      )
      const events = tvDiagnosticsQueueRef.current.splice(startIndex)
      const body = JSON.stringify({
        clientId: playbackActivityClientIdRef.current,
        events,
        sessionId: tvDiagnosticsSessionId,
      })

      const beaconQueued = navigator.sendBeacon
        ? navigator.sendBeacon(buildApiUrl('/api/tv-diagnostics', apiBase), body)
        : false

      if (!beaconQueued) {
        void fetch(buildApiUrl('/api/tv-diagnostics', apiBase), {
          body,
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
          },
          keepalive: true,
          method: 'POST',
        }).catch(() => undefined)
      }

      scheduleLocalTvDiagnosticsPersist()

      if (tvDiagnosticsQueueRef.current.length > 0) {
        scheduleTvDiagnosticsFlush(tvDiagnosticsFlushDelayMs)
      }
    } catch {
      // Pagehide telemetry is best-effort.
    }
  }

  useEffect(() => {
    recordTvDiagnosticRef.current = recordTvDiagnostic
  })

  useEffect(() => {
    tvLastRenderAtRef.current = getCurrentTimestamp()
  })

  useEffect(() => {
    tvLastClockRenderAtRef.current = getCurrentTimestamp()
  }, [playerClock.duration, playerClock.position])

  useEffect(() => {
    if (!tvDiagnosticsEnabled) {
      return
    }

    recordTvDiagnosticRef.current('app-start', {}, {
      immediate: true,
      includeDom: true,
    })

    tvDiagnosticsHeartbeatIntervalRef.current = window.setInterval(() => {
      tvLastDiagnosticsHeartbeatAtRef.current = getCurrentTimestamp()
      recordTvDiagnosticRef.current('heartbeat')
    }, tvDiagnosticsHeartbeatMs)

    const flushOnPageHide = () => {
      recordTvDiagnosticRef.current('pagehide', {}, { immediate: true })
      flushTvDiagnosticsBeacon()
    }

    window.addEventListener('pagehide', flushOnPageHide)
    window.addEventListener('beforeunload', flushOnPageHide)

    return () => {
      window.removeEventListener('pagehide', flushOnPageHide)
      window.removeEventListener('beforeunload', flushOnPageHide)

      if (tvDiagnosticsHeartbeatIntervalRef.current !== null) {
        window.clearInterval(tvDiagnosticsHeartbeatIntervalRef.current)
        tvDiagnosticsHeartbeatIntervalRef.current = null
      }

      if (tvDiagnosticsFlushTimeoutRef.current !== null) {
        window.clearTimeout(tvDiagnosticsFlushTimeoutRef.current)
        tvDiagnosticsFlushTimeoutRef.current = null
      }

      if (tvDiagnosticsLocalPersistTimeoutRef.current !== null) {
        window.clearTimeout(tvDiagnosticsLocalPersistTimeoutRef.current)
        tvDiagnosticsLocalPersistTimeoutRef.current = null
      }

      flushTvDiagnosticsBeacon()
    }
    // Diagnostics reads live refs and current render state through recordTvDiagnosticRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tvDiagnosticsEnabled])

  useEffect(() => {
    if (!activePlayerItemId) {
      recordTvDiagnosticRef.current(
        'tv-keep-awake-disable',
        setTvPlayerKeepAwake(false, {
          preventSleepWhilePaused,
          reason: 'player-closed',
        }),
      )
      return
    }

    recordTvDiagnosticRef.current(
      shouldKeepTvPlayerAwake ? 'tv-keep-awake-enable' : 'tv-keep-awake-disable',
      setTvPlayerKeepAwake(shouldKeepTvPlayerAwake, {
        playerPlaybackPaused,
        preventSleepWhilePaused,
        reason: shouldKeepTvPlayerAwake
          ? playerPlaybackPaused
            ? 'paused-setting-enabled'
            : 'playing'
          : 'paused-setting-disabled',
      }),
    )
  }, [
    activePlayerItemId,
    playerPlaybackPaused,
    preventSleepWhilePaused,
    shouldKeepTvPlayerAwake,
  ])

  useEffect(() => {
    if (!activePlayerItemId || !isAppVisible) {
      return
    }

    const intervalId = window.setInterval(() => {
      const playbackPaused = playerPlaybackPausedRef.current

      if (!playbackPaused) {
        return
      }

      const now = getCurrentTimestamp()
      const pausedForMs =
        playerPausedAtRef.current === null
          ? null
          : Math.max(0, now - playerPausedAtRef.current)
      const inputIdleMs = Math.max(0, now - tvLastPlayerInputAtRef.current)
      const shouldPulse =
        inputIdleMs >= tvUiCompositorIdlePulseAfterMs ||
        (pausedForMs !== null &&
          pausedForMs >= tvUiCompositorIdlePulseAfterMs)

      if (!shouldPulse) {
        return
      }

      const recoveryIndex = tvUiRecoveryCountRef.current + 1

      tvUiRecoveryCountRef.current = recoveryIndex
      pulseTvUiCompositor(recoveryIndex)
      recordTvDiagnosticRef.current('ui-idle-compositor-pulse', {
        inputIdleMs,
        pausedForMs,
        playbackPaused,
        recoveryIndex,
      })
    }, tvUiCompositorIdlePulseIntervalMs)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activePlayerItemId, isAppVisible])

  useEffect(() => {
    if (!activePlayerItemId) {
      return
    }

    const clientId = playbackActivityClientIdRef.current

    function sendOpenHeartbeat() {
      void reportPlaybackActivity(
        apiBase,
        clientId,
        activePlayerItemId,
        'open',
      ).catch(() => undefined)
    }

    function handlePageHide() {
      sendPlaybackActivityBeacon(
        apiBase,
        clientId,
        activePlayerItemId,
        'closed',
      )
    }

    playbackActivityCleanupStateRef.current = 'closed'
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
        activePlayerItemId,
        cleanupState,
      )
    }
  }, [activePlayerItemId, apiBase])

  useEffect(() => {
    if (safeFocus.area !== 'rows') {
      return
    }

    const selectedCard = selectedCardRef.current
    const row = selectedCard?.parentElement

    if (!selectedCard || !row) {
      return
    }

    row.scrollLeft = Math.max(
      selectedCard.offsetLeft - row.clientWidth / 2 + selectedCard.clientWidth / 2,
      0,
    )
  }, [safeFocus.area, safeFocus.itemIndex, safeFocus.sectionIndex])

  useEffect(() => {
    if (safeFocus.area !== 'rows') {
      return
    }

    const rows = rowsRef.current
    const selectedRow = selectedRowRef.current

    if (!rows || !selectedRow) {
      return
    }

    const rowBounds = selectedRow.getBoundingClientRect()
    const rowsBounds = rows.getBoundingClientRect()
    const padding = 14

    if (rowBounds.top < rowsBounds.top) {
      rows.scrollTop -= rowsBounds.top - rowBounds.top + padding
      return
    }

    if (rowBounds.bottom > rowsBounds.bottom) {
      rows.scrollTop += rowBounds.bottom - rowsBounds.bottom + padding
    }
  }, [safeFocus.area, safeFocus.sectionIndex])

  useEffect(() => {
    const list = detailListRef.current
    const selectedItemElement = detailSelectedItemRef.current

    if (!list || !selectedItemElement) {
      return
    }

    const itemBounds = selectedItemElement.getBoundingClientRect()
    const listBounds = list.getBoundingClientRect()
    const padding = 18

    if (itemBounds.top < listBounds.top) {
      list.scrollTop -= listBounds.top - itemBounds.top + padding
      return
    }

    if (itemBounds.bottom > listBounds.bottom) {
      list.scrollTop += itemBounds.bottom - listBounds.bottom + padding
    }
  }, [detailItemIndex, detailTitle?.id])

  function handleActionMenuAction(action: RemoteAction) {
    if (action === 'back') {
      closeActionMenu()
      return
    }

    if (action === 'enter' || action === 'play' || action === 'playPause') {
      const entry = actionMenuEntries[safeActionMenuIndex]

      if (actionMenu && entry && !entry.disabled) {
        applyActionMenuEntry(actionMenu, entry.id)
      }

      return
    }

    if (
      action === 'down' ||
      action === 'right' ||
      action === 'up' ||
      action === 'left'
    ) {
      moveActionMenuFocus(action === 'down' || action === 'right' ? 1 : -1)
    }
  }

  function handleBrowseAction(action: RemoteAction) {
    if (action === 'enter' || action === 'play' || action === 'playPause') {
      if (safeFocus.area === 'settings') {
        openSettingsMenu()
        return
      }

      activateTitle(activeSection, selectedTitle)
      return
    }

    if (action === 'left' || action === 'right') {
      if (safeFocus.area === 'rows' || safeFocus.area === 'hero') {
        moveFocus(
          0,
          action === 'right' ? 1 : -1,
          safeFocus.area === 'hero' ? 'hero' : 'rows',
        )
      }

      return
    }

    if (action === 'up') {
      if (safeFocus.area === 'rows') {
        setFocusArea('hero')
        return
      }

      if (safeFocus.area === 'hero') {
        setFocusArea('settings')
      }

      return
    }

    if (action === 'down') {
      if (safeFocus.area === 'settings') {
        setFocusArea('hero')
        return
      }

      if (safeFocus.area === 'hero') {
        setFocusArea('rows')
        return
      }

      moveFocus(1, 0)
    }
  }

  function handleDetailAction(action: RemoteAction) {
    if (action === 'back') {
      closeDetail()
      return
    }

    if (action === 'enter' || action === 'play' || action === 'playPause') {
      if (detailTitle && detailFocusArea === 'titleMenu') {
        openTitleActionMenu(detailTitle)
        return
      }

      if (detailTitle && detailFocusArea === 'episodeMenu') {
        openEpisodeActionMenu(detailTitle, detailItemIndex)
        return
      }

      startPlayback(detailItem)
      return
    }

    if (action === 'left') {
      if (detailFocusArea === 'episode') {
        setDetailFocusArea('episodeMenu')
      }

      return
    }

    if (action === 'right') {
      if (
        detailFocusArea === 'episodeMenu' ||
        detailFocusArea === 'titleMenu'
      ) {
        setDetailFocusArea('episode')
      }

      return
    }

    if (action === 'up') {
      if (detailItemIndex === 0) {
        setDetailFocusArea('titleMenu')
        return
      }

      moveDetailFocus(-1)
      return
    }

    if (action === 'down') {
      if (detailFocusArea === 'titleMenu') {
        setDetailFocusArea('episode')
        return
      }

      moveDetailFocus(1)
    }
  }

  function handlePlayerAction(action: RemoteAction, event: KeyboardEvent) {
    if (!event.repeat || (action !== 'left' && action !== 'right')) {
      recordTvDiagnostic('player-action', {
        action,
        key: event.key,
        keyCode: event.keyCode,
        repeat: event.repeat,
      })
    }

    if (recoverLongPausedPlayerSurface(action)) {
      return
    }

    if (action === 'down') {
      if (!playerScanPreviewRef.current) {
        showPlayerBlackout()
      }

      return
    }

    if (playerBlackoutVisible && !playerScanPreviewRef.current) {
      if (action === 'back') {
        hidePlayerBlackout()
        return
      }

      if (action === 'up') {
        hidePlayerBlackout()
        revealPlayerHud()
        return
      }

      if (
        hasPlayerEpisodeSwitchOptions &&
        (action === 'right' || action === 'left')
      ) {
        selectPlayerEpisodeSwitchTarget(action === 'right' ? 1 : -1)
        return
      }

      if (hasPlayerEpisodeSwitchOptions && action === 'enter') {
        if (commitPlayerEpisodeSwitchTarget()) {
          return
        }
      }
    }

    hidePlayerBlackout()

    if (action === 'back') {
      if (playerScanPreviewRef.current) {
        cancelScanPreview()
        return
      }

      closePlayer()
      return
    }

    if (action === 'play') {
      if (resumeScanPreview()) {
        return
      }

      cancelScanPreview()
      playPlayer()
      return
    }

    if (action === 'up') {
      revealPlayerHud()
      return
    }

    if (action === 'pause') {
      if (pauseScanPreview()) {
        return
      }

      pausePlayer()
      return
    }

    if (action === 'enter') {
      if (commitScanPreview()) {
        return
      }

      togglePlayer()
      return
    }

    if (action === 'playPause') {
      if (pauseScanPreview()) {
        return
      }

      togglePlayer()
      return
    }

    if (
      action === 'right' ||
      action === 'left'
    ) {
      handlePlayerScanKeyDown(action === 'right' ? 1 : -1, event.repeat)
    }
  }

  function moveFocus(
    sectionDelta: number,
    itemDelta: number,
    area: BrowseFocusArea = 'rows',
  ) {
    setFocus((currentFocus) => {
      const nextSectionIndex = clamp(
        currentFocus.sectionIndex + sectionDelta,
        0,
        Math.max(sections.length - 1, 0),
      )
      const rowLength = sections[nextSectionIndex]?.titles.length ?? 0
      const nextItemIndex = sectionDelta
        ? Math.min(currentFocus.itemIndex, Math.max(rowLength - 1, 0))
        : clamp(currentFocus.itemIndex + itemDelta, 0, Math.max(rowLength - 1, 0))

      return {
        area,
        itemIndex: nextItemIndex,
        sectionIndex: nextSectionIndex,
      }
    })
  }

  function setFocusArea(area: BrowseFocusArea) {
    setFocus((currentFocus) => ({
      ...currentFocus,
      area,
    }))
  }

  function activateTitle(section: TvSection | null, title: TvTitle | null) {
    if (!title) {
      return
    }

    if (section?.id === 'continue') {
      startPlayback(title.resumeItem)
      return
    }

    openDetail(title)
  }

  function openDetail(title: TvTitle) {
    setDetailState({
      focusArea: 'episode',
      itemIndex: getDefaultDetailItemIndex(title, playbackHistoryRef.current),
      title,
    })
  }

  function closeDetail() {
    closeActionMenu()
    setDetailState(null)
  }

  function setDetailFocusArea(focusArea: DetailState['focusArea']) {
    setDetailState((currentState) =>
      currentState
        ? {
            ...currentState,
            focusArea,
          }
        : currentState,
    )
  }

  function moveDetailFocus(delta: number) {
    setDetailState((currentState) => {
      if (!currentState) {
        return currentState
      }

      return {
        ...currentState,
        focusArea:
          currentState.focusArea === 'titleMenu'
            ? 'episode'
            : currentState.focusArea,
        itemIndex: clamp(
          currentState.itemIndex + delta,
          0,
          Math.max(currentState.title.items.length - 1, 0),
        ),
      }
    })
  }

  function openTitleActionMenu(title: TvTitle) {
    setActionMenu({
      kind: 'title',
      title,
    })
    setActionMenuIndex(0)
  }

  function openEpisodeActionMenu(title: TvTitle, itemIndex: number) {
    setActionMenu({
      itemIndex,
      kind: 'episode',
      title,
    })
    setActionMenuIndex(0)
  }

  function openSettingsMenu() {
    setActionMenu({
      kind: 'settings',
      preventSleepWhilePaused,
    })
    setActionMenuIndex(0)
  }

  function closeActionMenu() {
    setActionMenu(null)
    setActionMenuIndex(0)
  }

  function moveActionMenuFocus(delta: number) {
    setActionMenuIndex((currentIndex) =>
      clamp(currentIndex + delta, 0, Math.max(actionMenuEntries.length - 1, 0)),
    )
  }

  function applyActionMenuEntry(
    menu: ActionMenuState,
    entryId: ActionMenuEntry['id'],
  ) {
    if (menu.kind === 'settings') {
      if (entryId === 'toggle-prevent-sleep-while-paused') {
        setPreventSleepWhilePaused((currentValue) => {
          const nextValue = !currentValue

          writePreventSleepWhilePaused(nextValue)
          recordTvDiagnostic('tv-setting-change', {
            setting: 'preventSleepWhilePaused',
            value: nextValue,
          }, {
            immediate: true,
          })

          return nextValue
        })
      }

      closeActionMenu()
      return
    }

    if (entryId === 'mark-all-watched') {
      markItemsWatched(menu.title.items)
      closeActionMenu()
      return
    }

    if (entryId === 'mark-all-unwatched') {
      markItemsUnwatched(menu.title.items)
      closeActionMenu()
      return
    }

    const itemIndex = menu.kind === 'episode' ? menu.itemIndex : 0
    const selectedItem = menu.title.items[itemIndex]

    if (!selectedItem) {
      closeActionMenu()
      return
    }

    if (entryId === 'mark-watched') {
      markItemsWatched([selectedItem])
    } else if (entryId === 'mark-unwatched') {
      markItemsUnwatched([selectedItem])
    } else if (entryId === 'mark-previous-watched') {
      markItemsWatched(menu.title.items.slice(0, itemIndex))
    } else if (entryId === 'mark-previous-unwatched') {
      markItemsUnwatched(menu.title.items.slice(0, itemIndex))
    }

    closeActionMenu()
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

      return {
        item,
        record,
      }
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

  function renderActionMenu() {
    if (!actionMenu) {
      return null
    }

    return (
      <section className="tv-action-menu" aria-modal="true" role="dialog">
        <div className="tv-action-menu-panel">
          <p>{getActionMenuEyebrow(actionMenu)}</p>
          <h2>{getActionMenuTitle(actionMenu)}</h2>
          <div className="tv-action-menu-list">
            {actionMenuEntries.map((entry, entryIndex) => (
              <button
                className={
                  safeActionMenuIndex === entryIndex
                    ? 'tv-action-menu-item selected'
                    : 'tv-action-menu-item'
                }
                disabled={entry.disabled}
                key={entry.id}
                onClick={() => applyActionMenuEntry(actionMenu, entry.id)}
                type="button"
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>
      </section>
    )
  }

  function showPlayerBlackout() {
    if (playerBlackoutVisible && playerEpisodeSwitchTargetId === null) {
      return
    }

    recordTvDiagnostic('blackout-show-request')
    setPlayerBlackoutVisible(true)
    setPlayerEpisodeSwitchTargetId(null)
    showPlayerHud()
    recordTvDiagnosticAfterPaint('blackout-show-after-paint', {}, {
      includeDom: true,
      immediate: true,
    })
  }

  function hidePlayerBlackout() {
    if (!playerBlackoutVisible && playerEpisodeSwitchTargetId === null) {
      return
    }

    recordTvDiagnostic('blackout-hide-request')
    setPlayerBlackoutVisible(false)
    setPlayerEpisodeSwitchTargetId(null)
    recordTvDiagnosticAfterPaint('blackout-hide-after-paint')
  }

  function setPlayerPlaybackPausedDeferred(paused: boolean) {
    if (playerPlaybackPausedRef.current === paused) {
      return
    }

    playerPlaybackPausedRef.current = paused
    window.setTimeout(() => {
      setPlayerPlaybackPaused(paused)
    }, 0)
  }

  function markPlayerPaused(pausedAt = getCurrentTimestamp()) {
    setPlayerPlaybackPausedDeferred(true)

    if (playerPausedAtRef.current === null) {
      playerPausedAtRef.current = pausedAt
    }
  }

  function markPlayerActive() {
    setPlayerPlaybackPausedDeferred(false)
    playerPausedAtRef.current = null
  }

  function recoverLongPausedPlayerSurface(action: RemoteAction) {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot || !snapshot.paused || snapshot.ended) {
      return false
    }

    const pausedAt = playerPausedAtRef.current

    if (
      pausedAt === null ||
      getCurrentTimestamp() - pausedAt < playerLongPauseSurfaceRecoveryMs
    ) {
      return false
    }

    if (playerEngine === 'avplay') {
      const recoveryIndex = tvUiRecoveryCountRef.current + 1

      tvUiRecoveryCountRef.current = recoveryIndex
      recordTvDiagnostic('long-pause-recover-avplay', {
        action,
        recoveryIndex,
        snapshot,
      }, {
        includeDom: true,
        immediate: true,
      })
      refreshAvPlayPausedSurface(snapshot)
      pulseTvUiCompositor(recoveryIndex)
      recordTvDiagnosticAfterPaint('long-pause-recover-avplay-after-paint', {
        recoveryIndex,
      }, {
        includeDom: true,
        immediate: true,
      })
      return false
    }

    const shouldPlayAfterRefresh =
      action === 'enter' ||
      action === 'play' ||
      action === 'playPause'

    recordTvDiagnostic('long-pause-recover-html', {
      action,
      shouldPlayAfterRefresh,
      snapshot,
    }, {
      includeDom: true,
      immediate: true,
    })
    refreshHtmlPlayerSurface(snapshot, shouldPlayAfterRefresh)

    return shouldPlayAfterRefresh
  }

  function refreshHtmlPlayerSurface(
    snapshot: ActivePlaybackSnapshot,
    shouldPlayAfterRefresh: boolean,
  ) {
    pendingHtmlResumePositionRef.current = snapshot.position
    pendingHtmlResumeShouldPlayRef.current = shouldPlayAfterRefresh
    setHtmlPlayerShouldAutoPlay(shouldPlayAfterRefresh)
    setHtmlPlayerSurfaceVersion((currentVersion) => currentVersion + 1)
    setPlayerShellSurfaceVersion((currentVersion) => currentVersion + 1)
    playerPausedAtRef.current = shouldPlayAfterRefresh
      ? null
      : getCurrentTimestamp()
  }

  function refreshAvPlayPausedSurface(snapshot: ActivePlaybackSnapshot) {
    const avPlay = getAvPlay()

    if (!avPlay || playerEngine !== 'avplay') {
      return
    }

    try {
      setAvPlayDisplayRect(avPlay)
      setPlayerShellSurfaceVersion((currentVersion) => currentVersion + 1)
    } catch {
      return
    }

    if (!avPlay.seekTo || snapshot.position <= 0) {
      playerPausedAtRef.current = getCurrentTimestamp()
      return
    }

    try {
      avPlay.seekTo(Math.round(snapshot.position * 1000), () => {
        try {
          avPlay.pause()
        } catch {
          // The seek may leave AVPlay paused already.
        }
      })
      avPlayPlaybackRef.current = {
        ...avPlayPlaybackRef.current,
        paused: true,
        position: snapshot.position,
      }
      updatePlayerClockFromValues(snapshot.duration, snapshot.position)
    } catch {
      // A display-rect refresh still helps even when this AVPlay state rejects seek.
    }

    playerPausedAtRef.current = getCurrentTimestamp()
  }

  function refreshVisiblePlayerSurface() {
    if (playerEngine === 'avplay') {
      const avPlay = getAvPlay()

      if (avPlay) {
        try {
          setAvPlayDisplayRect(avPlay)
          recordTvDiagnostic('avplay-display-rect-refresh')
        } catch {
          // AVPlay may reject display updates while it is transitioning states.
          recordTvDiagnostic('avplay-display-rect-refresh-failed')
        }
      }
    }

    recoverLongPausedPlayerSurface('up')
  }

  function readTvUiFreshness() {
    const now = getCurrentTimestamp()

    return {
      clockRenderStaleMs: Math.max(0, now - tvLastClockRenderAtRef.current),
      clockUpdateStaleMs: Math.max(0, now - tvLastClockUpdateAtRef.current),
      diagnosticsHeartbeatStaleMs: tvDiagnosticsEnabled
        ? Math.max(0, now - tvLastDiagnosticsHeartbeatAtRef.current)
        : null,
      playerInputIdleMs: Math.max(0, now - tvLastPlayerInputAtRef.current),
      renderStaleMs: Math.max(0, now - tvLastRenderAtRef.current),
    }
  }

  function recoverStalledTvUi(trigger: TvUiRecoveryTrigger) {
    if (!playerItem) {
      return {
        recovered: false,
        ...readTvUiFreshness(),
      }
    }

    const freshness = readTvUiFreshness()
    const snapshotBefore = readActivePlaybackSnapshot()
    const isPlaying = Boolean(
      snapshotBefore && !snapshotBefore.paused && !snapshotBefore.ended,
    )
    const heartbeatStaleMs = freshness.diagnosticsHeartbeatStaleMs ?? 0
    const isInputIdle =
      freshness.playerInputIdleMs >= tvPlayerInputIdleRecoveryMs
    const isVisuallyStale =
      freshness.renderStaleMs >= tvUiStallRecoveryMs ||
      freshness.clockRenderStaleMs >= tvUiStallRecoveryMs ||
      heartbeatStaleMs >= tvUiStallRecoveryMs ||
      (isPlaying && freshness.clockUpdateStaleMs >= tvUiStallRecoveryMs)

    if (!isInputIdle && !isVisuallyStale) {
      return {
        recovered: false,
        ...freshness,
      }
    }

    const now = getCurrentTimestamp()
    const sinceLastRecoveryMs = now - tvLastUiRecoveryAtRef.current

    if (
      tvLastUiRecoveryAtRef.current > 0 &&
      sinceLastRecoveryMs < tvUiStallRecoveryCooldownMs
    ) {
      return {
        cooldown: true,
        recovered: false,
        sinceLastRecoveryMs,
        ...freshness,
      }
    }

    const recoveryIndex = tvUiRecoveryCountRef.current + 1
    const avPlay = playerEngine === 'avplay' ? getAvPlay() : null
    const avPlayState = safelyReadString(() => avPlay?.getState?.()) ?? null
    const liveDuration =
      playerEngine === 'avplay'
        ? getAvPlayDuration(avPlay) || snapshotBefore?.duration || 0
        : snapshotBefore?.duration ?? 0
    const livePosition =
      playerEngine === 'avplay'
        ? getAvPlayCurrentTime(avPlay)
        : snapshotBefore?.position ?? 0
    const clampedPosition = clamp(livePosition, 0, liveDuration || livePosition)
    const liveSnapshot = snapshotBefore
      ? {
          ...snapshotBefore,
          duration: liveDuration,
          paused:
            avPlayState === null ? snapshotBefore.paused : avPlayState !== 'PLAYING',
          position: clampedPosition,
        }
      : null

    tvLastUiRecoveryAtRef.current = now
    tvUiRecoveryCountRef.current = recoveryIndex

    recordTvDiagnostic('ui-stall-recover-request', {
      avPlayState,
      freshness,
      isInputIdle,
      isVisuallyStale,
      liveSnapshot,
      recoveryIndex,
      snapshotBefore,
      trigger,
    }, {
      immediate: true,
      includeDom: true,
    })

    if (playerEngine === 'avplay' && liveSnapshot) {
      avPlayPlaybackRef.current = {
        ...avPlayPlaybackRef.current,
        duration: liveSnapshot.duration,
        paused: liveSnapshot.paused,
        position: liveSnapshot.position,
      }
    }

    try {
      if (avPlay) {
        setAvPlayDisplayRect(avPlay)
      }
    } catch {
      // A stale UI recovery should continue even if AVPlay rejects display updates.
    }

    const applyRecoveryState = () => {
      if (liveSnapshot) {
        const recoveryRenderAt = getCurrentTimestamp()

        tvLastClockRenderAtRef.current = recoveryRenderAt
        tvLastClockUpdateAtRef.current = recoveryRenderAt
        setPlayerClock({
          duration: liveSnapshot.duration,
          position: liveSnapshot.position,
        })
      }

      setPlayerHudVisible(true)

      if (!playerScanPreviewRef.current) {
        setPlayerBlackoutVisible(false)
        setPlayerEpisodeSwitchTargetId(null)
      }

      setPlayerShellSurfaceVersion((currentVersion) => currentVersion + 1)
    }

    try {
      flushSync(applyRecoveryState)
    } catch {
      applyRecoveryState()
    }

    pulseTvUiCompositor(recoveryIndex)
    recordTvDiagnosticAfterPaint('ui-stall-recover-after-paint', {
      recoveryIndex,
    }, {
      immediate: true,
      includeDom: true,
    })

    return {
      isInputIdle,
      isVisuallyStale,
      recovered: true,
      recoveryIndex,
      ...freshness,
    }
  }

  function getAvPlay() {
    return (window as MyHomeMediaServerWindow).webapis?.avplay ?? null
  }

  function clearAvPlayProgressInterval() {
    if (avPlayProgressIntervalRef.current === null) {
      return
    }

    window.clearInterval(avPlayProgressIntervalRef.current)
    avPlayProgressIntervalRef.current = null
  }

  function startAvPlayProgressInterval(item: MediaItem) {
    if (avPlayProgressIntervalRef.current !== null) {
      return
    }

    avPlayProgressIntervalRef.current = window.setInterval(() => {
      updateAvPlayClockFromApi(item)
    }, 1000)
  }

  function stopAvPlayPlayback() {
    const avPlay = getAvPlay()

    clearAvPlayProgressInterval()
    markPlayerActive()

    if (avPlayPlaybackRef.current.itemId) {
      avPlayPlaybackRef.current = {
        duration: 0,
        ended: false,
        itemId: null,
        paused: true,
        position: 0,
      }
    }

    if (!avPlay) {
      return
    }

    try {
      avPlay.stop()
    } catch {
      // The player may already be stopped or not initialized.
    }

    try {
      avPlay.close()
    } catch {
      // Close can throw if AVPlay never reached IDLE.
    }
  }

  function startAvPlayPlayback(item: MediaItem) {
    const avPlay = getAvPlay()

    if (!avPlay) {
      fallbackPlayerToTranscode(item, 'AVPlay unavailable')
      return
    }

    stopAvPlayPlayback()
    clearPlayerStartupTimeout()

    avPlayPlaybackRef.current = {
      duration: 0,
      ended: false,
      itemId: item.id,
      paused: true,
      position: 0,
    }

    const playbackUrl = getPlaybackStreamUrl(item, apiBase, 'native')

    setPlayerStatus('AVPlay native direct play')

    const failAvPlay = (reason: string) => {
      if (avPlayPlaybackRef.current.itemId !== item.id) {
        return
      }

      fallbackPlayerToTranscode(item, reason)
    }

    try {
      avPlay.open(playbackUrl)
      avPlay.setListener({
        onbufferingcomplete: () => {
          if (avPlayPlaybackRef.current.itemId === item.id) {
            setPlayerStatus('AVPlay native direct play')
          }
        },
        onbufferingprogress: (percent) => {
          if (avPlayPlaybackRef.current.itemId === item.id && percent < 100) {
            setPlayerStatus(`AVPlay buffering ${Math.round(percent)}%`)
          }
        },
        onbufferingstart: () => {
          if (avPlayPlaybackRef.current.itemId === item.id) {
            setPlayerStatus('AVPlay buffering')
          }
        },
        oncurrentplaytime: (currentTimeMs) => {
          updateAvPlayClock(item, currentTimeMs / 1000)
        },
        onerror: () => failAvPlay('AVPlay failed'),
        onerrormsg: (_eventType, eventMessage) => {
          failAvPlay(eventMessage || 'AVPlay failed')
        },
        onstreamcompleted: () => {
          const snapshot = readActivePlaybackSnapshot()
          const duration = snapshot?.duration || avPlayPlaybackRef.current.duration

          clearPlayerStartupTimeout()
          recordPlaybackFromValues(item, duration, duration, true)
          stopAvPlayPlayback()
          clearScanPreview()
          clearPlayerHudTimeout()
          hidePlayerBlackout()
          setPlayerStatus(null)
          playbackActivityCleanupStateRef.current = 'ended'
          setPlayerItem(null)
        },
      })
      setAvPlayDisplayRect(avPlay)
      avPlay.setDisplayMethod?.('PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO')
      avPlay.setTimeoutForBuffering?.(10)
      avPlay.setBufferingParam?.(
        'PLAYER_BUFFER_FOR_PLAY',
        'PLAYER_BUFFER_SIZE_IN_SECOND',
        4,
      )
      armNativePlaybackFallback(item)
      avPlay.prepareAsync(
        () => finishAvPlayPrepare(item, avPlay),
        () => failAvPlay('AVPlay prepare failed'),
      )
    } catch (error) {
      failAvPlay(getErrorMessage(error))
    }
  }

  function finishAvPlayPrepare(item: MediaItem, avPlay: AvPlayManager) {
    if (avPlayPlaybackRef.current.itemId !== item.id) {
      return
    }

    const duration = getAvPlayDuration(avPlay)
    const resumePosition = getResumePosition(
      playbackHistoryRef.current[item.id] ?? null,
      duration,
    )

    avPlayPlaybackRef.current = {
      ...avPlayPlaybackRef.current,
      duration,
      position: resumePosition,
    }
    updatePlayerClockFromValues(duration, resumePosition)

    const playPrepared = () => {
      if (avPlayPlaybackRef.current.itemId !== item.id) {
        return
      }

      try {
        avPlay.play()
        avPlayPlaybackRef.current = {
          ...avPlayPlaybackRef.current,
          ended: false,
          paused: false,
        }
        markPlayerActive()
        setPlayerStatus('AVPlay native direct play')
        startAvPlayProgressInterval(item)
        showPlayerHud(true)
      } catch (error) {
        fallbackPlayerToTranscode(item, getErrorMessage(error))
      }
    }

    if (resumePosition > 0 && avPlay.seekTo) {
      try {
        avPlay.seekTo(Math.round(resumePosition * 1000), playPrepared, playPrepared)
      } catch {
        playPrepared()
      }
      return
    }

    playPrepared()
  }

  function updateAvPlayClockFromApi(item: MediaItem) {
    const avPlay = getAvPlay()

    if (!avPlay || avPlayPlaybackRef.current.itemId !== item.id) {
      return
    }

    updateAvPlayClock(item, getAvPlayCurrentTime(avPlay))
  }

  function updateAvPlayClock(item: MediaItem, position: number) {
    if (avPlayPlaybackRef.current.itemId !== item.id) {
      return
    }

    const duration = avPlayPlaybackRef.current.duration || getAvPlayDuration()
    const clampedPosition = clamp(position, 0, duration || position)

    if (clampedPosition > 0.25) {
      clearPlayerStartupTimeout()
    }

    avPlayPlaybackRef.current = {
      ...avPlayPlaybackRef.current,
      duration,
      position: clampedPosition,
    }
    updatePlayerClockFromValues(duration, clampedPosition)
    recordPlaybackFromValues(item, duration, clampedPosition)
  }

  function setAvPlayDisplayRect(avPlay: AvPlayManager) {
    const width = Math.round(window.innerWidth || 1920)
    const height = Math.round(window.innerHeight || 1080)

    avPlay.setDisplayRect(0, 0, width, height)
  }

  function clearPlayerStartupTimeout() {
    if (playerStartupTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(playerStartupTimeoutRef.current)
    playerStartupTimeoutRef.current = null
  }

  function hasNativePlaybackStarted(item: MediaItem) {
    if (getPlaybackEngine(item, 'native') === 'avplay') {
      return avPlayPlaybackRef.current.itemId === item.id
        ? avPlayPlaybackRef.current.position > 0.25
        : false
    }

    return playerRef.current ? hasPlayerStarted(playerRef.current) : false
  }

  function armNativePlaybackFallback(item: MediaItem) {
    const strategy = getPlaybackStrategy(item, playbackStrategyById)

    clearPlayerStartupTimeout()

    if (strategy !== 'native' || item.browserPlayable) {
      return
    }

    playerStartupTimeoutRef.current = window.setTimeout(() => {
      if (!playerItem || playerItem.id !== item.id) {
        return
      }

      if (hasNativePlaybackStarted(item)) {
        return
      }

      fallbackPlayerToTranscode(item, 'Native playback stalled')
    }, playerNativeStartupTimeoutMs)
  }

  function fallbackPlayerToTranscode(item: MediaItem, reason: string) {
    if (getPlaybackStrategy(item, playbackStrategyById) === 'transcode') {
      return
    }

    const resumePosition = readActivePlaybackSnapshot()?.position ?? 0

    clearPlayerStartupTimeout()
    stopAvPlayPlayback()
    pendingHtmlResumePositionRef.current = resumePosition
    pendingHtmlResumeShouldPlayRef.current = true
    setHtmlPlayerShouldAutoPlay(true)
    setPlayerStatus(`${reason}; switching to transcode`)
    setPlaybackStrategyById((currentStrategies) => ({
      ...currentStrategies,
      [item.id]: 'transcode',
    }))

    window.setTimeout(() => {
      const player = playerRef.current

      if (!player) {
        return
      }

      void player.play().catch(() => undefined)
    }, 0)
  }

  function startPlayback(item: MediaItem | null) {
    if (!item) {
      return
    }

    const strategy = getInitialPlaybackStrategy(item)

    clearScanPreview()
    clearScanPreviewImages()
    clearPlayerHudTimeout()
    clearPlayerStartupTimeout()
    pendingHtmlResumeShouldPlayRef.current = true
    tvLastPlayerInputAtRef.current = getCurrentTimestamp()
    setHtmlPlayerShouldAutoPlay(true)
    markPlayerActive()
    setPlayerClock({
      duration: 0,
      position: 0,
    })
    hidePlayerBlackout()
    setPlayerHudVisible(true)
    setPlayerStatus(getPlaybackStatusLabel(item, strategy))
    setPlaybackStrategyById((currentStrategies) => ({
      ...currentStrategies,
      [item.id]: strategy,
    }))
    playbackActivityCleanupStateRef.current = 'closed'
    setPlayerItem(item)
  }

  function closePlayer() {
    if (playerItem) {
      recordActivePlayback(playerItem, true)
      pauseActivePlayback()
    }

    playbackActivityCleanupStateRef.current = 'closed'
    stopAvPlayPlayback()
    clearScanPreview()
    clearScanPreviewImages()
    clearPlayerHudTimeout()
    clearPlayerStartupTimeout()
    hidePlayerBlackout()
    markPlayerActive()
    pendingHtmlResumeShouldPlayRef.current = true
    setHtmlPlayerShouldAutoPlay(true)
    setPlayerStatus(null)
    setPlayerItem(null)
  }

  function playPlayer() {
    recordTvDiagnostic('play-request', {}, { immediate: true })
    playActivePlayback()
    showPlayerHud(true)
  }

  function pausePlayer() {
    recordTvDiagnostic('pause-request', {}, { immediate: true })
    pauseActivePlayback()
    showPlayerHud(false)
  }

  function revealPlayerHud() {
    const snapshot = readActivePlaybackSnapshot()

    if (snapshot) {
      updatePlayerClockFromValues(snapshot.duration, snapshot.position)
    }

    showPlayerHud()
  }

  function togglePlayer() {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot) {
      return
    }

    if (snapshot.paused) {
      playActivePlayback()
      showPlayerHud(true)
    } else {
      pauseActivePlayback()
      showPlayerHud(false)
    }
  }

  function selectPlayerEpisodeSwitchTarget(direction: ScanDirection) {
    const target =
      direction > 0
        ? playerEpisodeSwitchOptions.next
        : playerEpisodeSwitchOptions.previous

    if (!target) {
      return
    }

    setPlayerEpisodeSwitchTargetId(target.id)
    showPlayerHud()
  }

  function commitPlayerEpisodeSwitchTarget() {
    const target = playerEpisodeSwitchOptions.target

    if (!target) {
      return false
    }

    if (playerItem) {
      recordActivePlayback(playerItem, true)
      pauseActivePlayback()
    }

    startPlayback(target)
    return true
  }

  function handlePlayerScanKeyDown(
    direction: ScanDirection,
    isRepeat: boolean,
  ) {
    const isHeldRepeat =
      isRepeat || playerScanHeldDirectionRef.current === direction

    if (isHeldRepeat) {
      if (
        playerScanHeldDirectionRef.current === direction &&
        !playerScanPreviewRef.current
      ) {
        primePendingScanPreview(direction)
        beginScanPreview(direction, false)
      }

      return
    }

    playerScanHeldDirectionRef.current = direction
    primePendingScanPreview(direction)

    if (playerScanPreviewRef.current) {
      beginScanPreview(direction, true)
      return
    }

    clearScanHoldTimeout()
    playerScanHoldTimeoutRef.current = window.setTimeout(() => {
      playerScanHoldTimeoutRef.current = null
      beginScanPreview(direction, false)
    }, scanHoldDelayMs)
  }

  function handlePlayerScanKeyUp(direction: ScanDirection) {
    if (playerScanHeldDirectionRef.current !== direction) {
      return
    }

    playerScanHeldDirectionRef.current = null

    if (playerScanHoldTimeoutRef.current !== null) {
      clearScanHoldTimeout()

      if (!playerScanPreviewRef.current) {
        skipPlayer(direction * playerSeekStepSeconds)
      }

      return
    }
  }

  function beginScanPreview(
    direction: ScanDirection,
    advanceStage: boolean,
  ) {
    recordTvDiagnostic('scan-begin-request', {
      advanceStage,
      direction,
    })

    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot) {
      return
    }

    const duration = snapshot.duration

    if (!duration) {
      skipPlayer(direction * playerSeekStepSeconds)
      return
    }

    clearScanHoldTimeout()
    clearShortSeekPreview()

    const currentPreview = playerScanPreviewRef.current

    if (!currentPreview) {
      playerScanWasPlayingRef.current = !snapshot.paused && !snapshot.ended
      pauseActivePlayback()
    }

    const clampedPreview = currentPreview
      ? {
          ...currentPreview,
          position: clamp(currentPreview.position, 0, duration),
        }
      : null
    const nextPreview =
      clampedPreview && advanceStage
        ? getSteppedScanPreview(clampedPreview, direction)
        : {
            direction,
            position: clampedPreview?.position ?? snapshot.position,
            scanning: true,
            speedIndex: clampedPreview?.speedIndex ?? 0,
          }

    setScanPreviewState(nextPreview)
    showCachedScanPreviewVisual(nextPreview)
    primeScanPreviewVisuals(nextPreview, duration)

    if (nextPreview.scanning) {
      playerScanLastTickRef.current = window.performance.now()
      startScanPreviewTicker()
    } else {
      stopScanPreviewTicker()
    }

    showPlayerHud()
    recordTvDiagnosticAfterPaint('scan-begin-after-paint', {
      nextPreview,
    })
  }

  function commitScanPreview() {
    const snapshot = readActivePlaybackSnapshot()
    const preview = playerScanPreviewRef.current

    if (!snapshot || !preview) {
      return false
    }

    recordTvDiagnostic('scan-commit-request', {
      preview,
      snapshot,
    }, {
      immediate: true,
    })

    const duration = snapshot.duration
    const nextPosition = getScanPreviewCommitPosition(preview, duration)
    const shouldResumePlayback = playerScanWasPlayingRef.current && !snapshot.ended

    seekActivePlayback(nextPosition)
    updatePlayerClockFromValues(duration, nextPosition)

    if (!shouldResumePlayback) {
      stopScanPreviewTicker()
      setScanPreviewState({
        ...preview,
        position: nextPosition,
        scanning: false,
      })
      finishScanPreviewCommitAfterSeek()
      showPlayerHud()
      return true
    }

    clearScanPreview()

    playActivePlayback()
    showPlayerHud(true)

    return true
  }

  function pauseScanPreview() {
    const preview = playerScanPreviewRef.current

    if (!preview) {
      return false
    }

    recordTvDiagnostic('scan-pause-request', { preview })

    playerScanWasPlayingRef.current = false
    setScanPreviewState({
      ...preview,
      scanning: false,
    })
    stopScanPreviewTicker()
    showPlayerHud()

    return true
  }

  function resumeScanPreview() {
    const preview = playerScanPreviewRef.current

    if (!preview) {
      return false
    }

    recordTvDiagnostic('scan-resume-request', { preview })

    if (!preview.scanning) {
      setScanPreviewState({
        ...preview,
        scanning: true,
      })
      playerScanLastTickRef.current = window.performance.now()
      startScanPreviewTicker()
    }

    showPlayerHud()

    return true
  }

  function cancelScanPreview() {
    if (!playerScanPreviewRef.current && playerScanHoldTimeoutRef.current === null) {
      return
    }

    recordTvDiagnostic('scan-cancel-request', {
      preview: playerScanPreviewRef.current,
    }, {
      immediate: true,
    })
    clearScanPreview()
    showPlayerHud()
  }

  function clearScanPreview(resetState = true) {
    clearScanHoldTimeout()
    clearScanCommitWait()
    stopScanPreviewTicker()
    playerScanHeldDirectionRef.current = null
    playerScanWasPlayingRef.current = false

    if (resetState) {
      setScanPreviewState(null)
    } else {
      playerScanPreviewRef.current = null
    }
  }

  function clearScanPreviewImages() {
    playerScanFrameLoadTokenRef.current += 1
    playerScanVisualCacheGenerationRef.current += 1
    playerScanAmbientWarmKeyRef.current = ''
    playerScanImageBytesRef.current.clear()
    playerScanLoadedFrameUrlsRef.current.clear()
    playerScanPreloadImagesRef.current.clear()
    playerScanPreloadKeyRef.current = ''
    playerScanRetainedWindowRef.current = null
    playerScanSheetTransferBytesRef.current = scanPreviewFallbackSheetTransferBytes
    playerScanVisualCacheRef.current.clear()
    playerScanVisualPromisesRef.current.clear()
    clearShortSeekPreview()
    playerShortSeekWarmKeyRef.current = ''
    playerShortSeekWarmRunIdRef.current += 1
    setScanCacheStats(null)
    setScanPreviewVisibleVisual(null)
  }

  function clearShortSeekPreview() {
    if (playerShortSeekPreviewTimeoutRef.current !== null) {
      window.clearTimeout(playerShortSeekPreviewTimeoutRef.current)
      playerShortSeekPreviewTimeoutRef.current = null
    }

    playerShortSeekPreviewLoadTokenRef.current += 1
    playerShortSeekWarmRunIdRef.current += 1
    setShortSeekPreview(null)
    setShortSeekPreviewVisibleVisual(null)
  }

  function showShortSeekPreview(position: number, duration: number) {
    if (!playerItem || !duration || playerScanPreviewRef.current) {
      return
    }

    if (playerShortSeekPreviewTimeoutRef.current !== null) {
      window.clearTimeout(playerShortSeekPreviewTimeoutRef.current)
    }

    const preview = {
      position: clamp(position, 0, duration),
    }
    const request = getShortSeekPreviewVisualRequest(
      playerItem,
      preview.position,
      apiBase,
    )
    const cachedVisual = playerScanVisualCacheRef.current.get(request.key)
    const loadToken = playerShortSeekPreviewLoadTokenRef.current + 1

    playerShortSeekPreviewLoadTokenRef.current = loadToken
    setShortSeekPreview(preview)

    if (cachedVisual) {
      setShortSeekPreviewVisibleVisual(cachedVisual)
    } else {
      void loadCachedScanPreviewVisual(request)
        .then((visual) => {
          if (playerShortSeekPreviewLoadTokenRef.current === loadToken) {
            setShortSeekPreviewVisibleVisual(visual)
          }
        })
        .catch(() => undefined)
    }

    playerShortSeekPreviewTimeoutRef.current = window.setTimeout(() => {
      if (playerShortSeekPreviewLoadTokenRef.current === loadToken) {
        setShortSeekPreview(null)
        setShortSeekPreviewVisibleVisual(null)
      }

      playerShortSeekPreviewTimeoutRef.current = null
    }, playerShortSeekPreviewHoldMs)
  }

  function primeShortSeekPreviewCache(
    item: MediaItem,
    position: number,
    duration: number,
    direction?: ScanDirection,
  ) {
    if (!duration) {
      return
    }

    const version = getMediaPreviewVersion(item)
    const stepIndex = Math.round(position / playerSeekStepSeconds)
    const warmKey = [
      item.id,
      version,
      stepIndex,
      direction ?? 0,
    ].join(':')

    if (playerShortSeekWarmKeyRef.current === warmKey) {
      return
    }

    playerShortSeekWarmKeyRef.current = warmKey
    const warmRunId = playerShortSeekWarmRunIdRef.current + 1

    playerShortSeekWarmRunIdRef.current = warmRunId
    void warmShortSeekPreviewRequests(
      getShortSeekPreviewVisualRequests(
        item,
        position,
        duration,
        apiBase,
        direction,
      ),
      warmRunId,
    )
  }

  async function warmShortSeekPreviewRequests(
    requests: ScanPreviewVisualRequest[],
    warmRunId: number,
  ) {
    for (const request of requests) {
      if (playerShortSeekWarmRunIdRef.current !== warmRunId) {
        return
      }

      try {
        await loadCachedScanPreviewVisual(request)
      } catch {
        // Keep warming later targets even if one preview is unavailable.
      }
    }
  }
  function showCachedScanPreviewVisual(preview: ScanPreview) {
    if (!playerItem) {
      return
    }

    const request = getScanPreviewVisualRequest(playerItem, preview, apiBase)
    const cachedVisual = playerScanVisualCacheRef.current.get(request.key)

    if (cachedVisual) {
      setScanPreviewVisibleVisual(cachedVisual)
    }
  }

  function primePendingScanPreview(direction: ScanDirection) {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot || !playerItem) {
      return
    }

    const duration = snapshot.duration

    if (!duration) {
      return
    }

    const currentPreview = playerScanPreviewRef.current
    const preview: ScanPreview = {
      direction,
      position: currentPreview
        ? clamp(currentPreview.position, 0, duration)
        : snapshot.position,
      scanning: true,
      speedIndex: currentPreview?.speedIndex ?? 0,
    }

    primeScanPreviewVisuals(preview, duration, false)
  }

  function primeScanPreviewVisuals(
    preview: ScanPreview,
    duration: number,
    includeLookahead = true,
  ) {
    if (!playerItem) {
      return
    }

    prunePlaybackScanCache(
      playerItem,
      getScanPreviewSheetIndex(preview.position),
      duration,
    )

    const requests = [
      getScanPreviewVisualRequest(playerItem, preview, apiBase),
    ]

    if (includeLookahead) {
      requests.push(
        ...getScanPreviewPreloadVisualRequests(
          playerItem,
          preview,
          apiBase,
          duration,
        ),
      )
    }

    const requestKeys = new Set<string>()

    for (const request of requests) {
      if (requestKeys.has(request.key)) {
        continue
      }

      requestKeys.add(request.key)
      void loadCachedScanPreviewVisual(request).catch(() => undefined)
    }
  }

  function clearScanHoldTimeout() {
    if (playerScanHoldTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(playerScanHoldTimeoutRef.current)
    playerScanHoldTimeoutRef.current = null
  }

  function clearScanCommitWait() {
    if (!playerScanCommitCleanupRef.current) {
      return
    }

    playerScanCommitCleanupRef.current()
    playerScanCommitCleanupRef.current = null
  }

  function finishScanPreviewCommitAfterSeek() {
    clearScanCommitWait()

    let isDone = false
    const finishCommit = () => {
      if (isDone) {
        return
      }

      isDone = true
      clearScanCommitWait()
      clearScanPreview()
      showPlayerHud()
    }
    const timeoutId = window.setTimeout(finishCommit, 1200)
    const player = playerRef.current

    player?.addEventListener('seeked', finishCommit)
    playerScanCommitCleanupRef.current = () => {
      window.clearTimeout(timeoutId)
      player?.removeEventListener('seeked', finishCommit)
    }
  }

  function startScanPreviewTicker() {
    if (playerScanIntervalRef.current !== null) {
      return
    }

    playerScanIntervalRef.current = window.setInterval(
      updateScanPreviewPosition,
      scanPreviewTickMs,
    )
  }

  function stopScanPreviewTicker() {
    if (playerScanIntervalRef.current === null) {
      return
    }

    window.clearInterval(playerScanIntervalRef.current)
    playerScanIntervalRef.current = null
    playerScanLastTickRef.current = null
  }

  function updateScanPreviewPosition() {
    const snapshot = readActivePlaybackSnapshot()
    const preview = playerScanPreviewRef.current

    if (!snapshot || !preview?.scanning) {
      return
    }

    const duration = snapshot.duration

    if (!duration) {
      stopScanPreviewTicker()
      return
    }

    const now = window.performance.now()
    const previousTick = playerScanLastTickRef.current ?? now
    const elapsedSeconds = (now - previousTick) / 1000
    const speed =
      scanSpeedMultipliers[preview.speedIndex] *
      scanPreviewBaseSecondsPerSecond
    const nextPosition = clamp(
      preview.position + preview.direction * speed * elapsedSeconds,
      0,
      duration,
    )
    const reachedBoundary = nextPosition === 0 || nextPosition === duration

    playerScanLastTickRef.current = now
    const nextPreview = {
      ...preview,
      position: nextPosition,
      scanning: !reachedBoundary,
    }

    setScanPreviewState(nextPreview)
    showCachedScanPreviewVisual(nextPreview)

    if (reachedBoundary) {
      stopScanPreviewTicker()
    }
  }

  function setScanPreviewState(nextPreview: ScanPreview | null) {
    playerScanPreviewRef.current = nextPreview
    setScanPreview(nextPreview)
  }

  function skipPlayer(seconds: number) {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot) {
      return
    }

    const duration = snapshot.duration
    const currentPosition = snapshot.position
    const nextPosition = clamp(
      currentPosition + seconds,
      0,
      duration || currentPosition,
    )

    seekActivePlayback(nextPosition)
    updatePlayerClockFromValues(
      duration,
      nextPosition,
      seconds >= 0 ? 1 : -1,
    )
    showShortSeekPreview(nextPosition, duration)
    showPlayerHud(!snapshot.paused && !snapshot.ended)
  }

  function jumpPlayerToQuickPosition(digit: QuickJumpDigit) {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot || !snapshot.duration) {
      return
    }

    const duration = snapshot.duration
    const nextPosition = getQuickJumpPosition(digit, duration)
    const seekDirection = nextPosition >= snapshot.position ? 1 : -1

    cancelScanPreview()
    seekActivePlayback(nextPosition)
    updatePlayerClockFromValues(duration, nextPosition, seekDirection)
    showShortSeekPreview(nextPosition, duration)
    showPlayerHud(!snapshot.paused && !snapshot.ended)
  }

  function readActivePlaybackSnapshot(): ActivePlaybackSnapshot | null {
    if (playerEngine === 'avplay' && avPlayPlaybackRef.current.itemId) {
      return avPlayPlaybackRef.current
    }

    const player = playerRef.current

    if (!player) {
      return null
    }

    return {
      duration: getFiniteVideoDuration(player),
      ended: player.ended,
      paused: player.paused,
      position: Number.isFinite(player.currentTime) ? player.currentTime : 0,
    }
  }

  function playActivePlayback() {
    if (playerEngine === 'avplay') {
      const avPlay = getAvPlay()

      if (!avPlay || !playerItem) {
        return
      }

      try {
        avPlay.play()
        avPlayPlaybackRef.current = {
          ...avPlayPlaybackRef.current,
          ended: false,
          paused: false,
        }
        markPlayerActive()
        startAvPlayProgressInterval(playerItem)
      } catch (error) {
        fallbackPlayerToTranscode(playerItem, getErrorMessage(error))
      }
      return
    }

    setHtmlPlayerShouldAutoPlay(true)
    pendingHtmlResumeShouldPlayRef.current = true
    void playerRef.current?.play()
    recordTvDiagnosticAfterPaint('html-play-after-paint')
  }

  function pauseActivePlayback() {
    if (playerEngine === 'avplay') {
      const avPlay = getAvPlay()

      if (!avPlay) {
        return
      }

      try {
        avPlay.pause()
        avPlayPlaybackRef.current = {
          ...avPlayPlaybackRef.current,
          paused: true,
        }
        markPlayerPaused()
      } catch {
        // Pause can fail if AVPlay is still preparing.
      }
      return
    }

    const player = playerRef.current

    if (!player) {
      return
    }

    player.pause()
    markPlayerPaused()
    setHtmlPlayerShouldAutoPlay(false)
    pendingHtmlResumeShouldPlayRef.current = false
    recordTvDiagnosticAfterPaint('html-pause-after-paint')
  }

  function seekActivePlayback(position: number) {
    if (playerEngine === 'avplay') {
      const avPlay = getAvPlay()
      const item = playerItem

      if (!avPlay || !item) {
        return
      }

      const duration = avPlayPlaybackRef.current.duration
      const clampedPosition = clamp(position, 0, duration || position)

      avPlayPlaybackRef.current = {
        ...avPlayPlaybackRef.current,
        position: clampedPosition,
      }

      try {
        avPlay.seekTo?.(Math.round(clampedPosition * 1000))
      } catch (error) {
        fallbackPlayerToTranscode(item, getErrorMessage(error))
      }
      return
    }

    const player = playerRef.current

    if (!player) {
      return
    }

    player.currentTime = position
  }

  function recordActivePlayback(item: MediaItem, force = false) {
    const snapshot = readActivePlaybackSnapshot()

    if (!snapshot) {
      return
    }

    recordPlaybackFromValues(
      item,
      snapshot.duration,
      snapshot.position,
      force,
    )
  }

  function getAvPlayDuration(avPlay = getAvPlay()) {
    try {
      const durationMs = avPlay?.getDuration?.() ?? 0

      return Number.isFinite(durationMs) ? durationMs / 1000 : 0
    } catch {
      return 0
    }
  }

  function getAvPlayCurrentTime(avPlay = getAvPlay()) {
    try {
      const currentTimeMs = avPlay?.getCurrentTime?.() ?? 0

      return Number.isFinite(currentTimeMs) ? currentTimeMs / 1000 : 0
    } catch {
      return avPlayPlaybackRef.current.position
    }
  }

  function handleLoadedMetadata(
    item: MediaItem,
    event: SyntheticEvent<HTMLVideoElement>,
  ) {
    const video = event.currentTarget
    const pendingResumePosition = pendingHtmlResumePositionRef.current
    const shouldResumePlayback = pendingHtmlResumeShouldPlayRef.current
    const resumePosition = getResumePosition(
      playbackHistoryRef.current[item.id] ?? null,
      video.duration,
    )
    const targetResumePosition =
      pendingResumePosition > 0
        ? clamp(pendingResumePosition, 0, getFiniteVideoDuration(video))
        : resumePosition

    pendingHtmlResumePositionRef.current = 0
    pendingHtmlResumeShouldPlayRef.current = true

    if (targetResumePosition > 0) {
      video.currentTime = targetResumePosition
    }

    updatePlayerClock(video)
    showPlayerHud()

    if (!shouldResumePlayback) {
      video.pause()
      markPlayerPaused()
      setHtmlPlayerShouldAutoPlay(false)
      return
    }

    setHtmlPlayerShouldAutoPlay(true)
    void video.play()
  }

  function updatePlayerClock(video: HTMLVideoElement) {
    updatePlayerClockFromValues(
      getFiniteVideoDuration(video),
      Number.isFinite(video.currentTime) ? video.currentTime : 0,
    )
  }

  function updatePlayerClockFromValues(
    duration: number,
    position: number,
    shortSeekDirection?: ScanDirection,
  ) {
    tvLastClockUpdateAtRef.current = getCurrentTimestamp()
    setPlayerClock({
      duration,
      position,
    })

    if (playerItem && !playerScanPreviewRef.current) {
      primePlaybackScanCache(playerItem, position, duration)

      if (shortSeekDirection !== undefined) {
        primeShortSeekPreviewCache(
          playerItem,
          position,
          duration,
          shortSeekDirection,
        )
      }
    }
  }

  function clearPlayerHudTimeout() {
    if (playerHudTimeoutRef.current === null) {
      return
    }

    window.clearTimeout(playerHudTimeoutRef.current)
    playerHudTimeoutRef.current = null
  }

  function shouldAutoHidePlayerHud() {
    if (playerScanPreviewRef.current?.scanning) {
      return false
    }

    const snapshot = readActivePlaybackSnapshot()

    return Boolean(snapshot && !snapshot.paused && !snapshot.ended)
  }

  function showPlayerHud(autoHide = shouldAutoHidePlayerHud()) {
    clearPlayerHudTimeout()
    setPlayerHudVisible(true)

    if (!autoHide || playerScanPreviewRef.current?.scanning) {
      return
    }

    playerHudTimeoutRef.current = window.setTimeout(() => {
      setPlayerHudVisible(false)
      playerHudTimeoutRef.current = null
    }, playerHudHideDelayMs)
  }

  function recordPlayback(
    item: MediaItem,
    video: HTMLVideoElement,
    force = false,
  ) {
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const position = Number.isFinite(video.currentTime) ? video.currentTime : 0

    recordPlaybackFromValues(item, duration, position, force)
  }

  function recordPlaybackFromValues(
    item: MediaItem,
    duration: number,
    position: number,
    force = false,
  ) {
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

  useEffect(() => {
    if (!playerItem || playerEngine !== 'avplay') {
      stopAvPlayPlayback()
      return
    }

    const timeoutId = window.setTimeout(() => {
      startAvPlayPlayback(playerItem)
    }, 0)

    return () => {
      window.clearTimeout(timeoutId)
      stopAvPlayPlayback()
    }
    // AVPlay owns an external native player; restart only when the selected item or engine changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, playerEngine, playerItem, playerPlaybackStrategy])

  useEffect(() => {
    function refreshVisibleApp() {
      registerSamsungRemoteKeys()
      refreshVisiblePlayerSurface()
      setIsAppVisible(true)
      setIsLoading(true)
      setResumeRefreshKey((currentKey) => currentKey + 1)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        if (playerItem) {
          closePlayer()
        } else {
          clearScanPreview()
          clearScanPreviewImages()
          clearPlayerHudTimeout()
          hidePlayerBlackout()
        }

        setIsAppVisible(false)
        return
      }

      refreshVisibleApp()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', refreshVisibleApp)
    window.addEventListener('pageshow', refreshVisibleApp)
    window.addEventListener('resize', refreshVisiblePlayerSurface)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', refreshVisibleApp)
      window.removeEventListener('pageshow', refreshVisibleApp)
      window.removeEventListener('resize', refreshVisiblePlayerSurface)
    }
  })

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const quickJumpDigit = getQuickJumpDigit(event)
      const action = getRemoteAction(event)

      if (!action && (quickJumpDigit === null || !playerItem)) {
        return
      }

      const uiRecoveryTrigger: TvUiRecoveryTrigger | null = action
        ? action
        : quickJumpDigit !== null && playerItem
          ? 'quickJump'
          : null
      const uiRecovery = uiRecoveryTrigger
        ? recoverStalledTvUi(uiRecoveryTrigger)
        : { recovered: false }

      if (playerItem && uiRecoveryTrigger) {
        tvLastPlayerInputAtRef.current = getCurrentTimestamp()
      }

      if (quickJumpDigit !== null && playerItem) {
        event.preventDefault()

        if (!event.repeat) {
          recordTvDiagnostic('player-quick-jump', {
            digit: quickJumpDigit,
            key: event.key,
            keyCode: event.keyCode,
            uiRecovery,
          }, {
            immediate: uiRecovery.recovered === true,
          })
        }

        jumpPlayerToQuickPosition(quickJumpDigit)
        return
      }

      if (!action) {
        return
      }

      if (!event.repeat) {
        recordTvDiagnostic('remote-keydown', {
          action,
          key: event.key,
          keyCode: event.keyCode,
          uiRecovery,
        }, {
          immediate: uiRecovery.recovered === true,
        })
      }

      if (
        action === 'back' &&
        !actionMenu &&
        !playerItem &&
        !detailTitle
      ) {
        if (exitTizenApplication()) {
          event.preventDefault()
        }

        return
      }

      event.preventDefault()

      if (actionMenu) {
        handleActionMenuAction(action)
        return
      }

      if (playerItem) {
        handlePlayerAction(action, event)
        return
      }

      if (detailTitle) {
        handleDetailAction(action)
        return
      }

      handleBrowseAction(action)
    }

    function handleKeyUp(event: KeyboardEvent) {
      const action = getRemoteAction(event)

      if (
        !playerItem ||
        (action !== 'left' && action !== 'right')
      ) {
        return
      }

      event.preventDefault()
      recordTvDiagnostic('remote-keyup', {
        action,
        key: event.key,
        keyCode: event.keyCode,
      })
      handlePlayerScanKeyUp(action === 'right' ? 1 : -1)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
    }
  })

  if (playerItem) {
    const playerInfoClassName = [
      'tv-player-info',
      scanPreview ? 'scanning' : '',
      playerHudVisible || scanPreview ? '' : 'hidden',
    ]
      .filter(Boolean)
      .join(' ')
    const scanProgressPercent = scanPreview
      ? getProgressPercent(scanPreview.position, playerClock.duration)
      : 0
    const playbackProgressPercent = getProgressPercent(
      playerClock.position,
      playerClock.duration,
    )
    const playerDebugStats = tvDebugMode && playerBlackoutVisible
      ? scanCacheStats ?? getFallbackScanPreviewCacheStats(playerItem)
      : null

    return (
      <main
        className="tv-player-shell"
        key={`player-shell:${playerItem.id}:${playerPlaybackStrategy}:${playerShellSurfaceVersion}`}
      >
        {playerEngine === 'html' ? (
          <video
            autoPlay={htmlPlayerShouldAutoPlay}
            className="tv-player"
            key={`${playerItem.id}:${playerPlaybackStrategy}:${htmlPlayerSurfaceVersion}`}
            onCanPlay={() => {
              setPlayerStatus(
                getPlaybackStatusLabel(playerItem, playerPlaybackStrategy),
              )
            }}
            onEnded={(event) => {
              clearPlayerStartupTimeout()
              clearScanPreview()
              clearPlayerHudTimeout()
              hidePlayerBlackout()
              markPlayerActive()
              updatePlayerClock(event.currentTarget)
              recordPlayback(playerItem, event.currentTarget, true)
              setPlayerStatus(null)
              playbackActivityCleanupStateRef.current = 'ended'
              setPlayerItem(null)
            }}
            onError={() => {
              if (playerPlaybackStrategy === 'native') {
                fallbackPlayerToTranscode(playerItem, 'Native playback failed')
                return
              }

              clearPlayerStartupTimeout()
              setPlayerStatus('Transcode playback failed')
            }}
            onLoadStart={() => {
              setPlayerStatus(
                getPlaybackStatusLabel(playerItem, playerPlaybackStrategy),
              )
              armNativePlaybackFallback(playerItem)
            }}
            onLoadedMetadata={(event) => handleLoadedMetadata(playerItem, event)}
            onPause={(event) => {
              markPlayerPaused()
              setHtmlPlayerShouldAutoPlay(false)
              updatePlayerClock(event.currentTarget)
              showPlayerHud()
              recordPlayback(playerItem, event.currentTarget, true)
              recordTvDiagnostic('html-video-pause', {}, { immediate: true })
            }}
            onPlay={(event) => {
              markPlayerActive()
              setHtmlPlayerShouldAutoPlay(true)
              hidePlayerBlackout()
              updatePlayerClock(event.currentTarget)
              showPlayerHud(true)
              recordTvDiagnostic('html-video-play')
            }}
            onPlaying={(event) => {
              clearPlayerStartupTimeout()
              markPlayerActive()
              setHtmlPlayerShouldAutoPlay(true)
              hidePlayerBlackout()
              updatePlayerClock(event.currentTarget)
              setPlayerStatus(
                getPlaybackStatusLabel(playerItem, playerPlaybackStrategy),
              )
              showPlayerHud(true)
              recordTvDiagnostic('html-video-playing')
            }}
            onSeeked={(event) => {
              updatePlayerClock(event.currentTarget)
              showPlayerHud(!event.currentTarget.paused)
            }}
            onSeeking={(event) => {
              updatePlayerClock(event.currentTarget)
              showPlayerHud()
            }}
            onTimeUpdate={(event) => {
              if (event.currentTarget.currentTime > 0) {
                clearPlayerStartupTimeout()
              }

              updatePlayerClock(event.currentTarget)
              recordPlayback(playerItem, event.currentTarget)
            }}
            onWaiting={(event) => {
              updatePlayerClock(event.currentTarget)
              if (
                playerPlaybackStrategy === 'native' &&
                !hasPlayerStarted(event.currentTarget)
              ) {
                setPlayerStatus('Waiting for native playback')
              }

              showPlayerHud()
            }}
            playsInline
            ref={playerRef}
            src={getPlaybackStreamUrl(
              playerItem,
              apiBase,
              playerPlaybackStrategy,
            )}
          />
        ) : (
          <object
            aria-hidden="true"
            className="tv-avplay-stage"
            type="application/avplayer"
          />
        )}
        {playerBlackoutVisible ? (
          <div className="tv-player-blackout" aria-hidden="true" />
        ) : null}
        {playerDebugStats ? (
          <section className="tv-player-debug" aria-label="Player debug">
            <p>Scan cache</p>
            <dl>
              <div>
                <dt>Heap</dt>
                <dd>{formatDebugMemory(playerDebugStats.appHeapMiB)}</dd>
              </div>
              <div>
                <dt>Limit</dt>
                <dd>{formatDebugMemory(playerDebugStats.appHeapLimitMiB)}</dd>
              </div>
              <div>
                <dt>Preview RAM</dt>
                <dd>
                  {formatDebugMemory(playerDebugStats.decodedCacheMiB)} /{' '}
                  {formatDebugMemory(playerDebugStats.budgetMiB)}
                </dd>
              </div>
              <div>
                <dt>Total est.</dt>
                <dd>{formatDebugMemory(playerDebugStats.estimatedTotalMiB)}</dd>
              </div>
              <div>
                <dt>Warm</dt>
                <dd>+/-{playerDebugStats.warmSheetsPerDirection} sheets</dd>
              </div>
              <div>
                <dt>Retain</dt>
                <dd>+/-{playerDebugStats.retainedSheetsPerDirection} sheets</dd>
              </div>
              <div>
                <dt>Load</dt>
                <dd>{playerDebugStats.loadMs} ms</dd>
              </div>
              <div>
                <dt>Transfer</dt>
                <dd>{playerDebugStats.estimatedSheetTransferKiB} KiB</dd>
              </div>
              <div>
                <dt>Bandwidth</dt>
                <dd>{formatDebugBandwidth(playerDebugStats.bandwidthMiBps)}</dd>
              </div>
            </dl>
          </section>
        ) : null}
        {shortSeekPreview ? (
          <div className="tv-short-seek-preview" aria-hidden="true">
            {shortSeekPreviewVisibleVisual?.kind === 'image' ? (
              <img
                alt=""
                decoding="async"
                draggable={false}
                src={shortSeekPreviewVisibleVisual.url}
              />
            ) : shortSeekPreviewVisibleVisual?.kind === 'sprite' ? (
              <div
                className="tv-short-seek-preview-sprite"
                style={getScanPreviewSpriteStyle(shortSeekPreviewVisibleVisual)}
              />
            ) : null}
            <span>{formatDuration(shortSeekPreview.position)}</span>
          </div>
        ) : null}
        {playerBlackoutVisible && hasPlayerEpisodeSwitchOptions ? (
          <div
            aria-label="Episode selection"
            className="tv-player-episode-switch"
          >
            <button
              aria-label={
                playerEpisodeSwitchOptions.previous
                  ? `Select previous episode ${formatEpisodeNumber(
                      playerEpisodeSwitchOptions.previous,
                    )}`
                  : 'No previous episode'
              }
              className={getPlayerEpisodeSwitchButtonClassName(
                playerEpisodeSwitchOptions.target?.id ===
                  playerEpisodeSwitchOptions.previous?.id,
              )}
              disabled={!playerEpisodeSwitchOptions.previous}
              onClick={() => selectPlayerEpisodeSwitchTarget(-1)}
              title="Previous episode"
              type="button"
            >
              <ChevronLeft aria-hidden="true" size={28} />
              <span>
                <strong>
                  {playerEpisodeSwitchOptions.previous
                    ? formatEpisodeNumber(playerEpisodeSwitchOptions.previous)
                    : 'Previous'}
                </strong>
                <small>
                  {playerEpisodeSwitchOptions.previous
                    ? getDetailItemTitle(playerEpisodeSwitchOptions.previous)
                    : 'No episode'}
                </small>
              </span>
              {playerEpisodeSwitchOptions.target?.id ===
              playerEpisodeSwitchOptions.previous?.id ? (
                <Check aria-hidden="true" size={22} />
              ) : null}
            </button>
            <button
              aria-label={
                playerEpisodeSwitchOptions.next
                  ? `Select next episode ${formatEpisodeNumber(
                      playerEpisodeSwitchOptions.next,
                    )}`
                  : 'No next episode'
              }
              className={getPlayerEpisodeSwitchButtonClassName(
                playerEpisodeSwitchOptions.target?.id ===
                  playerEpisodeSwitchOptions.next?.id,
              )}
              disabled={!playerEpisodeSwitchOptions.next}
              onClick={() => selectPlayerEpisodeSwitchTarget(1)}
              title="Next episode"
              type="button"
            >
              <span>
                <strong>
                  {playerEpisodeSwitchOptions.next
                    ? formatEpisodeNumber(playerEpisodeSwitchOptions.next)
                    : 'Next'}
                </strong>
                <small>
                  {playerEpisodeSwitchOptions.next
                    ? getDetailItemTitle(playerEpisodeSwitchOptions.next)
                    : 'No episode'}
                </small>
              </span>
              {playerEpisodeSwitchOptions.target?.id ===
              playerEpisodeSwitchOptions.next?.id ? (
                <Check aria-hidden="true" size={22} />
              ) : null}
              <ChevronRight aria-hidden="true" size={28} />
            </button>
          </div>
        ) : null}
        <div className={playerInfoClassName}>
          {scanPreview ? (
            <>
              <div className="tv-scan-thumbnail">
                {scanPreviewVisibleVisual?.kind === 'image' ? (
                  <img
                    alt=""
                    className="tv-scan-thumbnail-image"
                    decoding="async"
                    draggable={false}
                    loading="eager"
                    src={scanPreviewVisibleVisual.url}
                  />
                ) : scanPreviewVisibleVisual?.kind === 'sprite' ? (
                  <div
                    className="tv-scan-thumbnail-image tv-scan-thumbnail-sprite"
                    style={getScanPreviewSpriteStyle(scanPreviewVisibleVisual)}
                  />
                ) : null}
                <span>{formatDuration(scanPreview.position)}</span>
              </div>
              <div className="tv-scan-details">
                <div className="tv-scan-heading">
                  <strong>{formatScanPreviewMode(scanPreview)}</strong>
                  <span>
                    {formatDuration(scanPreview.position)} /{' '}
                    {playerClock.duration > 0
                      ? formatDuration(playerClock.duration)
                      : '--:--'}
                  </span>
                </div>
                <div className="tv-scan-rail" aria-hidden="true">
                  <i style={{ width: `${playbackProgressPercent}%` }} />
                  <b style={{ left: `${scanProgressPercent}%` }} />
                </div>
                <div className="tv-player-title">
                  <strong>{getItemDisplayTitle(playerItem)}</strong>
                  <span>
                    {formatPlayerPlaybackLabel(
                      playerItem,
                      playerPlaybackStrategy,
                      playerStatus,
                    )}
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="tv-player-title">
                <strong>{getItemDisplayTitle(playerItem)}</strong>
                <span>
                  {formatPlayerPlaybackLabel(
                    playerItem,
                    playerPlaybackStrategy,
                    playerStatus,
                  )}
                </span>
              </div>
              <span>{formatPlayerClock(playerClock)}</span>
              <div className="tv-player-progress" aria-hidden="true">
                <i style={{ width: `${playbackProgressPercent}%` }} />
              </div>
            </>
          )}
        </div>
      </main>
    )
  }

  if (detailTitle) {
    return (
      <main className="tv-detail-shell">
        <section className="tv-detail-hero">
          <div className="tv-detail-art">
            {canLoadArtwork && detailTitle.artworkUrl ? (
              <img
                alt=""
                decoding="async"
                loading="lazy"
                onError={hideFailedArtwork}
                src={resolveMediaUrl(detailTitle.artworkUrl, apiBase)}
              />
            ) : null}
            <span>{detailTitle.kind === 'show' ? 'TV' : 'MOVIE'}</span>
          </div>
          <div className="tv-detail-copy">
            <p>{detailTitle.kind === 'show' ? detailTitle.subtitle : 'Movie'}</p>
            <div className="tv-detail-title-row">
              <h1>{detailTitle.title}</h1>
              <button
                aria-label={`${detailTitle.title} actions`}
                className={
                  detailFocusArea === 'titleMenu'
                    ? 'tv-icon-button selected'
                    : 'tv-icon-button'
                }
                onClick={() => {
                  setDetailFocusArea('titleMenu')
                  openTitleActionMenu(detailTitle)
                }}
                title={`${detailTitle.title} actions`}
                type="button"
              >
                <Settings size={22} />
              </button>
            </div>
            <div className="tv-detail-meta">
              <span>{detailTitle.source}</span>
              {detailItem ? <span>{getDetailItemLabel(detailItem)}</span> : null}
              {detailPlayback && !detailPlayback.completed ? (
                <span>{formatDuration(detailPlayback.position)}</span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="tv-detail-body">
          <div className="tv-detail-heading">
            <h2>{getDetailItemsHeading(detailTitle)}</h2>
            <span>{getDetailItemsCountLabel(detailTitle)}</span>
          </div>
          <div className="tv-detail-list" ref={detailListRef}>
            {detailTitle.items.map((item, itemIndex) => {
              const previousItem = detailTitle.items[itemIndex - 1]
              const seasonHeading = getDetailSeasonHeading(
                detailTitle,
                item,
                previousItem,
              )
              const isSelected = detailItemIndex === itemIndex
              const isEpisodeMenuSelected =
                isSelected && detailFocusArea === 'episodeMenu'
              const playback = playbackHistory[item.id] ?? null

              return (
                <Fragment key={item.id}>
                  {seasonHeading ? (
                    <div className="tv-detail-season-heading">
                      <h3>{seasonHeading}</h3>
                    </div>
                  ) : null}
                  <div
                    className={getDetailItemClassName(
                      isSelected,
                      isEpisodeMenuSelected,
                    )}
                    ref={isSelected ? detailSelectedItemRef : null}
                  >
                    <button
                      aria-label={`${getDetailItemTitle(item)} actions`}
                      className={
                        isEpisodeMenuSelected
                          ? 'tv-icon-button selected'
                          : 'tv-icon-button'
                      }
                      onClick={() => {
                        setDetailState({
                          focusArea: 'episodeMenu',
                          itemIndex,
                          title: detailTitle,
                        })
                        openEpisodeActionMenu(detailTitle, itemIndex)
                      }}
                      title={`${getDetailItemTitle(item)} actions`}
                      type="button"
                    >
                      <Settings size={20} />
                    </button>
                    <button
                      className="tv-detail-play"
                      onClick={() => {
                        setDetailState({
                          focusArea: 'episode',
                          itemIndex,
                          title: detailTitle,
                        })
                        startPlayback(item)
                      }}
                      type="button"
                    >
                      <span>{getDetailItemLabel(item)}</span>
                      <strong>{getDetailItemTitle(item)}</strong>
                      <p>{getDetailPlaybackLabel(item, playback)}</p>
                      {playback && playback.duration > 0 ? (
                        <div className="tv-progress" aria-hidden="true">
                          <i
                            style={{
                              width: `${Math.min(
                                (playback.position / playback.duration) * 100,
                                100,
                              )}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </button>
                  </div>
                </Fragment>
              )
            })}
          </div>
        </section>

        {renderActionMenu()}
      </main>
    )
  }

  return (
    <main className="tv-shell">
      <header className="tv-topbar">
        <div>
          <p>My Home Media Server v{__HOME_MEDIA_APP_VERSION__}</p>
          <h1>{selectedTitle?.title ?? 'Loading library'}</h1>
        </div>
        <div className="tv-status">
          <span>{library ? `${library.summary.totalVideos} files` : '...'}</span>
          <strong>{getClientDeviceLabel(clientProfile)}</strong>
          <small>{apiBase || 'Local package'}</small>
          <button
            aria-label="TV playback settings"
            className={[
              'tv-icon-button tv-topbar-settings-button',
              safeFocus.area === 'settings' ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={openSettingsMenu}
            title="TV playback settings"
            type="button"
          >
            <Settings size={20} />
          </button>
        </div>
      </header>

      <section className="tv-hero" aria-live="polite">
        <div className="tv-hero-art">
          {canLoadArtwork && selectedTitle?.artworkUrl ? (
            <img
              alt=""
              decoding="async"
              loading="lazy"
              onError={hideFailedArtwork}
              src={resolveMediaUrl(selectedTitle.artworkUrl, apiBase)}
            />
          ) : null}
          <span>{selectedTitle?.kind === 'show' ? 'TV' : 'MOVIE'}</span>
        </div>
        <div className="tv-hero-copy">
          <p>
            {selectedTitle
              ? getTitleSubtitle(selectedTitle, selectedTitleIsContinue)
              : 'Preparing your media'}
          </p>
          <h2>{selectedTitle?.title ?? 'My Home Media Server'}</h2>
          <div className="tv-hero-meta">
            <span>{selectedItem?.container ?? '...'}</span>
            <span>{selectedTitle?.source ?? 'Server'}</span>
            {selectedPlayback && !selectedPlayback.completed ? (
              <span>{formatDuration(selectedPlayback.position)}</span>
            ) : null}
          </div>
          <button
            className={[
              'tv-primary-action',
              safeFocus.area === 'hero' ? 'selected' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            disabled={!selectedItem}
            onClick={() => activateTitle(activeSection, selectedTitle)}
            type="button"
          >
            {getPrimaryActionLabel(
              selectedTitle,
              selectedItem,
              selectedPlayback,
              selectedTitleIsContinue,
            )}
          </button>
        </div>
      </section>

      {error ? (
        <section aria-live="assertive" className="tv-error">
          <strong>{error.message}</strong>
          <pre>{error.diagnostics.join('\n')}</pre>
        </section>
      ) : null}

      {libraryConnectionStatus ? (
        <section
          aria-live="polite"
          className={getLibraryConnectionStatusClassName(
            libraryConnectionPhase,
          )}
        >
          <strong>{libraryConnectionStatus.title}</strong>
          <span>{libraryConnectionStatus.detail}</span>
        </section>
      ) : null}

      {!isLoading && sections.length ? (
        <section className="tv-rows" aria-label="Media rows" ref={rowsRef}>
          {sections.map((section, sectionIndex) => {
            const shouldLoadArtwork =
              canLoadArtwork &&
              Math.abs(sectionIndex - safeFocus.sectionIndex) <=
                libraryArtworkRowLoadRadius

            return (
              <section
                className="tv-row"
                key={section.id}
                ref={
                  safeFocus.area === 'rows' &&
                  safeFocus.sectionIndex === sectionIndex
                    ? selectedRowRef
                    : null
                }
              >
                <div className="tv-row-heading">
                  <h3>{section.label}</h3>
                  <span>{section.titles.length}</span>
                </div>
                <div className="tv-card-row">
                  {section.titles.map((title, itemIndex) => {
                    const isSelected =
                      safeFocus.area === 'rows' &&
                      safeFocus.sectionIndex === sectionIndex &&
                      safeFocus.itemIndex === itemIndex
                    const playback = title.resumeItem
                      ? playbackHistory[title.resumeItem.id]
                      : null

                    return (
                      <button
                        className={isSelected ? 'tv-card selected' : 'tv-card'}
                        key={title.id}
                        onClick={() => {
                          setFocus({ area: 'rows', itemIndex, sectionIndex })
                          activateTitle(section, title)
                        }}
                        ref={isSelected ? selectedCardRef : null}
                        type="button"
                      >
                        {shouldLoadArtwork && title.artworkUrl ? (
                          <img
                            alt=""
                            className="tv-card-art"
                            decoding="async"
                            loading="lazy"
                            onError={hideFailedArtwork}
                            src={resolveMediaUrl(title.artworkUrl, apiBase)}
                          />
                        ) : title.artworkUrl ? (
                          <div
                            aria-hidden="true"
                            className="tv-card-art-placeholder"
                          />
                        ) : null}
                        <span>{title.kind === 'show' ? 'TV' : 'Movie'}</span>
                        <strong>{title.title}</strong>
                        <p>
                          {getTitleSubtitle(title, section.id === 'continue')}
                        </p>
                        {playback && playback.duration > 0 ? (
                          <div className="tv-progress" aria-hidden="true">
                            <i
                              style={{
                                width: `${Math.min(
                                  (playback.position / playback.duration) * 100,
                                  100,
                                )}%`,
                              }}
                            />
                          </div>
                        ) : null}
                      </button>
                    )
                  })}
                </div>
              </section>
            )
          })}
        </section>
      ) : (
        <section className="tv-loading">No titles found</section>
      )}

      {renderActionMenu()}
    </main>
  )
}

function buildTvSections(
  items: MediaItem[],
  history: PlaybackHistory,
): TvSection[] {
  const titles = buildTvTitles(items, history)
  const continueTitles = titles
    .filter((title) => title.lastWatchedAt)
    .sort(sortByLastWatched)
    .slice(0, maxRowItems)
  const movies = titles
    .filter((title) => title.kind === 'movie')
    .sort(sortByTitle)
    .slice(0, maxRowItems)
  const shows = titles
    .filter((title) => title.kind === 'show')
    .sort(sortByTitle)
    .slice(0, maxRowItems)
  const sections: TvSection[] = [
    {
      id: 'continue',
      label: 'Continue',
      titles: continueTitles,
    },
    {
      id: 'shows',
      label: 'TV Shows',
      titles: shows,
    },
    {
      id: 'movies',
      label: 'Movies',
      titles: movies,
    },
  ]

  return sections.filter((section) => section.titles.length)
}

function buildTvTitles(items: MediaItem[], history: PlaybackHistory) {
  const movies = items
    .filter((item) => item.category === 'movie')
    .map<TvTitle>((item) => ({
      id: `movie:${item.id}`,
      artworkUrl: item.artworkUrl,
      items: [item],
      kind: 'movie',
      lastWatchedAt: history[item.id]?.updatedAt ?? null,
      resumeItem: item,
      source: item.source,
      subtitle: item.sizeLabel,
      title: item.title,
    }))

  const showMap = new Map<string, MediaItem[]>()

  for (const item of items) {
    if (item.category !== 'show') {
      continue
    }

    const key = getShowGroupKey(item)
    const episodes = showMap.get(key) ?? []

    episodes.push(item)
    showMap.set(key, episodes)
  }

  const shows = Array.from(showMap.entries()).map<TvTitle>(([key, episodes]) => {
    const sortedEpisodes = [...episodes].sort(sortEpisodes)
    const resumeItem = getShowResumeItem(sortedEpisodes, history)
    const latestWatchedAt = sortedEpisodes.reduce<number | null>(
      (latest, episode) => {
        const watchedAt = history[episode.id]?.updatedAt ?? null

        return latest && watchedAt
          ? Math.max(latest, watchedAt)
          : watchedAt ?? latest
      },
      null,
    )

    return {
      id: `show:${key}`,
      artworkUrl: sortedEpisodes.find((episode) => episode.artworkUrl)?.artworkUrl,
      items: sortedEpisodes,
      kind: 'show',
      lastWatchedAt: latestWatchedAt,
      resumeItem,
      source: sortedEpisodes[0]?.source ?? 'TV Shows',
      subtitle: formatShowSubtitle(sortedEpisodes),
      title: sortedEpisodes[0]?.showTitle ?? key.split(':').slice(1).join(':'),
    }
  })

  return [...movies, ...shows]
}

function getShowResumeItem(episodes: MediaItem[], history: PlaybackHistory) {
  const watchedEpisode = episodes
    .filter((episode) => history[episode.id])
    .sort(
      (first, second) =>
        history[second.id].updatedAt - history[first.id].updatedAt,
    )[0]

  if (!watchedEpisode) {
    const regularEpisodes = episodes.filter((episode) => !isShowExtraItem(episode))

    return (
      regularEpisodes.find(isTvNativePlaybackCandidate) ??
      regularEpisodes[0] ??
      episodes.find(isTvNativePlaybackCandidate) ??
      episodes[0]
    )
  }

  const watchedRecord = history[watchedEpisode.id]

  if (!watchedRecord.completed) {
    return watchedEpisode
  }

  const watchedIndex = episodes.findIndex(
    (episode) => episode.id === watchedEpisode.id,
  )

  if (isShowExtraItem(watchedEpisode)) {
    return watchedEpisode
  }

  const nextRegularEpisode = episodes
    .slice(watchedIndex + 1)
    .find((episode) => !isShowExtraItem(episode))

  if (nextRegularEpisode) {
    return nextRegularEpisode
  }

  return watchedEpisode
}

function getPlayerEpisodeSwitchOptions(
  items: MediaItem[],
  currentItem: MediaItem | null,
  targetId: string | null,
): PlayerEpisodeSwitchOptions {
  if (!currentItem || currentItem.category !== 'show') {
    return createEmptyPlayerEpisodeSwitchOptions()
  }

  const currentShowKey = getShowGroupKey(currentItem)
  const episodes = items
    .filter(
      (item) =>
        item.category === 'show' &&
        getShowGroupKey(item) === currentShowKey &&
        !isShowExtraItem(item),
    )
    .sort(sortEpisodes)
  const currentIndex = episodes.findIndex(
    (episode) => episode.id === currentItem.id,
  )

  if (currentIndex < 0) {
    return createEmptyPlayerEpisodeSwitchOptions()
  }

  const previous = episodes[currentIndex - 1] ?? null
  const next = episodes[currentIndex + 1] ?? null
  const target =
    targetId && previous?.id === targetId
      ? previous
      : targetId && next?.id === targetId
        ? next
        : null

  return {
    next,
    previous,
    target,
  }
}

function createEmptyPlayerEpisodeSwitchOptions(): PlayerEpisodeSwitchOptions {
  return {
    next: null,
    previous: null,
    target: null,
  }
}

function getShowGroupKey(item: MediaItem) {
  return `${item.source}:${(item.showTitle ?? item.title).toLowerCase()}`
}

function formatShowSubtitle(episodes: MediaItem[]) {
  const regularEpisodes = episodes.filter((episode) => !isShowExtraItem(episode))
  const extraCount = episodes.length - regularEpisodes.length
  const episodeCount = regularEpisodes.length
  const seasonCount = getShowSeasonCount(regularEpisodes)
  const episodeLabel = formatCountLabel(episodeCount, 'episode')
  const labels = [
    seasonCount > 0
      ? `${episodeLabel}, ${formatCountLabel(seasonCount, 'season')}`
      : episodeLabel,
  ]

  if (extraCount > 0) {
    labels.push(formatCountLabel(extraCount, 'extra'))
  }

  return labels.join(', ')
}

function getShowSeasonCount(episodes: MediaItem[]) {
  return new Set(
    episodes
      .map((episode) => episode.seasonNumber)
      .filter((seasonNumber): seasonNumber is number =>
        Number.isInteger(seasonNumber),
      ),
  ).size
}

function formatCountLabel(count: number, label: string) {
  return `${count} ${label}${count === 1 ? '' : 's'}`
}

function getDetailItemsHeading(title: TvTitle) {
  if (title.kind !== 'show') {
    return 'Title'
  }

  return title.items.some(isShowExtraItem) ? 'Episodes & Extras' : 'Episodes'
}

function getDetailItemsCountLabel(title: TvTitle) {
  if (title.kind !== 'show') {
    return String(title.items.length)
  }

  const regularEpisodeCount = title.items.filter(
    (item) => !isShowExtraItem(item),
  ).length
  const extraCount = title.items.length - regularEpisodeCount

  if (extraCount === 0) {
    return String(regularEpisodeCount)
  }

  return `${regularEpisodeCount} + ${extraCount}`
}

function isShowExtraItem(item: MediaItem) {
  return Boolean(getShowExtraGroupLabel(item))
}

function getShowExtraGroupLabel(item: MediaItem) {
  if (item.category !== 'show') {
    return null
  }

  const folders = getShowContentFolders(item)

  if (!folders.length) {
    return null
  }

  const [firstFolder, ...nestedFolders] = folders

  if (isShowExtraFolderName(firstFolder) || !isShowSeasonFolderName(firstFolder)) {
    return formatShowFolderLabel(firstFolder)
  }

  const nestedExtraFolder = nestedFolders.find(isShowExtraFolderName)

  return nestedExtraFolder ? formatShowFolderLabel(nestedExtraFolder) : null
}

function getShowContentFolders(item: MediaItem) {
  const pathParts = item.relativePath.split(/[\\/]/).filter(Boolean)

  return pathParts.slice(2, -1)
}

function isShowSeasonFolderName(folderName: string) {
  const normalizedName = normalizeShowFolderName(folderName)

  return (
    /^(?:season|series)\s*\d{1,3}$/.test(normalizedName) ||
    /^s\d{1,3}$/.test(normalizedName) ||
    /^specials?$/.test(normalizedName)
  )
}

function isShowExtraFolderName(folderName: string) {
  return /\b(?:bonus|deleted|extra|featurette|interview|making|promo|soundtrack|trailer)s?\b/.test(
    normalizeShowFolderName(folderName),
  )
}

function normalizeShowFolderName(folderName: string) {
  return folderName
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function formatShowFolderLabel(folderName: string) {
  const normalizedName = folderName
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return normalizedName || 'Extras'
}

function getDetailSeasonHeading(
  title: TvTitle,
  item: MediaItem,
  previousItem: MediaItem | undefined,
) {
  if (title.kind !== 'show') {
    return null
  }

  const extraGroupLabel = getShowExtraGroupLabel(item)

  if (extraGroupLabel) {
    return previousItem &&
      getShowExtraGroupLabel(previousItem) === extraGroupLabel
      ? null
      : `Extras - ${extraGroupLabel}`
  }

  if (!Number.isInteger(item.seasonNumber)) {
    return null
  }

  if (previousItem?.seasonNumber === item.seasonNumber) {
    return null
  }

  return `Season ${item.seasonNumber}`
}

function clampFocus(focus: FocusPosition, sections: TvSection[]) {
  const sectionIndex = clamp(
    focus.sectionIndex,
    0,
    Math.max(sections.length - 1, 0),
  )
  const itemIndex = clamp(
    focus.itemIndex,
    0,
    Math.max((sections[sectionIndex]?.titles.length ?? 1) - 1, 0),
  )

  return {
    area: focus.area,
    itemIndex,
    sectionIndex,
  }
}

function getRemoteAction(event: KeyboardEvent): RemoteAction | null {
  const keyCode = event.keyCode || event.which

  if (event.key === 'ArrowUp' || keyCode === 38) {
    return 'up'
  }

  if (event.key === 'ArrowDown' || keyCode === 40) {
    return 'down'
  }

  if (event.key === 'ArrowLeft' || keyCode === 37) {
    return 'left'
  }

  if (event.key === 'ArrowRight' || keyCode === 39) {
    return 'right'
  }

  if (event.key === 'Enter' || keyCode === 13) {
    return 'enter'
  }

  if (
    event.key === 'MediaPlayPause' ||
    event.key === 'PlayPause' ||
    keyCode === 10252 ||
    keyCode === 179
  ) {
    return 'playPause'
  }

  if (
    event.key === 'MediaPlay' ||
    event.key === 'Play' ||
    keyCode === 415
  ) {
    return 'play'
  }

  if (
    event.key === 'MediaPause' ||
    event.key === 'Pause' ||
    keyCode === 19
  ) {
    return 'pause'
  }

  if (
    event.key === 'BrowserBack' ||
    event.key === 'Escape' ||
    event.key === 'XF86Back' ||
    keyCode === 10009
  ) {
    return 'back'
  }

  return null
}

function registerSamsungRemoteKeys() {
  const tvInputDevice = (window as MyHomeMediaServerWindow).tizen?.tvinputdevice

  try {
    if (tvInputDevice?.registerKeyBatch) {
      tvInputDevice.registerKeyBatch(samsungMediaKeys)
      tvInputDevice.registerKeyBatch(playerQuickJumpRemoteKeys)
      return
    }

    for (const key of [...samsungMediaKeys, ...playerQuickJumpRemoteKeys]) {
      tvInputDevice?.registerKey?.(key)
    }
  } catch {
    // Browsers and some TV runtimes can reject key registration; keydown still works there.
  }
}

function exitTizenApplication() {
  const tizenApplication = (window as MyHomeMediaServerWindow).tizen
    ?.application

  try {
    const currentApplication = tizenApplication?.getCurrentApplication?.()

    if (currentApplication?.exit) {
      currentApplication.exit()
      return true
    }

    if (currentApplication?.hide) {
      currentApplication.hide()
      return true
    }
  } catch {
    return false
  }

  return false
}

function hideFailedArtwork(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true
}

function readInitialApiBase() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryApiBase = params.get('api') ?? params.get('server')
    const runtimeApiBase = (window as MyHomeMediaServerWindow).HOME_MEDIA_CONFIG
      ?.apiBase
    const storedApiBase =
      window.localStorage.getItem(apiBaseStorageKey) ??
      window.localStorage.getItem(legacyApiBaseStorageKey)

    return normalizeApiBase(
      queryApiBase ??
        runtimeApiBase ??
        storedApiBase ??
        import.meta.env.VITE_HOME_MEDIA_API_BASE,
    )
  } catch {
    return ''
  }
}

function readInitialTvDebugMode() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryDebugMode = params.get('debug') ?? params.get('tvDebug')

    if (queryDebugMode !== null) {
      return isEnabledConfigFlag(queryDebugMode)
    }

    const runtimeConfig = (window as MyHomeMediaServerWindow).HOME_MEDIA_CONFIG

    return Boolean(runtimeConfig?.tvDebug ?? runtimeConfig?.debug)
  } catch {
    return false
  }
}

function readInitialTvDiagnosticsMode() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryDiagnosticsMode =
      params.get('diagnostics') ?? params.get('tvDiagnostics')

    if (queryDiagnosticsMode !== null) {
      return isEnabledConfigFlag(queryDiagnosticsMode)
    }

    const runtimeConfig = (window as MyHomeMediaServerWindow).HOME_MEDIA_CONFIG

    if (typeof runtimeConfig?.tvDiagnostics === 'boolean') {
      return runtimeConfig.tvDiagnostics
    }

    return true
  } catch {
    return true
  }
}

function readInitialPreventSleepWhilePaused() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryValue =
      params.get('preventSleepWhilePaused') ?? params.get('keepAwakePaused')

    if (queryValue !== null) {
      return isEnabledConfigFlag(queryValue)
    }

    const runtimeConfig = (window as MyHomeMediaServerWindow).HOME_MEDIA_CONFIG

    if (typeof runtimeConfig?.preventSleepWhilePaused === 'boolean') {
      return runtimeConfig.preventSleepWhilePaused
    }

    const storedValue = window.localStorage.getItem(
      preventSleepWhilePausedStorageKey,
    )

    if (storedValue !== null) {
      return storedValue === '1'
    }

    return true
  } catch {
    return true
  }
}

function writePreventSleepWhilePaused(value: boolean) {
  try {
    window.localStorage.setItem(
      preventSleepWhilePausedStorageKey,
      value ? '1' : '0',
    )
  } catch {
    // Local settings should not interfere with playback.
  }
}

function createTvDiagnosticsSessionId() {
  return [
    'tv',
    __HOME_MEDIA_APP_VERSION__,
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
  ].join('-')
}

function isEnabledConfigFlag(value: string) {
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
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

async function reportClientProfile(
  apiBase: string,
  profile: ClientDeviceProfile,
  signal?: AbortSignal,
) {
  const response = await fetch(buildApiUrl('/api/client-profile', apiBase), {
    body: JSON.stringify(profile),
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Client profile failed (${response.status})`)
  }
}

function readClientDeviceProfile(): ClientDeviceProfile {
  const appWindow = window as MyHomeMediaServerWindow
  const productInfo = appWindow.webapis?.productinfo
  const avInfo = appWindow.webapis?.avinfo

  return {
    app: 'tv',
    avInfoVersion: safelyReadString(() => avInfo?.getVersion?.()),
    firmware: safelyReadString(() => productInfo?.getFirmware?.()),
    is8K: safelyReadBoolean(() => productInfo?.is8KPanelSupported?.()),
    isHdrTvSupport: safelyReadBoolean(() => avInfo?.isHdrTvSupport?.()),
    isUhd: safelyReadBoolean(() => productInfo?.isUHDAModel?.()),
    model: safelyReadString(() => productInfo?.getModel?.()),
    modelCode: safelyReadString(() => productInfo?.getModelCode?.()),
    productInfoVersion: safelyReadString(() => productInfo?.getVersion?.()),
    realModel: safelyReadString(() => productInfo?.getRealModel?.()),
    tizenVersion: getTizenVersion(navigator.userAgent),
    userAgent: navigator.userAgent,
    videoProbes: readClientVideoProbes(),
  }
}

function readClientVideoProbes(): ClientVideoProbe[] {
  const video = document.createElement('video')

  return clientVideoProbeMimeTypes.map((probe) => ({
    ...probe,
    result: video.canPlayType(probe.mimeType),
  }))
}

function getClientDeviceLabel(profile: ClientDeviceProfile) {
  return (
    profile.realModel ||
    profile.modelCode ||
    profile.model ||
    (profile.tizenVersion ? `Tizen ${profile.tizenVersion}` : 'TV client')
  )
}

function getTizenVersion(userAgent: string) {
  return /Tizen\s+([0-9.]+)/i.exec(userAgent)?.[1]
}

function safelyReadString(readValue: () => string | undefined) {
  try {
    const value = readValue()?.trim()

    return value || undefined
  } catch {
    return undefined
  }
}

function safelyReadBoolean(readValue: () => boolean | undefined) {
  try {
    const value = readValue()

    return typeof value === 'boolean' ? value : undefined
  } catch {
    return undefined
  }
}

function getInitialPlaybackStrategy(item: MediaItem): PlaybackStrategy {
  return isTvNativePlaybackCandidate(item) ? 'native' : 'transcode'
}

function getPlaybackStrategy(
  item: MediaItem,
  strategies: Record<string, PlaybackStrategy>,
) {
  return strategies[item.id] ?? getInitialPlaybackStrategy(item)
}

function getPlaybackEngine(
  item: MediaItem,
  strategy: PlaybackStrategy,
): PlayerEngine {
  if (
    strategy === 'native' &&
    !item.browserPlayable &&
    isTvNativePlaybackCandidate(item) &&
    Boolean((window as MyHomeMediaServerWindow).webapis?.avplay)
  ) {
    return 'avplay'
  }

  return 'html'
}

function isTvNativePlaybackCandidate(item: MediaItem) {
  return (
    item.browserPlayable ||
    tvNativePlaybackContainers.has(item.container.toUpperCase())
  )
}

function getPlaybackStatusLabel(
  item: MediaItem,
  strategy: PlaybackStrategy,
) {
  if (strategy === 'transcode') {
    return 'Transcoding'
  }

  return item.browserPlayable ? 'Direct stream' : 'Native direct play'
}

function formatPlayerPlaybackLabel(
  item: MediaItem,
  strategy: PlaybackStrategy,
  status: string | null,
) {
  const episodeLabel = hasEpisodeCode(item) ? formatEpisodeNumber(item) : ''
  const strategyLabel = status ?? getPlaybackStatusLabel(item, strategy)

  return [episodeLabel, `${item.container} ${strategyLabel}`]
    .filter(Boolean)
    .join(' | ')
}

function hasPlayerStarted(player: HTMLVideoElement) {
  return player.currentTime > 0.25
}

function getPlaybackStreamUrl(
  item: MediaItem,
  apiBase: string,
  strategy = getInitialPlaybackStrategy(item),
) {
  if (strategy === 'native' && isTvNativePlaybackCandidate(item)) {
    return resolveMediaUrl(item.streamUrl, apiBase)
  }

  return resolveMediaUrl(
    `/api/media/${encodeURIComponent(item.id)}/transcode`,
    apiBase,
  )
}

function getMediaPreviewVersion(item: MediaItem) {
  const modifiedAtMs = Date.parse(item.modifiedAt)
  const modifiedAtKey = Number.isFinite(modifiedAtMs)
    ? String(Math.floor(modifiedAtMs))
    : item.modifiedAt

  return `${item.sizeBytes}-${modifiedAtKey}`
}

function getScanPreviewVisualRequest(
  item: MediaItem,
  preview: ScanPreview,
  apiBase: string,
): ScanPreviewVisualRequest {
  const quality = preview.scanning ? 'low' : 'high'
  const bucketSeconds = getScanPreviewFrameBucketSeconds(preview)
  const framePosition = getScanPreviewFramePosition(
    preview.position,
    bucketSeconds,
  )

  if (!preview.scanning) {
    const url = getPreviewFrameUrl(item, apiBase, quality, framePosition)

    return {
      key: `image:${url}`,
      kind: 'image',
      url,
    }
  }

  const url = getPreviewSpriteUrl(item, apiBase, framePosition)

  return {
    key: `sprite:${url}`,
    kind: 'sprite',
    url,
  }
}

function getShortSeekPreviewVisualRequest(
  item: MediaItem,
  position: number,
  apiBase: string,
) {
  return getScanPreviewVisualRequest(
    item,
    {
      direction: 1,
      position,
      scanning: true,
      speedIndex: 0,
    },
    apiBase,
  )
}

function getShortSeekPreviewVisualRequests(
  item: MediaItem,
  position: number,
  duration: number,
  apiBase: string,
  direction?: ScanDirection,
) {
  const requests: ScanPreviewVisualRequest[] = []
  const requestKeys = new Set<string>()

  const addRequest = (clickOffset: number) => {
    const previewPosition = position + clickOffset * playerSeekStepSeconds

    if (previewPosition < 0 || previewPosition > duration) {
      return
    }

    const request = getShortSeekPreviewVisualRequest(
      item,
      previewPosition,
      apiBase,
    )

    if (!requestKeys.has(request.key)) {
      requests.push(request)
      requestKeys.add(request.key)
    }
  }

  addRequest(0)

  for (const clickOffset of getShortSeekPreviewClickOffsets(direction)) {
    addRequest(clickOffset)
  }

  return requests
}

function getShortSeekPreviewClickOffsets(direction?: ScanDirection) {
  const clickOffsets: number[] = []

  if (direction) {
    for (
      let clickOffset = 1;
      clickOffset <= playerShortSeekPreviewDirectionalClicks;
      clickOffset += 1
    ) {
      clickOffsets.push(direction * clickOffset)
    }

    for (
      let clickOffset = 1;
      clickOffset <= playerShortSeekPreviewBackgroundClicks;
      clickOffset += 1
    ) {
      clickOffsets.push(-direction * clickOffset)
    }

    return clickOffsets
  }

  for (
    let clickOffset = 1;
    clickOffset <= playerShortSeekPreviewBackgroundClicks;
    clickOffset += 1
  ) {
    clickOffsets.push(clickOffset, -clickOffset)
  }

  return clickOffsets
}

function getPreviewFrameUrl(
  item: MediaItem,
  apiBase: string,
  quality: 'high' | 'low',
  framePosition: number,
) {
  const params = new URLSearchParams({
    quality,
    t: String(Math.max(framePosition, 0)),
    v: getMediaPreviewVersion(item),
  })

  return resolveMediaUrl(
    `/api/media/${encodeURIComponent(item.id)}/preview-frame?${params}`,
    apiBase,
  )
}

function getPreviewSpriteUrl(
  item: MediaItem,
  apiBase: string,
  framePosition: number,
) {
  const params = new URLSearchParams({
    quality: 'low',
    t: String(Math.max(framePosition, 0)),
    v: getMediaPreviewVersion(item),
  })

  return resolveMediaUrl(
    `/api/media/${encodeURIComponent(item.id)}/preview-sprite?${params}`,
    apiBase,
  )
}

function getScanPreviewPreloadVisualRequests(
  item: MediaItem,
  preview: ScanPreview,
  apiBase: string,
  duration: number,
) {
  if (!preview.scanning) {
    return []
  }

  const bucketSeconds = getScanPreviewFrameBucketSeconds(preview)
  const framePosition = getScanPreviewFramePosition(
    preview.position,
    bucketSeconds,
  )
  const requests: ScanPreviewVisualRequest[] = []
  const requestKeys = new Set<string>()

  const preloadFrameCount = getScanPreviewPreloadFrameCount(preview)

  for (let index = 1; index <= preloadFrameCount; index += 1) {
    const preloadPosition =
      framePosition + preview.direction * bucketSeconds * index

    if (
      preloadPosition < 0 ||
      (duration > 0 && preloadPosition > duration)
    ) {
      continue
    }

    const url = getPreviewSpriteUrl(item, apiBase, preloadPosition)
    const request: ScanPreviewVisualRequest = {
      key: `sprite:${url}`,
      kind: 'sprite',
      url,
    }

    if (!requestKeys.has(request.key)) {
      requests.push(request)
      requestKeys.add(request.key)
    }
  }

  return requests
}

async function loadScanPreviewVisual(
  request: ScanPreviewVisualRequest,
  apiBase: string,
  markReady: (
    image: HTMLImageElement,
    url: string,
    onReady?: () => void,
  ) => void,
): Promise<ScanPreviewVisual> {
  if (request.kind === 'image') {
    await loadScanPreviewImage(request.url, markReady)

    return {
      key: request.key,
      kind: 'image',
      url: request.url,
    }
  }

  const response = await fetch(request.url)

  if (!response.ok) {
    throw new Error(`Preview sprite failed (${response.status})`)
  }

  const sprite = normalizePreviewSprite(await response.json())
  const sheetUrl = resolveMediaUrl(sprite.sheetUrl, apiBase)

  await loadScanPreviewImage(sheetUrl, markReady)

  return {
    column: sprite.column,
    columns: sprite.columns,
    key: request.key,
    kind: 'sprite',
    row: sprite.row,
    rows: sprite.rows,
    sheetUrl,
  }
}

function loadScanPreviewImage(
  url: string,
  markReady: (
    image: HTMLImageElement,
    url: string,
    onReady?: () => void,
  ) => void,
) {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const image = new Image()

    image.decoding = 'async'
    image.onload = () => {
      markReady(image, url, resolvePromise)
    }
    image.onerror = () => rejectPromise(new Error('Preview image failed'))
    image.src = url
  })
}

function normalizePreviewSprite(value: unknown): PreviewSpriteResponse {
  if (!isRecord(value)) {
    throw new Error('Invalid preview sprite')
  }

  return {
    column: Number(value.column),
    columns: Number(value.columns),
    row: Number(value.row),
    rows: Number(value.rows),
    sheetUrl: typeof value.sheetUrl === 'string' ? value.sheetUrl : '',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getScanPreviewVisualImageUrl(visual: ScanPreviewVisual) {
  return visual.kind === 'image' ? visual.url : visual.sheetUrl
}

function isPreviewVisualInActiveRetainedWindow(
  key: string,
  retainedWindow: ScanPreviewRetainedWindow | null,
) {
  return Boolean(
    retainedWindow &&
      isPreviewVisualInRetainedWindow(key, retainedWindow),
  )
}

function isPreviewVisualInRetainedWindow(
  key: string,
  retainedWindow: ScanPreviewRetainedWindow,
) {
  const url = getScanPreviewVisualUrlFromKey(key)

  if (!isPreviewUrlForRetainedWindow(url, retainedWindow)) {
    return false
  }

  const sheetIndex = getScanPreviewSheetIndex(getPreviewUrlFramePosition(url))

  return (
    sheetIndex >= retainedWindow.firstSheetIndex &&
    sheetIndex <= retainedWindow.lastSheetIndex
  )
}

function getScanPreviewVisualUrlFromKey(key: string) {
  const separatorIndex = key.indexOf(':')

  return separatorIndex >= 0 ? key.slice(separatorIndex + 1) : key
}

function isPreviewUrlForRetainedWindow(
  url: string,
  retainedWindow: ScanPreviewRetainedWindow,
) {
  try {
    const parsedUrl = new URL(url, window.location.origin)

    return (
      parsedUrl.pathname.includes(
        `/api/media/${encodeURIComponent(retainedWindow.itemId)}/`,
      ) && parsedUrl.searchParams.get('v') === retainedWindow.version
    )
  } catch {
    return false
  }
}

function getExpandedScanPreviewSpriteVisuals(
  request: ScanPreviewVisualRequest,
  visual: Extract<ScanPreviewVisual, { kind: 'sprite' }>,
) {
  const requestFramePosition = getPreviewUrlFramePosition(request.url)
  const columns = Math.max(Math.floor(visual.columns), 1)
  const rows = Math.max(Math.floor(visual.rows), 1)
  const frameIndex = Math.max(
    Math.round(requestFramePosition / scanPreviewLowFrameBucketSeconds),
    0,
  )
  const frameCount = columns * rows
  const sheetFrameCount =
    frameCount > 0 ? frameCount : scanPreviewSpriteFramesPerSheet
  const sheetStartFrameIndex =
    Math.floor(frameIndex / sheetFrameCount) * sheetFrameCount
  const expandedVisuals: Array<Extract<ScanPreviewVisual, { kind: 'sprite' }>> =
    []

  for (let index = 0; index < sheetFrameCount; index += 1) {
    const framePosition =
      (sheetStartFrameIndex + index) * scanPreviewLowFrameBucketSeconds

    expandedVisuals.push({
      column: index % columns,
      columns,
      key: `sprite:${setPreviewUrlFramePosition(request.url, framePosition)}`,
      kind: 'sprite',
      row: Math.floor(index / columns),
      rows,
      sheetUrl: visual.sheetUrl,
    })
  }

  return expandedVisuals
}

function getScanPreviewSpriteStyle(
  visual: Extract<ScanPreviewVisual, { kind: 'sprite' }>,
) {
  const xPercent =
    visual.columns <= 1 ? 0 : (visual.column / (visual.columns - 1)) * 100
  const yPercent =
    visual.rows <= 1 ? 0 : (visual.row / (visual.rows - 1)) * 100

  return {
    '--scan-sprite-background-size': `${visual.columns * 100}% ${
      visual.rows * 100
    }%`,
    backgroundImage: `url("${visual.sheetUrl}")`,
    backgroundPosition: `${xPercent}% ${yPercent}%`,
  } as CSSProperties
}

function getScanPreviewFramePosition(position: number, bucketSeconds: number) {
  return Math.max(Math.round(position / bucketSeconds) * bucketSeconds, 0)
}

function getScanPreviewCommitPosition(preview: ScanPreview, duration: number) {
  const bucketSeconds = getScanPreviewFrameBucketSeconds(preview)
  const framePosition = getScanPreviewFramePosition(
    preview.position,
    bucketSeconds,
  )
  const displayPosition = duration
    ? Math.min(framePosition, duration)
    : framePosition
  const targetPosition = displayPosition - scanPreviewCommitBacktrackSeconds

  return clamp(targetPosition, 0, duration || displayPosition)
}

function getScanPreviewFrameBucketSeconds(preview: ScanPreview) {
  if (!preview.scanning) {
    return scanPreviewHighFrameBucketSeconds
  }

  return scanPreviewLowFrameBucketSeconds
}

function getScanPreviewWarmSheetRadius(
  imageBytes: Map<string, number>,
  loadMs: number,
  transferBytes: number,
  bandwidthBytesPerSecond: number | null,
) {
  const sheetSeconds = getScanPreviewSheetSeconds()
  const effectiveLoadMs = getScanPreviewEffectiveLoadMs(
    loadMs,
    transferBytes,
    bandwidthBytesPerSecond,
  )
  const scanSecondsToCover =
    (effectiveLoadMs / 1000) *
    scanPreviewLoadSafetyMultiplier *
    getMaximumScanPreviewSecondsPerSecond()
  const latencyRadius = Math.ceil(scanSecondsToCover / sheetSeconds)

  return Math.min(
    clamp(
      latencyRadius,
      scanPreviewMinimumBufferedSheetsPerDirection,
      scanPreviewMaximumBufferedSheetsPerDirection,
    ),
    getScanPreviewBudgetedSheetRadius(imageBytes),
  )
}

function getScanPreviewRetainedSheetRadius(
  imageBytes: Map<string, number>,
  loadMs: number,
  transferBytes: number,
  bandwidthBytesPerSecond: number | null,
) {
  return Math.min(
    Math.max(
      getScanPreviewWarmSheetRadius(
        imageBytes,
        loadMs,
        transferBytes,
        bandwidthBytesPerSecond,
      ) + 1,
      scanPreviewMinimumRetainedSheetsPerDirection,
    ),
    getScanPreviewBudgetedSheetRadius(imageBytes),
  )
}

function getScanPreviewEffectiveLoadMs(
  loadMs: number,
  transferBytes: number,
  bandwidthBytesPerSecond: number | null,
) {
  if (!bandwidthBytesPerSecond || bandwidthBytesPerSecond <= 0) {
    return loadMs
  }

  return Math.max(loadMs, (transferBytes / bandwidthBytesPerSecond) * 1000)
}

function getScanPreviewBudgetedSheetRadius(imageBytes: Map<string, number>) {
  const estimatedSheetBytes = getAverageScanPreviewImageBytes(imageBytes)
  const sheetBudget = Math.max(
    Math.floor(scanPreviewClientCacheBudgetBytes / estimatedSheetBytes),
    1,
  )

  return clamp(
    Math.floor((sheetBudget - 1) / 2),
    0,
    scanPreviewMaximumBufferedSheetsPerDirection,
  )
}

function getAverageScanPreviewImageBytes(imageBytes: Map<string, number>) {
  const measuredBytes = Array.from(imageBytes.values()).filter(
    (bytes) => bytes > 0,
  )

  if (!measuredBytes.length) {
    return scanPreviewFallbackSheetBytes
  }

  return Math.max(
    measuredBytes.reduce((sum, bytes) => sum + bytes, 0) /
      measuredBytes.length,
    1,
  )
}

function getScanPreviewWarmSheetOffsets(radius: number) {
  const offsets: number[] = []

  for (let offset = 1; offset <= radius; offset += 1) {
    offsets.push(-offset, offset)
  }

  return offsets
}

function getScanPreviewResourceMetrics(
  request: ScanPreviewVisualRequest,
  visual: ScanPreviewVisual,
  startedAt: number,
) {
  const metrics = [
    getPreviewResourceMetrics(request.url, startedAt),
  ]

  if (visual.kind === 'sprite') {
    metrics.push(getPreviewResourceMetrics(visual.sheetUrl, startedAt))
  }

  return metrics.reduce<ScanPreviewResourceMetrics>(
    (combinedMetrics, currentMetrics) => ({
      bodyBytes: combinedMetrics.bodyBytes + currentMetrics.bodyBytes,
      durationMs: combinedMetrics.durationMs + currentMetrics.durationMs,
      networkBytes: combinedMetrics.networkBytes + currentMetrics.networkBytes,
    }),
    {
      bodyBytes: 0,
      durationMs: 0,
      networkBytes: 0,
    },
  )
}

function getPreviewResourceMetrics(url: string, startedAt: number) {
  const timing = getLatestPreviewResourceTiming(url, startedAt)

  if (!timing) {
    return {
      bodyBytes: 0,
      durationMs: 0,
      networkBytes: 0,
    }
  }

  const bodyBytes = Math.max(
    timing.encodedBodySize || timing.decodedBodySize || timing.transferSize,
    0,
  )

  return {
    bodyBytes,
    durationMs: Math.max(timing.duration, 0),
    networkBytes: Math.max(timing.transferSize, 0),
  }
}

function getLatestPreviewResourceTiming(url: string, startedAt: number) {
  if (typeof performance.getEntriesByType !== 'function') {
    return null
  }

  const candidateUrls = getPreviewTimingCandidateUrls(url)
  const entries = performance
    .getEntriesByType('resource')
    .filter((entry): entry is PerformanceResourceTiming => {
      return (
        entry.entryType === 'resource' &&
        candidateUrls.has(entry.name) &&
        entry.startTime >= startedAt - 50
      )
    })

  return entries.sort((first, second) => second.startTime - first.startTime)[0]
    ?? null
}

function getPreviewTimingCandidateUrls(url: string) {
  const urls = new Set([url])

  try {
    urls.add(new URL(url, window.location.origin).toString())
  } catch {
    return urls
  }

  return urls
}

function updateScanPreviewBandwidthEstimate(
  transferBytesRef: { current: number },
  bandwidthBytesPerSecondRef: { current: number | null },
  metrics: ScanPreviewResourceMetrics,
) {
  if (metrics.bodyBytes > 0) {
    transferBytesRef.current = updateWeightedScanPreviewAverage(
      transferBytesRef.current,
      metrics.bodyBytes,
    )
  }

  if (metrics.networkBytes <= 0 || metrics.durationMs <= 0) {
    return
  }

  const bytesPerSecond = metrics.networkBytes / (metrics.durationMs / 1000)

  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return
  }

  bandwidthBytesPerSecondRef.current =
    bandwidthBytesPerSecondRef.current === null
      ? bytesPerSecond
      : updateWeightedScanPreviewAverage(
          bandwidthBytesPerSecondRef.current,
          bytesPerSecond,
        )
}

function publishScanPreviewCacheStats(
  item: MediaItem,
  sheetIndex: number,
  warmRadius: number,
  retainedRadius: number,
  imageBytes: Map<string, number>,
  loadMs: number,
  transferBytes: number,
  bandwidthBytesPerSecond: number | null,
) {
  const memoryStats = getBrowserMemoryStats()
  const decodedCacheMiB = roundMetric(
    getTotalScanPreviewImageBytes(imageBytes) / (1024 * 1024),
    1,
  )
  const estimatedTotalMiB =
    memoryStats.usedMiB === null
      ? null
      : roundMetric(memoryStats.usedMiB + decodedCacheMiB, 1)
  const stats: ScanPreviewCacheStats = {
    appHeapLimitMiB: memoryStats.limitMiB,
    appHeapMiB: memoryStats.usedMiB,
    bandwidthMiBps: bandwidthBytesPerSecond
      ? roundMetric(bandwidthBytesPerSecond / (1024 * 1024), 2)
      : null,
    budgetMiB: roundMetric(scanPreviewClientCacheBudgetBytes / (1024 * 1024), 1),
    decodedCacheMiB,
    estimatedTotalMiB,
    estimatedSheetTransferKiB: Math.round(transferBytes / 1024),
    loadMs: Math.round(loadMs),
    retainedSheetsPerDirection: retainedRadius,
    sheetIndex,
    title: item.title,
    warmSheetsPerDirection: warmRadius,
  }
  const statsWindow = window as MyHomeMediaServerWindow

  statsWindow.HOME_MEDIA_SCAN_CACHE_STATS = stats

  return stats
}

function getFallbackScanPreviewCacheStats(
  item: MediaItem,
): ScanPreviewCacheStats {
  const memoryStats = getBrowserMemoryStats()

  return {
    appHeapLimitMiB: memoryStats.limitMiB,
    appHeapMiB: memoryStats.usedMiB,
    bandwidthMiBps: null,
    budgetMiB: roundMetric(scanPreviewClientCacheBudgetBytes / (1024 * 1024), 1),
    decodedCacheMiB: 0,
    estimatedSheetTransferKiB: Math.round(
      scanPreviewFallbackSheetTransferBytes / 1024,
    ),
    estimatedTotalMiB: memoryStats.usedMiB,
    loadMs: scanPreviewLoadFallbackMs,
    retainedSheetsPerDirection: scanPreviewMinimumRetainedSheetsPerDirection,
    sheetIndex: 0,
    title: item.title,
    warmSheetsPerDirection: scanPreviewMinimumBufferedSheetsPerDirection,
  }
}

function getTotalScanPreviewImageBytes(imageBytes: Map<string, number>) {
  return Array.from(imageBytes.values()).reduce(
    (totalBytes, imageByteCount) => totalBytes + imageByteCount,
    0,
  )
}

function roundMetric(value: number, digits: number) {
  const factor = 10 ** digits

  return Math.round(value * factor) / factor
}

function getBrowserMemoryStats() {
  const memory = (
    performance as Performance & {
      memory?: {
        jsHeapSizeLimit?: number
        totalJSHeapSize?: number
        usedJSHeapSize?: number
      }
    }
  ).memory
  const limitMiB = memory?.jsHeapSizeLimit
    ? roundMetric(memory.jsHeapSizeLimit / (1024 * 1024), 1)
    : null
  const totalMiB = memory?.totalJSHeapSize
    ? roundMetric(memory.totalJSHeapSize / (1024 * 1024), 1)
    : null
  const usedMiB = memory?.usedJSHeapSize
    ? roundMetric(memory.usedJSHeapSize / (1024 * 1024), 1)
    : null

  return {
    limitMiB,
    remainingMiB:
      limitMiB === null || usedMiB === null
        ? null
        : roundMetric(Math.max(limitMiB - usedMiB, 0), 1),
    totalMiB,
    usedMiB,
  }
}

function formatDebugMemory(value: number | null) {
  return value === null ? 'n/a' : `${value} MB`
}

function formatDebugBandwidth(value: number | null) {
  return value === null ? 'n/a' : `${value} MiB/s`
}

function updateScanPreviewLoadMs(
  loadMsRef: { current: number },
  loadMs: number,
) {
  if (!Number.isFinite(loadMs) || loadMs <= 0) {
    return
  }

  loadMsRef.current = updateWeightedScanPreviewAverage(
    loadMsRef.current,
    loadMs,
  )
}

function updateWeightedScanPreviewAverage(
  currentValue: number,
  nextValue: number,
) {
  return currentValue * 0.7 + nextValue * 0.3
}

function estimateDecodedImageBytes(image: HTMLImageElement) {
  const width = Number.isFinite(image.naturalWidth) ? image.naturalWidth : 0
  const height = Number.isFinite(image.naturalHeight) ? image.naturalHeight : 0

  return width > 0 && height > 0 ? width * height * 4 : 0
}

function getMaximumScanPreviewSecondsPerSecond() {
  return (
    scanSpeedMultipliers[scanSpeedMultipliers.length - 1] *
    scanPreviewBaseSecondsPerSecond
  )
}

function getScanPreviewSheetSeconds() {
  return scanPreviewLowFrameBucketSeconds * scanPreviewSpriteFramesPerSheet
}

function getScanPreviewSheetIndex(position: number) {
  return Math.floor(
    Math.max(position, 0) / getScanPreviewSheetSeconds(),
  )
}

function getScanPreviewSheetStartPosition(sheetIndex: number) {
  return sheetIndex * getScanPreviewSheetSeconds()
}

function getScanPreviewPreloadFrameCount(preview: ScanPreview) {
  const scanSecondsPerSecond =
    scanSpeedMultipliers[preview.speedIndex] * scanPreviewBaseSecondsPerSecond
  const framesPerSecond = Math.ceil(
    scanSecondsPerSecond / scanPreviewLowFrameBucketSeconds,
  )

  return clamp(
    framesPerSecond * scanPreviewPreloadLookaheadSeconds,
    scanPreviewPreloadMinimumFrames,
    scanPreviewPreloadMaximumFrames,
  )
}

function getPreviewUrlFramePosition(url: string) {
  try {
    const parsedUrl = new URL(url, window.location.origin)
    const framePosition = Number(parsedUrl.searchParams.get('t'))

    return Number.isFinite(framePosition) ? framePosition : 0
  } catch {
    return 0
  }
}

function setPreviewUrlFramePosition(url: string, framePosition: number) {
  try {
    const isAbsoluteUrl = /^[a-z][a-z\d+.-]*:\/\//i.test(url)
    const parsedUrl = new URL(url, window.location.origin)

    parsedUrl.searchParams.set('t', String(Math.max(framePosition, 0)))

    if (isAbsoluteUrl) {
      return parsedUrl.toString()
    }

    return `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`
  } catch {
    return url
  }
}

function getPrimaryActionLabel(
  title: TvTitle | null,
  item: MediaItem | null,
  playback: PlaybackRecord | null,
  isContinue: boolean,
) {
  if (!title) {
    return 'Play'
  }

  if (!isContinue) {
    return title.kind === 'show' ? 'Episodes' : 'Details'
  }

  const actionLabel = playback && !playback.completed ? 'Resume' : 'Play'

  if (title.kind === 'show' && item && hasEpisodeCode(item)) {
    return `${actionLabel} ${formatEpisodeNumber(item)}`
  }

  return actionLabel
}

function getTitleSubtitle(title: TvTitle, isContinue: boolean) {
  if (!isContinue || title.kind !== 'show') {
    return title.subtitle
  }

  const extraGroupLabel = getShowExtraGroupLabel(title.resumeItem)

  if (extraGroupLabel) {
    return `Extra - ${extraGroupLabel}`
  }

  const episodeNumber = title.resumeItem.episodeNumber

  return typeof episodeNumber === 'number'
    ? `Episode ${episodeNumber}`
    : title.subtitle
}

function getDefaultDetailItemIndex(title: TvTitle, history: PlaybackHistory) {
  const watchedItem = title.items
    .map((item, itemIndex) => ({
      itemIndex,
      record: history[item.id] ?? null,
    }))
    .filter((item) => item.record)
    .sort(
      (first, second) =>
        (second.record?.updatedAt ?? 0) - (first.record?.updatedAt ?? 0),
    )[0]

  if (watchedItem) {
    return watchedItem.itemIndex
  }

  const firstPlayableIndex = title.items.findIndex(isTvNativePlaybackCandidate)

  return Math.max(firstPlayableIndex, 0)
}

function getDetailItemLabel(item: MediaItem) {
  if (item.category !== 'show') {
    return item.container
  }

  return isShowExtraItem(item) ? 'Extra' : formatEpisodeNumber(item)
}

function getDetailItemTitle(item: MediaItem) {
  return item.episodeTitle ?? item.title
}

function hasEpisodeCode(item: MediaItem) {
  return !isShowExtraItem(item) && Boolean(item.seasonNumber || item.episodeNumber)
}

function getDetailPlaybackLabel(
  item: MediaItem,
  playback: PlaybackRecord | null,
) {
  if (!playback) {
    if (!item.browserPlayable && isTvNativePlaybackCandidate(item)) {
      return `${item.container} native first`
    }

    if (!isTvNativePlaybackCandidate(item)) {
      return `${item.container} transcode fallback`
    }

    return item.container
  }

  return playback.completed
    ? 'Watched'
    : `Resume ${formatDuration(playback.position)}`
}

function getDetailItemClassName(isSelected: boolean, isMenuSelected: boolean) {
  return [
    'tv-detail-item',
    isSelected ? 'selected' : '',
    isMenuSelected ? 'menu-selected' : '',
  ]
    .filter(Boolean)
    .join(' ')
}

function getPlayerEpisodeSwitchButtonClassName(isSelected: boolean) {
  return ['tv-player-episode-button', isSelected ? 'selected' : '']
    .filter(Boolean)
    .join(' ')
}

function getActionMenuEntries(menu: ActionMenuState): ActionMenuEntry[] {
  if (menu.kind === 'settings') {
    return [
      {
        id: 'toggle-prevent-sleep-while-paused',
        label: `Prevent sleep while paused: ${
          menu.preventSleepWhilePaused ? 'On' : 'Off'
        }`,
      },
    ]
  }

  if (menu.kind === 'title') {
    return menu.title.kind === 'show'
      ? [
          {
            id: 'mark-all-watched',
            label: 'Mark all as watched',
          },
          {
            id: 'mark-all-unwatched',
            label: 'Mark all as unwatched',
          },
        ]
      : [
          {
            id: 'mark-watched',
            label: 'Mark watched',
          },
          {
            id: 'mark-unwatched',
            label: 'Mark unwatched',
          },
        ]
  }

  const hasPrevious = menu.itemIndex > 0

  return [
    {
      id: 'mark-watched',
      label: 'Mark watched',
    },
    {
      id: 'mark-unwatched',
      label: 'Mark unwatched',
    },
    {
            disabled: !hasPrevious,
            id: 'mark-previous-watched',
            label: 'Mark previous as watched',
          },
          {
            disabled: !hasPrevious,
            id: 'mark-previous-unwatched',
            label: 'Mark previous as unwatched',
          },
  ]
}

function getActionMenuEyebrow(menu: ActionMenuState) {
  if (menu.kind === 'settings') {
    return 'TV settings'
  }

  if (menu.kind === 'title') {
    return menu.title.kind === 'show' ? 'Show actions' : 'Movie actions'
  }

  const item = menu.title.items[menu.itemIndex]

  return item ? getDetailItemLabel(item) : 'Episode actions'
}

function getActionMenuTitle(menu: ActionMenuState) {
  if (menu.kind === 'settings') {
    return 'Playback'
  }

  if (menu.kind === 'title') {
    return menu.title.title
  }

  const item = menu.title.items[menu.itemIndex]

  return item ? getDetailItemTitle(item) : menu.title.title
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

function getItemDisplayTitle(item: MediaItem) {
  return item.showTitle ?? item.title
}

function formatEpisodeNumber(item: MediaItem) {
  if (!item.seasonNumber && !item.episodeNumber) {
    return item.container
  }

  return `S${String(item.seasonNumber ?? 0).padStart(2, '0')}E${String(
    item.episodeNumber ?? 0,
  ).padStart(2, '0')}`
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

function formatPlayerClock(clock: PlayerClock) {
  return `${formatDuration(clock.position)} / ${
    clock.duration > 0 ? formatDuration(clock.duration) : '--:--'
  }`
}

function formatScanPreviewMode(preview: ScanPreview) {
  if (!preview.scanning) {
    return '0x Paused'
  }

  const directionLabel = preview.direction > 0 ? 'FF' : 'REW'

  return `${directionLabel} ${scanSpeedMultipliers[preview.speedIndex]}x`
}

function getSteppedScanPreview(
  preview: ScanPreview,
  direction: ScanDirection,
) {
  if (preview.direction === direction) {
    if (!preview.scanning) {
      return {
        ...preview,
        scanning: true,
        speedIndex: 0,
      }
    }

    return {
      ...preview,
      scanning: true,
      speedIndex: Math.min(
        preview.speedIndex + 1,
        scanSpeedMultipliers.length - 1,
      ),
    }
  }

  if (preview.speedIndex > 0) {
    return {
      ...preview,
      scanning: true,
      speedIndex: preview.speedIndex - 1,
    }
  }

  if (preview.scanning) {
    return {
      ...preview,
      scanning: false,
    }
  }

  return {
    ...preview,
    direction,
    scanning: true,
    speedIndex: 0,
  }
}

function getProgressPercent(position: number, duration: number) {
  if (duration <= 0) {
    return 0
  }

  return clamp((position / duration) * 100, 0, 100)
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
  return (
    Number.isInteger(value) &&
    value >= 0 &&
    value <= playerQuickJumpLastDigit
  )
    ? (value as QuickJumpDigit)
    : null
}

function getQuickJumpPosition(digit: QuickJumpDigit, duration: number) {
  return (duration * digit) / playerQuickJumpLastDigit
}

function getFiniteVideoDuration(video: HTMLVideoElement) {
  return Number.isFinite(video.duration) && video.duration > 0
    ? video.duration
    : 0
}

function sortByTitle(first: TvTitle, second: TvTitle) {
  return first.title.localeCompare(second.title, undefined, {
    numeric: true,
    sensitivity: 'base',
  })
}

function sortByLastWatched(first: TvTitle, second: TvTitle) {
  return (second.lastWatchedAt ?? 0) - (first.lastWatchedAt ?? 0)
}

function sortEpisodes(first: MediaItem, second: MediaItem) {
  const firstExtraLabel = getShowExtraGroupLabel(first)
  const secondExtraLabel = getShowExtraGroupLabel(second)

  if (Boolean(firstExtraLabel) !== Boolean(secondExtraLabel)) {
    return firstExtraLabel ? 1 : -1
  }

  if (firstExtraLabel && secondExtraLabel) {
    return (
      firstExtraLabel.localeCompare(secondExtraLabel, undefined, {
        numeric: true,
        sensitivity: 'base',
      }) ||
      first.title.localeCompare(second.title, undefined, {
        numeric: true,
        sensitivity: 'base',
      })
    )
  }

  return (
    (first.seasonNumber ?? 0) - (second.seasonNumber ?? 0) ||
    (first.episodeNumber ?? 0) - (second.episodeNumber ?? 0) ||
    first.title.localeCompare(second.title, undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getLibraryConnectionStatus(
  phase: LibraryConnectionPhase,
  apiBase: string,
) {
  const serverLabel = getLibraryServerLabel(apiBase)

  if (phase === 'loading') {
    return {
      detail: `Server: ${serverLabel}. Request: /api/library. Timeout: ${formatMillisecondsAsSeconds(
        libraryRequestTimeoutMs,
      )} seconds.`,
      title: 'Loading library',
    }
  }

  if (phase === 'polling') {
    return {
      detail: `Server: ${serverLabel}. Polling /api/client-profile every ${formatMillisecondsAsSeconds(
        libraryConnectionPollIntervalMs,
      )} seconds; probe timeout ${formatMillisecondsAsSeconds(
        libraryConnectionPollTimeoutMs,
      )} seconds.`,
      title: 'Retrying server connection',
    }
  }

  return null
}

function getLibraryConnectionStatusClassName(phase: LibraryConnectionPhase) {
  return ['tv-loading', phase === 'polling' ? 'retrying' : '']
    .filter(Boolean)
    .join(' ')
}

function getLibraryRequestTimeoutError(apiBase: string): LibraryErrorState {
  return {
    diagnostics: getLibraryRequestDiagnosticLines(null, apiBase),
    message: `Library request timed out after ${
      libraryRequestTimeoutMs / 1000
    } seconds. Check that My Home Media Server is running at ${getLibraryServerLabel(
      apiBase,
    )} and reachable from this TV. The TV will keep checking every ${
      libraryConnectionPollIntervalMs / 1000
    } seconds.`,
  }
}

function getLibraryRequestError(
  error: unknown,
  apiBase: string,
): LibraryErrorState {
  const message = getErrorMessage(error)

  if (isLibraryConnectionErrorMessage(message)) {
    return {
      diagnostics: getLibraryRequestDiagnosticLines(error, apiBase),
      message: `${message}. Check that My Home Media Server is running at ${getLibraryServerLabel(
        apiBase,
      )} and that this TV is on the same network. The TV will keep checking every ${
        libraryConnectionPollIntervalMs / 1000
      } seconds.`,
    }
  }

  return {
    diagnostics: getLibraryRequestDiagnosticLines(error, apiBase),
    message,
  }
}

function isLibraryConnectionFailure(error: unknown, didTimeOut: boolean) {
  return didTimeOut || isLibraryConnectionErrorMessage(getErrorMessage(error))
}

function isLibraryConnectionErrorMessage(message: string) {
  return /failed to fetch|load failed|network|connection|refused/i.test(message)
}

function getLibraryServerLabel(apiBase: string) {
  return apiBase || 'this host'
}

function formatMillisecondsAsSeconds(milliseconds: number) {
  const seconds = milliseconds / 1000

  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1)
}

function persistLocalTvDiagnostics(events: TvDiagnosticEvent[]) {
  try {
    window.localStorage.setItem(
      tvDiagnosticsStorageKey,
      JSON.stringify({
        events: events.slice(-tvDiagnosticsMaxLocalEvents),
        maxEvents: tvDiagnosticsMaxLocalEvents,
        updatedAt: new Date().toISOString(),
      }),
    )
  } catch {
    // Local storage is a best-effort fallback; the server-side capped log is primary.
  }
}

function readTvDomDiagnostics(): TvDiagnosticDetail {
  return {
    activeElement: describeElement(document.activeElement),
    elements: {
      avplay: getElementDiagnostic('.tv-avplay-stage'),
      blackout: getElementDiagnostic('.tv-player-blackout'),
      episodeSwitch: getElementDiagnostic('.tv-player-episode-switch'),
      player: getElementDiagnostic('.tv-player'),
      playerInfo: getElementDiagnostic('.tv-player-info'),
      playerShell: getElementDiagnostic('.tv-player-shell'),
      scanThumbnail: getElementDiagnostic('.tv-scan-thumbnail'),
      shortSeekPreview: getElementDiagnostic('.tv-short-seek-preview'),
    },
    hitTests: {
      center: getElementsFromPointDiagnostic(
        window.innerWidth / 2,
        window.innerHeight / 2,
      ),
      lowerLeft: getElementsFromPointDiagnostic(48, window.innerHeight - 48),
      lowerMiddle: getElementsFromPointDiagnostic(
        window.innerWidth / 2,
        window.innerHeight - 48,
      ),
    },
    viewport: {
      devicePixelRatio: window.devicePixelRatio,
      height: window.innerHeight,
      screenHeight: window.screen.height,
      screenWidth: window.screen.width,
      width: window.innerWidth,
    },
  }
}

function getElementDiagnostic(selector: string): TvDiagnosticDetail {
  const element = document.querySelector(selector)

  if (!element) {
    return {
      exists: false,
      selector,
    }
  }

  const rect = element.getBoundingClientRect()
  const style = window.getComputedStyle(element)

  return {
    className: getElementClassName(element),
    exists: true,
    id: element.id || null,
    rect: {
      bottom: roundDiagnosticNumber(rect.bottom),
      height: roundDiagnosticNumber(rect.height),
      left: roundDiagnosticNumber(rect.left),
      right: roundDiagnosticNumber(rect.right),
      top: roundDiagnosticNumber(rect.top),
      width: roundDiagnosticNumber(rect.width),
    },
    selector,
    style: {
      backgroundColor: style.backgroundColor,
      display: style.display,
      opacity: style.opacity,
      pointerEvents: style.pointerEvents,
      position: style.position,
      transform: style.transform,
      visibility: style.visibility,
      zIndex: style.zIndex,
    },
    tagName: element.tagName,
    textLength: element.textContent?.length ?? 0,
  }
}

function getElementsFromPointDiagnostic(x: number, y: number) {
  try {
    return document
      .elementsFromPoint(x, y)
      .slice(0, 8)
      .map(describeElement)
  } catch {
    return []
  }
}

function describeElement(element: Element | null): TvDiagnosticDetail | null {
  if (!element) {
    return null
  }

  return {
    className: getElementClassName(element),
    id: element.id || null,
    tagName: element.tagName,
  }
}

function getElementClassName(element: Element) {
  return typeof element.className === 'string'
    ? element.className.slice(0, 200)
    : ''
}

function roundDiagnosticNumber(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0
}

function getLibraryRequestDiagnosticLines(error: unknown, apiBase: string) {
  return [
    `Request URL: ${buildApiUrl('/api/library', apiBase)}`,
    `Server URL: ${getLibraryServerLabel(apiBase)}`,
    `Page URL: ${window.location.href}`,
    `Network: navigator.onLine=${String(navigator.onLine)}`,
    `Document: hidden=${String(document.hidden)}, visibility=${
      document.visibilityState
    }`,
    `User agent: ${navigator.userAgent}`,
    ...formatErrorDiagnosticLines(error),
  ]
}

function formatErrorDiagnosticLines(
  error: unknown,
  label = 'Error',
  seen = new Set<unknown>(),
): string[] {
  if (error === null) {
    return []
  }

  if (seen.has(error)) {
    return [`${label}: circular reference`]
  }

  if (typeof error === 'object' || typeof error === 'function') {
    seen.add(error)
  }

  if (error instanceof Error) {
    const lines = [`${label}: ${error.name}: ${error.message || '(empty message)'}`]
    const extraProperties = formatErrorExtraProperties(error)
    const stack = formatErrorStack(error.stack)
    const cause = (error as Error & { cause?: unknown }).cause

    if (extraProperties) {
      lines.push(`${label} properties: ${extraProperties}`)
    }

    if (cause !== undefined) {
      lines.push(...formatErrorDiagnosticLines(cause, `${label} cause`, seen))
    }

    if (stack) {
      lines.push(`${label} stack: ${stack}`)
    }

    return lines
  }

  if (isRecord(error)) {
    return [
      `${label}: ${getObjectTypeName(error)} ${formatErrorExtraProperties(
        error,
      )}`.trim(),
    ]
  }

  if (error === undefined) {
    return [`${label}: undefined`]
  }

  return [`${label}: ${String(error)}`]
}

function formatErrorExtraProperties(value: object) {
  const record = value as Record<string, unknown>
  const propertyNames = Array.from(
    new Set([
      'code',
      'errno',
      'type',
      'status',
      'statusCode',
      'statusText',
      'eventType',
      'eventMessage',
      ...Object.keys(record),
    ]),
  ).filter(
    (propertyName) =>
      !['cause', 'message', 'name', 'stack'].includes(propertyName) &&
      record[propertyName] !== undefined,
  )

  return propertyNames
    .slice(0, 12)
    .map(
      (propertyName) =>
        `${propertyName}=${formatDiagnosticValue(record[propertyName])}`,
    )
    .join('; ')
}

function formatErrorStack(stack: string | undefined) {
  if (!stack) {
    return ''
  }

  return stack
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6)
    .join(' | ')
}

function formatDiagnosticValue(value: unknown) {
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }

  if (isRecord(value)) {
    try {
      return truncateDiagnosticValue(JSON.stringify(value))
    } catch {
      return getObjectTypeName(value)
    }
  }

  return truncateDiagnosticValue(String(value))
}

function truncateDiagnosticValue(value: string) {
  return value.length > 220 ? `${value.slice(0, 217)}...` : value
}

function getObjectTypeName(value: object) {
  return Object.prototype.toString.call(value)
}

function pulseTvUiCompositor(recoveryIndex: number) {
  try {
    const pulseValue = String(recoveryIndex)
    const pulseClassName = 'tv-ui-compositor-pulse'
    const elements = new Set<HTMLElement>()
    const addElement = (element: HTMLElement | null) => {
      if (element) {
        elements.add(element)
      }
    }
    const selectors = [
      '.tv-action-menu',
      '.tv-player-blackout',
      '.tv-player-episode-switch',
      '.tv-player-info',
      '.tv-player-shell',
      '.tv-scan-thumbnail',
      '.tv-short-seek-preview',
    ]

    addElement(document.documentElement)
    addElement(document.body)

    for (const selector of selectors) {
      for (const element of document.querySelectorAll<HTMLElement>(selector)) {
        addElement(element)
      }
    }

    for (const element of elements) {
      element.classList.remove(pulseClassName)
      element.dataset.tvUiRecoveryPulse = pulseValue
      element.style.setProperty('--tv-ui-recovery-pulse', pulseValue)
    }

    void document.body?.offsetHeight

    for (const element of elements) {
      element.classList.add(pulseClassName)
    }

    void document.body?.offsetHeight

    const clearPulse = () => {
      for (const element of elements) {
        element.classList.remove(pulseClassName)
      }
    }

    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(clearPulse)
      })
      return
    }

    window.setTimeout(clearPulse, 120)
  } catch {
    // Compositor nudges are best-effort and must never affect playback.
  }
}

function setTvPlayerKeepAwake(
  keepAwake: boolean,
  detail: TvDiagnosticDetail = {},
): TvDiagnosticDetail {
  const tvWindow = window as MyHomeMediaServerWindow
  const appcommon = tvWindow.webapis?.appcommon
  const screenSaverState = keepAwake
    ? appcommon?.AppCommonScreenSaverState?.SCREEN_SAVER_OFF
    : appcommon?.AppCommonScreenSaverState?.SCREEN_SAVER_ON
  const nextDetail: TvDiagnosticDetail = {
    ...detail,
    keepAwake,
  }

  if (!appcommon?.setScreenSaver) {
    nextDetail.screenSaver = 'unavailable'
  } else if (screenSaverState === undefined) {
    nextDetail.screenSaver = 'missing-state'
  } else {
    try {
      appcommon.setScreenSaver(
        screenSaverState,
        () => undefined,
        () => undefined,
      )
      nextDetail.screenSaver = 'ok'
      nextDetail.screenSaverState = String(screenSaverState)
    } catch (error) {
      nextDetail.screenSaver = 'failed'
      nextDetail.screenSaverError = getErrorMessage(error)
    }
  }

  const power = tvWindow.tizen?.power

  if (!power?.request && !power?.release) {
    nextDetail.power = 'unavailable'
  } else {
    try {
      if (keepAwake) {
        power.request?.('SCREEN', 'SCREEN_NORMAL')
      } else {
        power.release?.('SCREEN')
      }

      nextDetail.power = 'ok'
    } catch (error) {
      nextDetail.power = 'failed'
      nextDetail.powerError = getErrorMessage(error)
    }
  }

  return nextDetail
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

function getCurrentTimestamp() {
  return Date.now()
}

export default TvApp
