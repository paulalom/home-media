import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react'

type MediaCategory = 'movie' | 'show' | 'other'
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

type PlaybackRecord = {
  completed: boolean
  duration: number
  position: number
  updatedAt: number
}

type PlaybackHistory = Record<string, PlaybackRecord>

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

type FocusPosition = {
  itemIndex: number
  sectionIndex: number
}

type DetailState = {
  itemIndex: number
  title: TvTitle
}

type HomeMediaWindow = Window & {
  HOME_MEDIA_CONFIG?: {
    apiBase?: string
  }
  tizen?: {
    tvinputdevice?: {
      registerKey?: (key: string) => void
      registerKeyBatch?: (keys: string[]) => void
    }
  }
}

const apiBaseStorageKey = 'home-media-api-base-v1'
const playbackStorageKey = 'home-media-playback-v1'
const maxRowItems = 28
const samsungMediaKeys = ['MediaPlayPause', 'MediaPlay', 'MediaPause']

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

function TvApp() {
  const [apiBase] = useState(readInitialApiBase)
  const [canLoadArtwork, setCanLoadArtwork] = useState(false)
  const [detailState, setDetailState] = useState<DetailState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusPosition>({
    itemIndex: 0,
    sectionIndex: 0,
  })
  const [isLoading, setIsLoading] = useState(true)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackHistory>(
    readPlaybackHistory,
  )
  const [playerItem, setPlayerItem] = useState<MediaItem | null>(null)
  const playbackHistoryRef = useRef(playbackHistory)
  const detailListRef = useRef<HTMLDivElement | null>(null)
  const detailSelectedItemRef = useRef<HTMLButtonElement | null>(null)
  const lastPlaybackWriteRef = useRef<Record<string, number>>({})
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const rowsRef = useRef<HTMLElement | null>(null)
  const selectedCardRef = useRef<HTMLButtonElement | null>(null)
  const selectedRowRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    playbackHistoryRef.current = playbackHistory
    window.localStorage.setItem(
      playbackStorageKey,
      JSON.stringify(playbackHistory),
    )
  }, [playbackHistory])

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
    const controller = new AbortController()

    fetchLibrary(apiBase, controller.signal)
      .then((nextLibrary) => {
        setLibrary(nextLibrary)
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
  const selectedTitleIsContinue = activeSection?.id === 'continue'
  const detailTitle = detailState?.title ?? null
  const detailItemIndex = detailTitle
    ? clamp(
        detailState?.itemIndex ?? 0,
        0,
        Math.max(detailTitle.items.length - 1, 0),
      )
    : 0
  const detailItem = detailTitle?.items[detailItemIndex] ?? null
  const detailPlayback = detailItem ? playbackHistory[detailItem.id] ?? null : null

  useEffect(() => {
    const selectedCard = selectedCardRef.current
    const row = selectedCard?.parentElement

    if (!selectedCard || !row) {
      return
    }

    row.scrollLeft = Math.max(
      selectedCard.offsetLeft - row.clientWidth / 2 + selectedCard.clientWidth / 2,
      0,
    )
  }, [safeFocus.itemIndex, safeFocus.sectionIndex])

  useEffect(() => {
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
  }, [safeFocus.sectionIndex])

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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const action = getRemoteAction(event)

      if (!action) {
        return
      }

      event.preventDefault()

      if (playerItem) {
        handlePlayerAction(action)
        return
      }

      if (detailTitle) {
        handleDetailAction(action)
        return
      }

      handleBrowseAction(action)
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  function handleBrowseAction(action: RemoteAction) {
    if (action === 'enter' || action === 'play' || action === 'playPause') {
      activateTitle(activeSection, selectedTitle)
      return
    }

    if (action === 'left' || action === 'right') {
      moveFocus(0, action === 'right' ? 1 : -1)
      return
    }

    if (action === 'up' || action === 'down') {
      moveFocus(action === 'down' ? 1 : -1, 0)
    }
  }

  function handleDetailAction(action: RemoteAction) {
    if (action === 'back') {
      closeDetail()
      return
    }

    if (action === 'enter' || action === 'play' || action === 'playPause') {
      startPlayback(detailItem)
      return
    }

    if (
      action === 'down' ||
      action === 'right' ||
      action === 'up' ||
      action === 'left'
    ) {
      moveDetailFocus(action === 'down' || action === 'right' ? 1 : -1)
    }
  }

  function handlePlayerAction(action: RemoteAction) {
    if (action === 'back') {
      closePlayer()
      return
    }

    if (action === 'play') {
      playPlayer()
      return
    }

    if (action === 'pause') {
      pausePlayer()
      return
    }

    if (action === 'enter' || action === 'playPause') {
      togglePlayer()
      return
    }

    if (action === 'left' || action === 'right') {
      skipPlayer(action === 'right' ? 30 : -10)
    }
  }

  function moveFocus(sectionDelta: number, itemDelta: number) {
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
        itemIndex: nextItemIndex,
        sectionIndex: nextSectionIndex,
      }
    })
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
      itemIndex: getDefaultDetailItemIndex(title, playbackHistoryRef.current),
      title,
    })
  }

  function closeDetail() {
    setDetailState(null)
  }

  function moveDetailFocus(delta: number) {
    setDetailState((currentState) => {
      if (!currentState) {
        return currentState
      }

      return {
        ...currentState,
        itemIndex: clamp(
          currentState.itemIndex + delta,
          0,
          Math.max(currentState.title.items.length - 1, 0),
        ),
      }
    })
  }

  function startPlayback(item: MediaItem | null) {
    if (!item?.browserPlayable) {
      return
    }

    setPlayerItem(item)
  }

  function closePlayer() {
    if (playerItem && playerRef.current) {
      recordPlayback(playerItem, playerRef.current, true)
      playerRef.current.pause()
    }

    setPlayerItem(null)
  }

  function playPlayer() {
    const player = playerRef.current

    if (player) {
      void player.play()
    }
  }

  function pausePlayer() {
    playerRef.current?.pause()
  }

  function togglePlayer() {
    const player = playerRef.current

    if (!player) {
      return
    }

    if (player.paused) {
      void player.play()
    } else {
      player.pause()
    }
  }

  function skipPlayer(seconds: number) {
    const player = playerRef.current

    if (!player) {
      return
    }

    player.currentTime = clamp(
      player.currentTime + seconds,
      0,
      Number.isFinite(player.duration) ? player.duration : player.currentTime,
    )
  }

  function handleLoadedMetadata(
    item: MediaItem,
    event: SyntheticEvent<HTMLVideoElement>,
  ) {
    const video = event.currentTarget
    const resumePosition = getResumePosition(
      playbackHistoryRef.current[item.id] ?? null,
      video.duration,
    )

    if (resumePosition > 0) {
      video.currentTime = resumePosition
    }

    void video.play()
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

    const now = Date.now()

    if (!force && now - (lastPlaybackWriteRef.current[item.id] ?? 0) < 5000) {
      return
    }

    lastPlaybackWriteRef.current[item.id] = now
    setPlaybackHistory((currentHistory) => ({
      ...currentHistory,
      [item.id]: {
        completed: position / duration >= 0.95,
        duration,
        position,
        updatedAt: now,
      },
    }))
  }

  if (playerItem) {
    return (
      <main className="tv-player-shell">
        <video
          autoPlay
          className="tv-player"
          controls
          key={playerItem.id}
          onEnded={(event) => {
            recordPlayback(playerItem, event.currentTarget, true)
            setPlayerItem(null)
          }}
          onLoadedMetadata={(event) => handleLoadedMetadata(playerItem, event)}
          onPause={(event) =>
            recordPlayback(playerItem, event.currentTarget, true)
          }
          onTimeUpdate={(event) => recordPlayback(playerItem, event.currentTarget)}
          ref={playerRef}
          src={resolveMediaUrl(playerItem.streamUrl, apiBase)}
        />
        <div className="tv-player-info">
          <strong>{getItemDisplayTitle(playerItem)}</strong>
          <span>{formatEpisodeNumber(playerItem)}</span>
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
            <h1>{detailTitle.title}</h1>
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
            <h2>{detailTitle.kind === 'show' ? 'Episodes' : 'Title'}</h2>
            <span>{detailTitle.items.length}</span>
          </div>
          <div className="tv-detail-list" ref={detailListRef}>
            {detailTitle.items.map((item, itemIndex) => {
              const isSelected = detailItemIndex === itemIndex
              const playback = playbackHistory[item.id] ?? null

              return (
                <button
                  className={
                    isSelected ? 'tv-detail-item selected' : 'tv-detail-item'
                  }
                  key={item.id}
                  onClick={() => {
                    setDetailState({
                      itemIndex,
                      title: detailTitle,
                    })
                    startPlayback(item)
                  }}
                  ref={isSelected ? detailSelectedItemRef : null}
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
              )
            })}
          </div>
        </section>
      </main>
    )
  }

  return (
    <main className="tv-shell">
      <header className="tv-topbar">
        <div>
          <p>Home Media</p>
          <h1>{selectedTitle?.title ?? 'Loading library'}</h1>
        </div>
        <div className="tv-status">
          <span>{library ? `${library.summary.totalVideos} files` : '...'}</span>
          <strong>{apiBase || 'Local package'}</strong>
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
          <p>{selectedTitle?.subtitle ?? 'Preparing your media'}</p>
          <h2>{selectedTitle?.title ?? 'Home Media'}</h2>
          <div className="tv-hero-meta">
            <span>{selectedItem?.container ?? '...'}</span>
            <span>{selectedTitle?.source ?? 'Server'}</span>
            {selectedPlayback && !selectedPlayback.completed ? (
              <span>{formatDuration(selectedPlayback.position)}</span>
            ) : null}
          </div>
          <button
            className="tv-primary-action"
            disabled={!selectedItem?.browserPlayable}
            onClick={() => activateTitle(activeSection, selectedTitle)}
            type="button"
          >
            {getPrimaryActionLabel(
              selectedTitle,
              selectedPlayback,
              selectedTitleIsContinue,
            )}
          </button>
        </div>
      </section>

      {error ? <section className="tv-error">{error}</section> : null}

      {isLoading ? (
        <section className="tv-loading">Loading library</section>
      ) : sections.length ? (
        <section className="tv-rows" aria-label="Media rows" ref={rowsRef}>
          {sections.map((section, sectionIndex) => {
            const shouldLoadArtwork =
              canLoadArtwork &&
              Math.abs(sectionIndex - safeFocus.sectionIndex) <= 1

            return (
              <section
                className="tv-row"
                key={section.id}
                ref={
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
                          setFocus({ itemIndex, sectionIndex })
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
                        ) : null}
                        <span>{title.kind === 'show' ? 'TV' : 'Movie'}</span>
                        <strong>{title.title}</strong>
                        <p>{title.subtitle}</p>
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
        <section className="tv-loading">No playable titles found</section>
      )}
    </main>
  )
}

function buildTvSections(
  items: MediaItem[],
  history: PlaybackHistory,
): TvSection[] {
  const titles = buildTvTitles(items, history).filter((title) =>
    Boolean(title.resumeItem.browserPlayable),
  )
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

    const showTitle = item.showTitle ?? item.title
    const key = `${item.source}:${showTitle.toLowerCase()}`
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
      subtitle: `${sortedEpisodes.length} episodes`,
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
    return episodes.find((episode) => episode.browserPlayable) ?? episodes[0]
  }

  const watchedRecord = history[watchedEpisode.id]

  if (!watchedRecord.completed) {
    return watchedEpisode
  }

  const watchedIndex = episodes.findIndex(
    (episode) => episode.id === watchedEpisode.id,
  )

  return (
    episodes.slice(watchedIndex + 1).find((episode) => episode.browserPlayable) ??
    watchedEpisode
  )
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
    itemIndex,
    sectionIndex,
  }
}

