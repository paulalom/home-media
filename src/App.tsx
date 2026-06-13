import { useMemo, useState } from 'react'
import {
  Activity,
  CheckCircle2,
  Clapperboard,
  Database,
  FolderSearch,
  HardDrive,
  LayoutGrid,
  MonitorPlay,
  Play,
  Radio,
  RefreshCcw,
  Search,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Tv,
  Wifi,
  type LucideIcon,
} from 'lucide-react'
import './App.css'
import eclipseMarket from './assets/posters/eclipse-market.svg'
import harborNine from './assets/posters/harbor-nine.svg'
import nightKitchen from './assets/posters/night-kitchen.svg'
import northline from './assets/posters/northline.svg'
import signalRoom from './assets/posters/signal-room.svg'

type MediaType = 'Films' | 'Shows' | 'Music'
type FilterType = 'All' | MediaType

type NavItem = {
  label: string
  count: string
  icon: LucideIcon
}

const navItems: NavItem[] = [
  { label: 'Library', count: '1,482', icon: LayoutGrid },
  { label: 'Watching', count: '6', icon: MonitorPlay },
  { label: 'Sources', count: '4', icon: HardDrive },
  { label: 'Devices', count: '9', icon: Tv },
  { label: 'Activity', count: '18', icon: Activity },
]

const mediaItems: Array<{
  title: string
  type: MediaType
  year: string
  quality: string
  runtime: string
  progress: number
  poster: string
}> = [
  {
    title: 'Eclipse Market',
    type: 'Films',
    year: '2026',
    quality: '4K HDR',
    runtime: '2h 08m',
    progress: 82,
    poster: eclipseMarket,
  },
  {
    title: 'Harbor Nine',
    type: 'Shows',
    year: 'S2 E4',
    quality: '1080p',
    runtime: '42m',
    progress: 36,
    poster: harborNine,
  },
  {
    title: 'The Night Kitchen',
    type: 'Films',
    year: '2024',
    quality: '4K',
    runtime: '1h 47m',
    progress: 0,
    poster: nightKitchen,
  },
  {
    title: 'Northline',
    type: 'Music',
    year: 'Album',
    quality: 'FLAC',
    runtime: '51m',
    progress: 64,
    poster: northline,
  },
  {
    title: 'Signal Room',
    type: 'Shows',
    year: 'S1 E8',
    quality: '1080p',
    runtime: '58m',
    progress: 14,
    poster: signalRoom,
  },
]

const sources = [
  { name: 'Movies', path: 'F:/Media/Movies', items: '812 titles', health: 98 },
  { name: 'Television', path: 'F:/Media/TV', items: '544 seasons', health: 94 },
  { name: 'Music', path: 'F:/Media/Music', items: '126 albums', health: 100 },
]

const streams = [
  { device: 'Living Room', title: 'Eclipse Market', status: 'Direct Play' },
  { device: 'Kitchen Display', title: 'Harbor Nine', status: 'Transcoding' },
  { device: 'Tablet', title: 'Northline', status: 'Remote' },
]

const libraryStats: Array<{
  label: string
  value: string
  icon: LucideIcon
}> = [
  { label: 'Indexed titles', value: '1,482', icon: Database },
  { label: 'Online clients', value: '9', icon: Wifi },
  { label: 'Storage free', value: '7.8 TB', icon: HardDrive },
  { label: 'Protected', value: '100%', icon: ShieldCheck },
]

function App() {
  const [activeFilter, setActiveFilter] = useState<FilterType>('All')
  const [scanRunning, setScanRunning] = useState(false)

  const filteredItems = useMemo(
    () =>
      activeFilter === 'All'
        ? mediaItems
        : mediaItems.filter((item) => item.type === activeFilter),
    [activeFilter],
  )

  function startScan() {
    setScanRunning(true)
    window.setTimeout(() => setScanRunning(false), 1500)
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
                <strong>{item.count}</strong>
              </button>
            )
          })}
        </nav>

        <div className="server-card">
          <div className="server-icon">
            <Server size={20} />
          </div>
          <div>
            <p className="muted">Server</p>
            <strong>Online</strong>
          </div>
          <span className="status-dot" aria-label="Online" />
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="search-box">
            <Search size={18} />
            <input aria-label="Search library" placeholder="Search library" />
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

        <section className="stat-grid" aria-label="Library status">
          {libraryStats.map((stat) => {
            const Icon = stat.icon

            return (
              <article className="stat-card" key={stat.label}>
                <Icon size={18} />
                <span>{stat.label}</span>
                <strong>{stat.value}</strong>
              </article>
            )
          })}
        </section>

        <section className="content-layout">
          <section className="library-panel" aria-labelledby="library-heading">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Recently active</p>
                <h2 id="library-heading">Library</h2>
              </div>
              <div className="segmented-control" aria-label="Filter library">
                {(['All', 'Films', 'Shows', 'Music'] as const).map((filter) => (
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

            <div className="media-grid">
              {filteredItems.map((item) => (
                <article className="media-card" key={item.title}>
                  <img src={item.poster} alt="" />
                  <div className="media-card-body">
                    <div>
                      <p>{item.type}</p>
                      <h3>{item.title}</h3>
                    </div>
                    <dl>
                      <div>
                        <dt>Year</dt>
                        <dd>{item.year}</dd>
                      </div>
                      <div>
                        <dt>Quality</dt>
                        <dd>{item.quality}</dd>
                      </div>
                      <div>
                        <dt>Runtime</dt>
                        <dd>{item.runtime}</dd>
                      </div>
                    </dl>
                    <div className="progress-track" aria-hidden="true">
                      <span style={{ width: `${item.progress}%` }} />
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>

          <aside className="inspector" aria-label="Server activity">
            <section className="now-playing">
              <div className="panel-heading compact">
                <div>
                  <p className="eyebrow">Now playing</p>
                  <h2>Eclipse Market</h2>
                </div>
                <button className="round-button" title="Play" type="button">
                  <Play fill="currentColor" size={18} />
                </button>
              </div>
              <div className="player-frame">
                <Clapperboard size={42} />
              </div>
              <div className="metadata-row">
                <span>Living Room</span>
                <strong>4K HDR</strong>
              </div>
            </section>

            <section>
              <div className="panel-heading compact">
                <h2>Sources</h2>
                <FolderSearch size={19} />
              </div>
              <div className="source-list">
                {sources.map((source) => (
                  <article className="source-row" key={source.name}>
                    <div>
                      <strong>{source.name}</strong>
                      <span>{source.path}</span>
                    </div>
                    <p>{source.items}</p>
                    <div className="progress-track" aria-hidden="true">
                      <span style={{ width: `${source.health}%` }} />
                    </div>
                  </article>
                ))}
              </div>
            </section>

            <section>
              <div className="panel-heading compact">
                <h2>Streams</h2>
                <CheckCircle2 size={19} />
              </div>
              <div className="stream-list">
                {streams.map((stream) => (
                  <article className="stream-row" key={stream.device}>
                    <MonitorPlay size={18} />
                    <div>
                      <strong>{stream.device}</strong>
                      <span>{stream.title}</span>
                    </div>
                    <p>{stream.status}</p>
                  </article>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </section>
    </main>
  )
}

export default App
