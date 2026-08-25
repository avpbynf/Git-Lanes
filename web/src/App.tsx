import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRepos, type Branch, type Order, type RepoEntry } from './api'
import { ago } from './lanes'
import { ALL, readScope } from './scope'
import { readSettings, writeSettings, type Settings } from './settings'
import { useGraph } from './useGraph'
import { BranchMenu } from './components/BranchMenu'
import { CommitPanel } from './components/CommitPanel'
import { GraphView } from './components/GraphView'
import { RepoPicker } from './components/RepoPicker'
import { SettingsMenu } from './components/SettingsMenu'
import { WindowControls } from './components/WindowControls'
import { dragProps } from './window'

/** How many commits a read asks for, and how many the next one adds. */
const PAGE = 400

const REFRESH = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M13.6 8a5.6 5.6 0 1 1-1.7-4" />
    <path d="M13.9 1.6v3h-3" />
  </svg>
)

const BY_DATE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.6 3.6h10.8M2.6 8h7M2.6 12.4h3.4" />
  </svg>
)

const BY_BRANCH = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M5.2 4.6v7.6M5.2 8.4h3.2a2.4 2.4 0 0 0 2.4-2.4V4.6" />
    <circle cx="5.2" cy="13.6" r="1.4" />
    <circle cx="10.8" cy="3.2" r="1.4" />
  </svg>
)

export default function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('repo'))
  const [scope, setScope] = useState(() => readScope(localStorage.getItem('scope')))
  const [limit, setLimit] = useState(PAGE)
  const [order, setOrder] = useState<Order>(() =>
    localStorage.getItem('order') === 'topo' ? 'topo' : 'date',
  )
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [jump, setJump] = useState<{ h: string; n: number } | null>(null)
  const [picked, setPicked] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(readSettings)
  const search = useRef<HTMLInputElement>(null)

  const refreshRepos = useCallback(async () => {
    try {
      const listed = await fetchRepos()
      setRepos(listed.repos)
      setCurrent((held) => held ?? listed.default ?? listed.repos[0]?.path ?? null)
    } catch {
      // a backend that is not answering is reported by the graph itself
    }
  }, [])

  // the state lands after the fetch resolves, never synchronously here
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshRepos() }, [refreshRepos])

  const { graph, error, updatedAt, reload } = useGraph(current, scope, limit, order)

  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])
  useEffect(() => { if (current) localStorage.setItem('repo', current) }, [current])
  useEffect(() => { document.title = graph ? `${graph.repo} . gitlanes` : 'gitlanes' }, [graph])

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement !== search.current) {
        event.preventDefault()
        search.current?.focus()
        return
      }
      if (event.key !== 'Escape') return
      if (selected) setSelected(null)
      else if (query) setQuery('')
    }
    addEventListener('keydown', keys)
    return () => removeEventListener('keydown', keys)
  }, [selected, query])

  const pick = (path: string) => {
    setSelected(null)
    setPicked(null)
    setLimit(PAGE)
    setScope(ALL)
    localStorage.setItem('scope', ALL)
    setCurrent(path)
  }

  const bind = (next: string) => {
    setLimit(PAGE)
    setScope(next)
    localStorage.setItem('scope', next)
  }

  const reveal = (branch: Branch) => {
    setPicked(branch.name)
    setSelected(branch.head)
    setJump((held) => ({ h: branch.head, n: (held?.n ?? 0) + 1 }))
  }

  const change = useCallback((patch: Partial<Settings>) => {
    setSettings((held) => {
      const next = { ...held, ...patch }
      writeSettings(next)
      return next
    })
  }, [])

  /**
   * One more page, once the page being read has landed in full.
   *
   * Scrolling fires this many times over; the count standing short of the
   * limit is what says a read is still on its way, and holds the limit still.
   */
  const more = useCallback(() => {
    if (!graph?.truncated) return
    setLimit((held) => (graph.commits.length >= held ? held + PAGE : held))
  }, [graph])

  const status = error ?? (graph ? `${graph.commits.length}${graph.truncated ? '+' : ''} commits` : 'reading...')
  const freshness = updatedAt ? `refresh, read ${ago(new Date(updatedAt))}` : 'refresh'

  return (
    <>
      <header className="bar" {...dragProps}>
        <RepoPicker repos={repos} current={current} onPick={pick} onChanged={refreshRepos} />
        <BranchMenu
          repo={current}
          scope={scope}
          click={settings.branchClick}
          branch={graph?.branch ?? null}
          dirty={graph?.dirty ?? false}
          picked={picked}
          onScope={bind}
          onReveal={reveal}
        />
        <span className="spacer" />
        <input
          ref={search}
          type="search"
          value={query}
          placeholder="filter: text, author, hash, ref"
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className="icon"
          title={order === 'date' ? 'read down the calendar' : 'each branch kept whole'}
          onClick={() => {
            const next: Order = order === 'date' ? 'topo' : 'date'
            setOrder(next)
            localStorage.setItem('order', next)
          }}
        >
          {order === 'date' ? BY_DATE : BY_BRANCH}
        </button>
        <button className="icon" title={freshness} onClick={() => void reload()}>{REFRESH}</button>
        <SettingsMenu settings={settings} onChange={change} />
        <span className={error ? 'status bad' : 'status'}>{status}</span>
        <WindowControls />
      </header>

      <main className="body">
        {graph
          ? <GraphView
              graph={graph}
              theme={settings.theme}
              query={query}
              selected={selected}
              jump={jump}
              onSelect={setSelected}
              onMore={more}
            />
          : <p className="empty">{error ?? 'reading the repository...'}</p>}

        <CommitPanel
          repo={current}
          hash={selected}
          mode={settings.panel}
          onClose={() => setSelected(null)}
        />
      </main>
    </>
  )
}