function getRemoteAction(event: KeyboardEvent): RemoteAction | null {
  if (event.key === 'ArrowUp' || event.keyCode === 38) {
    return 'up'
  }

  if (event.key === 'ArrowDown' || event.keyCode === 40) {
    return 'down'
  }

  if (event.key === 'ArrowLeft' || event.keyCode === 37) {
    return 'left'
  }

  if (event.key === 'ArrowRight' || event.keyCode === 39) {
    return 'right'
  }

  if (event.key === 'Enter' || event.keyCode === 13) {
    return 'enter'
  }

  if (
    event.key === 'MediaPlay' ||
    event.key === 'Play' ||
    event.keyCode === 415
  ) {
    return 'play'
  }

  if (
    event.key === 'MediaPause' ||
    event.key === 'Pause' ||
    event.keyCode === 19
  ) {
    return 'pause'
  }

  if (
    event.key === 'MediaPlayPause' ||
    event.keyCode === 10252
  ) {
    return 'playPause'
  }

  if (
    event.key === 'BrowserBack' ||
    event.key === 'Escape' ||
    event.key === 'XF86Back' ||
    event.keyCode === 10009
  ) {
    return 'back'
  }

  return null
}

function registerSamsungRemoteKeys() {
  const tvInputDevice = (window as HomeMediaWindow).tizen?.tvinputdevice

  try {
    if (tvInputDevice?.registerKeyBatch) {
      tvInputDevice.registerKeyBatch(samsungMediaKeys)
      return
    }

    for (const key of samsungMediaKeys) {
      tvInputDevice?.registerKey?.(key)
    }
  } catch {
    // Browsers and some TV runtimes can reject key registration; keydown still works there.
  }
}

