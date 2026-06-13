import { useEffect, useMemo, useState } from 'react'
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
type FilterType = 'Playable' | 'All' | 'Movies' | 'TV' | 'Other'

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

type NavItem = {
  label: string
  count: string
  icon: LucideIcon
}

type StatItem = {
  label: string
  value: string
  icon: LucideIcon
}

const filters: FilterType[] = ['Playable', 'All', 'Movies', 'TV', 'Other']
const categoryLabels: Record<MediaCategory, string> = {
  movie: 'Movie',
  other: 'Other',
  show: 'TV',
}

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
  const [activeFilter, setActiveFilter] = useState<FilterType>('Playable')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [library, setLibrary] = useState<LibraryResponse | null>(null)
  const [query, setQuery] = useState('')
  const [scanRunning, setScanRunning] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    fetchLibrary(controller.signal)
      .then((nextLibrary) => {
        setLibrary(nextLibrary)
        setSelectedId(getInitialSelection(nextLibrary))
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

  const filteredItems = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()

    return (library?.items ?? []).filter((item) => {
      const matchesFilter =
        activeFilter === 'All' ||
        (activeFilter === 'Playable' && item.browserPlayable) ||
        (activeFilter === 'Movies' && item.category === 'movie') ||
        (activeFilter === 'TV' && item.category === 'show') ||
        (activeFilter === 'Other' && item.category === 'other')

      if (!matchesFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return `${item.title} ${item.relativePath} ${item.container}`
        .toLowerCase()
        .includes(normalizedQuery)
    })
  }, [activeFilter, library, query])

  const selectedItem = useMemo(() => {
    if (!library?.items.length) {
      return null
    }

    return (
      library.items.find((item) => item.id === selectedId) ??
      filteredItems[0] ??
      library.items[0]
    )
  }, [filteredItems, library, selectedId])

  const navItems: NavItem[] = [
    {
      label: 'Library',
      count: formatNumber(library?.summary.totalVideos ?? 0),
      icon: LayoutGrid,
    },
    {
      label: 'Playable',
      count: formatNumber(library?.summary.playableVideos ?? 0),
      icon: Play,
    },
    {
      label: 'Movies',
      count: formatNumber(countByCategory(library?.items, 'movie')),
      icon: Video,
    },
    {
      label: 'TV',
      count: formatNumber(countByCategory(library?.items, 'show')),
      icon: Tv,
    },
    {
      label: 'Sources',
      count: formatNumber(library?.summary.sources ?? 0),
      icon: HardDrive,
    },
  ]

  const libraryStats: StatItem[] = [
    {
      label: 'Indexed videos',
      value: formatNumber(library?.summary.totalVideos ?? 0),
      icon: Database,
    },
    {
      label: 'Firefox-ready',
      value: formatNumber(library?.summary.playableVideos ?? 0),
      icon: Play,
    },
    {
      label: 'Sources',
      value: formatNumber(library?.summary.sources ?? 0),
      icon: FolderSearch,
    },
    {
      label: 'Storage indexed',
      value: library?.summary.sizeLabel ?? '0 B',
      icon: HardDrive,
    },
  ]

  async function startScan() {
    setScanRunning(true)
    setError(null)

    try {
      const nextLibrary = await fetchLibrary()

      setLibrary(nextLibrary)
      setSelectedId((currentSelection) =>
        currentSelection &&
        nextLibrary.items.some((item) => item.id === currentSelection)
          ? currentSelection
          : getInitialSelection(nextLibrary),
      )
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally {
      setScanRunning(false)
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
            <h1>Home Media</h1>
          </div>
        </div>

        <nav className="nav-stack">
          {navItems.map((item, index) => {
            const Icon = item.icon

            return (
              <button
                className={index === 0 ? 'nav-item active' : 'nav-item'}
                key={item.label}
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
              placeholder="Search library"
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
                <h2 id="library-heading">Library</h2>
              </div>
              <div className="segmented-control" aria-label="Filter library">
                {filters.map((filter) => (
                  <button
                    aria-pressed={activeFilter === filter}
                    className={activeFilter === filter ? 'selected' : ''}
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    type="button"
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>

            {isLoading ? (
              <div className="empty-state">
                <LoaderCircle className="spin" size={28} />
                <p>Scanning F:/media</p>
              </div>
            ) : filteredItems.length ? (
              <div className="media-grid">
                {filteredItems.map((item) => (
                  <button
                    className={
                      selectedItem?.id === item.id
                        ? 'media-card selected'
                        : 'media-card'
                    }
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                    type="button"
                  >
                    <div className="media-art">
                      <FileVideo size={38} />
                      <span>{item.container}</span>
                    </div>
                    <div className="media-card-body">
                      <div>
                        <p>{categoryLabels[item.category]}</p>
                        <h3>{item.title}</h3>
                      </div>
                      <dl>
                        <div>
                          <dt>Size</dt>
                          <dd>{item.sizeLabel}</dd>
                        </div>
                        <div>
                          <dt>Source</dt>
                          <dd>{item.source}</dd>
                        </div>
                        <div>
                          <dt>Playback</dt>
                          <dd>
                            {item.browserPlayable ? 'Ready' : 'Indexed'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <FileVideo size={30} />
                <p>No matching videos found</p>
              </div>
            )}
          </section>

          <aside className="inspector" aria-label="Selected media">
            <section className="now-playing">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">Preview</p>
                  <h2>{selectedItem?.title ?? 'No video selected'}</h2>
                </div>
                <button
                  className="round-button"
                  disabled={!selectedItem?.browserPlayable}
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
                    preload="metadata"
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

              {selectedItem ? (
                <div className="metadata-row">
                  <span>{categoryLabels[selectedItem.category]}</span>
                  <strong>{selectedItem.container}</strong>
                </div>
              ) : null}
            </section>

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

function countByCategory(items: MediaItem[] | undefined, category: MediaCategory) {
  return items?.filter((item) => item.category === category).length ?? 0
}

function getInitialSelection(library: LibraryResponse) {
  return (
    library.items.find((item) => item.browserPlayable)?.id ??
    library.items[0]?.id ??
    null
  )
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

export default App
