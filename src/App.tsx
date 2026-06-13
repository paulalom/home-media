import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
} from 'react'
import {
  AlertCircle,
  Clapperboard,
  Database,
  FileVideo,
  FolderSearch,
  HardDrive,
  LayoutGrid,
  LoaderCircle,
  Play,
  Radio,
  RefreshCcw,
  Search,
  Server,
  Settings,
  SlidersHorizontal,
  Tv,
  Video,
  type LucideIcon,
} from 'lucide-react'
import './App.css'

type MediaCategory = 'movie' | 'show' | 'other'
type ViewMode = 'Home' | 'Movies' | 'TV Shows'

type MediaItem = {
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

type PlaybackRecord = {
  completed: boolean
  duration: number
  position: number
  updatedAt: number
}

type PlaybackHistory = Record<string, PlaybackRecord>

type MovieTitle = {
  id: string
  kind: 'movie'
  title: string
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
  mode: ViewMode
}

type StatItem = {
  label: string
  value: string
  icon: LucideIcon
}

const playbackStorageKey = 'home-media-playback-v1'
const viewModes: ViewMode[] = ['Home', 'Movies', 'TV Shows']

async function fetchLibrary(signal?: AbortSignal) {
  const response = await fetch('/api/library', {
    cache: 'no-store',
    signal,
  })

  if (!response.ok) {
    throw new Error(`Library scan failed (${response.status})`)
  }

  return (await response.json()) as LibraryResponse
}

function App() {
  const [activeView, setActiveView] = useState<ViewMode>('Home')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [playbackHistory, setPlaybackHistory] = useState<PlaybackHistory>(
    readPlaybackHistory,
  )
  const [query, setQuery] = useState('')
  const [scanRunning, setScanRunning] = useState(false)
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(
    null,
  )
  const [selectedTitleId, setSelectedTitleId] = useState<string | null>(null)
  const playbackHistoryRef = useRef(playbackHistory)
  const lastPlaybackWriteRef = useRef<Record<string, number>>({})
  const playerRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    playbackHistoryRef.current = playbackHistory
    window.localStorage.setItem(
      playbackStorageKey,
      JSON.stringify(playbackHistory),
    )
  }, [playbackHistory])

  useEffect(() => {
    const controller = new AbortController()

    fetchLibrary(controller.signal)
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
  }, [])

  const collections = useMemo(
    () => buildCollections(library?.items ?? [], playbackHistory),
    [library?.items, playbackHistory],
  )

  const selectedTitle = useMemo(
    () =>
      collections.all.find((title) => title.id === selectedTitleId) ??
      getInitialSelection(collections),
    [collections, selectedTitleId],
  )

  const selectedItem = getSelectedItem(selectedTitle, selectedEpisodeId)
  const selectedPlayback = selectedItem
    ? playbackHistory[selectedItem.id] ?? null
    : null
  const recentMovies = collections.movies
    .filter((title) => title.lastWatchedAt)
    .sort(sortByLastWatched)
  const recentShows = collections.shows
    .filter((title) => title.lastWatchedAt)
    .sort(sortByLastWatched)
  const filteredMovies = filterTitles(collections.movies, query)
  const filteredShows = filterTitles(collections.shows, query)

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
      const nextLibrary = await fetchLibrary()
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

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <div className="brand-mark">
            <Radio size={24} />
          </div>
          <div>
            <p className="eyebrow">Local server</p>
            <h1>Home Media</h1>
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
                onClick={() => setActiveView(item.mode)}
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

        <div className="server-card">
          <div className="server-icon">
            <Server size={20} />
          </div>
          <div>
            <p className="muted">Source</p>
            <strong>{library?.summary.root ?? 'F:/media'}</strong>
          </div>
          <span className="status-dot" aria-label="Online" />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} />
            <input
              aria-label="Search library"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search titles"
              value={query}
            />
          </div>
          <div className="topbar-actions">
            <button className="icon-button" title="Filters" type="button">
              <SlidersHorizontal size={19} />
            </button>
            <button className="icon-button" title="Settings" type="button">
              <Settings size={19} />
            </button>
            <button
              className="primary-button"
              disabled={scanRunning}
              onClick={startScan}
              type="button"
            >
              <RefreshCcw size={18} />
              {scanRunning ? 'Scanning' : 'Scan'}
            </button>
          </div>
        </header>

        {error ? (
          <section className="error-banner" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </section>
        ) : null}

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

        <section className="content-layout">
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
                    onClick={() => setActiveView(mode)}
                    type="button"
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={28} />
                <p>Scanning F:/media</p>
              </div>
            ) : query.trim() ? (
              <TitleSection
                emptyLabel="No matching titles found"
                history={playbackHistory}
                onSelect={selectTitle}
                selectedTitleId={selectedTitle?.id ?? null}
                title="Search results"
                titles={[...filteredMovies, ...filteredShows]}
              />
            ) : activeView === 'Movies' ? (
              <TitleSection
                emptyLabel="No movies found"
                history={playbackHistory}
                onSelect={selectTitle}
                selectedTitleId={selectedTitle?.id ?? null}
                title="Movies"
                titles={collections.movies}
              />
            ) : activeView === 'TV Shows' ? (
              <TitleSection
                emptyLabel="No TV shows found"
                history={playbackHistory}
                onSelect={selectTitle}
                selectedTitleId={selectedTitle?.id ?? null}
                title="TV Shows"
                titles={collections.shows}
              />
            ) : (
              <div className="title-sections">
                <TitleSection
                  history={playbackHistory}
                  onSelect={selectTitle}
                  selectedTitleId={selectedTitle?.id ?? null}
                  title="Recently watched TV"
                  titles={recentShows}
                />
                <TitleSection
                  history={playbackHistory}
                  onSelect={selectTitle}
                  selectedTitleId={selectedTitle?.id ?? null}
                  title="Recently watched movies"
                  titles={recentMovies}
                />
                <TitleSection
                  history={playbackHistory}
                  limit={12}
                  onSelect={selectTitle}
                  selectedTitleId={selectedTitle?.id ?? null}
                  title="Movies"
                  titles={collections.movies}
                />
                <TitleSection
                  history={playbackHistory}
                  limit={12}
                  onSelect={selectTitle}
                  selectedTitleId={selectedTitle?.id ?? null}
                  title="TV Shows"
                  titles={collections.shows}
                />
              </div>
            )}
          </section>

          <aside className="inspector" aria-label="Selected media">
            <section className="now-playing">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">
                    {selectedTitle?.kind === 'show' ? 'Show' : 'Movie'}
                  </p>
                  <h2>{selectedTitle?.title ?? 'No title selected'}</h2>
                </div>
                <button
                  className="round-button"
                  disabled={!selectedItem?.browserPlayable}
                  onClick={() => void playerRef.current?.play()}
                  title="Play"
                  type="button"
                >
                  <Play fill="currentColor" size={18} />
                </button>
              </div>

              {selectedItem ? (
                selectedItem.browserPlayable ? (
                  <video
                    className="media-player"
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
                    src={selectedItem.streamUrl}
                  />
                ) : (
                  <div className="player-frame unavailable">
                    <Clapperboard size={42} />
                    <p>{selectedItem.container} indexed</p>
                    <span>Firefox needs a playable container</span>
                  </div>
                )
              ) : (
                <div className="player-frame unavailable">
                  <Clapperboard size={42} />
                  <p>No video selected</p>
                </div>
              )}

              {selectedTitle ? (
                <div className="metadata-row">
                  <span>{getTitleKindLabel(selectedTitle)}</span>
                  <strong>{getPlaybackLabel(selectedTitle, selectedItem)}</strong>
                </div>
              ) : null}

              {selectedPlayback ? (
                <div className="resume-note">
                  {selectedPlayback.completed
                    ? 'Watched'
                    : `Resume at ${formatDuration(selectedPlayback.position)}`}
                </div>
              ) : null}
            </section>

            {selectedTitle?.kind === 'show' ? (
              <section>
                <div className="panel-heading compact">
                  <h2>Episodes</h2>
                  <Tv size={19} />
                </div>
                <div className="episode-list">
                  {selectedTitle.seasons.map((season) => (
                    <div className="season-group" key={season.seasonNumber}>
                      <p className="eyebrow">
                        Season {season.seasonNumber || 'Unknown'}
                      </p>
                      {season.episodes.map((episode) => {
                        const episodeRecord = playbackHistory[episode.id]

                        return (
                          <button
                            className={
                              selectedItem?.id === episode.id
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
                            <strong>{episode.episodeTitle ?? episode.title}</strong>
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
              </section>
            ) : null}

            <section>
              <div className="panel-heading compact">
                <h2>Sources</h2>
                <FolderSearch size={19} />
              </div>
              <div className="source-list">
                {(library?.sources ?? []).map((source) => (
                  <article className="source-row" key={source.path}>
                    <div>
                      <strong>{source.name}</strong>
                      <span>{source.path}</span>
                    </div>
                    <p>
                      {formatNumber(source.videoCount)} videos -{' '}
                      {formatNumber(source.playableCount)} ready -{' '}
                      {source.sizeLabel}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <div className="panel-heading compact">
                <h2>File</h2>
                <HardDrive size={19} />
              </div>
              {selectedItem ? (
                <dl className="detail-list">
                  <div>
                    <dt>Folder</dt>
                    <dd>{selectedItem.folder || selectedItem.source}</dd>
                  </div>
                  <div>
                    <dt>Path</dt>
                    <dd>{selectedItem.relativePath}</dd>
                  </div>
                  <div>
                    <dt>Updated</dt>
                    <dd>{formatDate(selectedItem.modifiedAt)}</dd>
                  </div>
                </dl>
              ) : (
                <div className="empty-state compact">
                  <p>No file selected</p>
                </div>
              )}
            </section>
          </aside>
        </section>
      </section>
    </main>
  )
}

function TitleSection({
  emptyLabel,
  history,
  limit,
  onSelect,
  selectedTitleId,
  title,
  titles,
}: {
  emptyLabel?: string
  history: PlaybackHistory
  limit?: number
  onSelect: (title: LibraryTitle) => void
  selectedTitleId: string | null
  title: string
  titles: LibraryTitle[]
}) {
  const visibleTitles = typeof limit === 'number' ? titles.slice(0, limit) : titles

  if (!visibleTitles.length && !emptyLabel) {
    return null
  }

  return (
    <section className="media-section" aria-label={title}>
      <div className="section-heading">
        <h3>{title}</h3>
        <span>{formatNumber(titles.length)}</span>
      </div>

      {visibleTitles.length ? (
        <div className="media-grid">
          {visibleTitles.map((item) => (
            <TitleCard
              history={history}
              isSelected={item.id === selectedTitleId}
              key={item.id}
              onSelect={onSelect}
              title={item}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <FileVideo size={28} />
          <p>{emptyLabel}</p>
        </div>
      )}
    </section>
  )
}

function TitleCard({
  history,
  isSelected,
  onSelect,
  title,
}: {
  history: PlaybackHistory
  isSelected: boolean
  onSelect: (title: LibraryTitle) => void
  title: LibraryTitle
}) {
  const resumeItem = getResumeItem(title, history)
  const record = resumeItem ? history[resumeItem.id] : null
  const progress =
    record && record.duration > 0
      ? Math.min((record.position / record.duration) * 100, 100)
      : 0
  const Icon = title.kind === 'show' ? Tv : Video

  return (
    <button
      className={isSelected ? 'media-card selected' : 'media-card'}
      onClick={() => onSelect(title)}
      type="button"
    >
      <div className={title.kind === 'show' ? 'media-art show-art' : 'media-art'}>
        <Icon size={38} />
        <span>{getCardBadge(title)}</span>
      </div>
      <div className="media-card-body">
        <div>
          <p>{getTitleKindLabel(title)}</p>
          <h3>{title.title}</h3>
        </div>
        <dl>
          <div>
            <dt>{title.kind === 'show' ? 'Episodes' : 'Size'}</dt>
            <dd>{title.kind === 'show' ? title.episodeCount : title.item.sizeLabel}</dd>
          </div>
          <div>
            <dt>Source</dt>
            <dd>{title.kind === 'show' ? title.source : title.item.source}</dd>
          </div>
          <div>
            <dt>Playback</dt>
            <dd>{resumeItem?.browserPlayable ? 'Ready' : 'Indexed'}</dd>
          </div>
        </dl>
        {progress > 0 ? (
          <div className="progress-track" aria-hidden="true">
            <span style={{ width: `${progress}%` }} />
          </div>
        ) : null}
      </div>
    </button>
  )
}

function buildCollections(
  items: MediaItem[],
  history: PlaybackHistory,
): LibraryCollections {
  const movies = items
    .filter((item) => item.category === 'movie')
    .map<MovieTitle>((item) => ({
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

function readPlaybackHistory(): PlaybackHistory {
  try {
    const value = window.localStorage.getItem(playbackStorageKey)

    return value ? (JSON.parse(value) as PlaybackHistory) : {}
  } catch {
    return {}
  }
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

function getCardBadge(title: LibraryTitle) {
  if (title.kind === 'show') {
    return `${title.episodeCount} eps`
  }

  return title.item.container
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

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatScanTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
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

export default App