function readPlaybackHistory(): PlaybackHistory {
  try {
    const value = window.localStorage.getItem(playbackStorageKey)

    return value ? (JSON.parse(value) as PlaybackHistory) : {}
  } catch {
    return {}
  }
}

function hideFailedArtwork(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.hidden = true
}

function readInitialApiBase() {
  try {
    const params = new URLSearchParams(window.location.search)
    const queryApiBase = params.get('api') ?? params.get('server')
    const runtimeApiBase = (window as HomeMediaWindow).HOME_MEDIA_CONFIG?.apiBase
    const storedApiBase = window.localStorage.getItem(apiBaseStorageKey)

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

function getPrimaryActionLabel(
  title: TvTitle | null,
  playback: PlaybackRecord | null,
  isContinue: boolean,
) {
  if (!title) {
    return 'Play'
  }

  if (!isContinue) {
    return title.kind === 'show' ? 'Episodes' : 'Details'
  }

  return playback && !playback.completed ? 'Resume' : 'Play'
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

  const firstPlayableIndex = title.items.findIndex(
    (item) => item.browserPlayable,
  )

  return Math.max(firstPlayableIndex, 0)
}

function getDetailItemLabel(item: MediaItem) {
  return item.category === 'show' ? formatEpisodeNumber(item) : item.container
}

function getDetailItemTitle(item: MediaItem) {
  return item.episodeTitle ?? item.title
}

function getDetailPlaybackLabel(
  item: MediaItem,
  playback: PlaybackRecord | null,
) {
  if (!item.browserPlayable) {
    return `${item.container} indexed`
  }

  if (!playback) {
    return item.container
  }

  return playback.completed
    ? 'Watched'
    : `Resume ${formatDuration(playback.position)}`
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

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Unexpected error'
}

export default TvApp
