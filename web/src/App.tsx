import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchRepos, type RepoEntry, type Scope } from './api'
import { clockOf, type Theme } from './lanes'
import { useGraph } from './useGraph'
import { CommitPanel } from './components/CommitPanel'
import { GraphView } from './components/GraphView'
import { RepoPicker } from './components/RepoPicker'
import { WindowControls } from './components/WindowControls'
import { dragProps } from './window'

const LIMITS = [200, 400, 1000, 0]

function stored<T extends string>(key: string, fallback: T): T {
  return (localStorage.getItem(key) as T | null) ?? fallback
}

export default function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('repo'))
  const [scope, setScope] = useState<Scope>(() => stored<Scope>('scope', 'all'))
  const [limit, setLimit] = useState(() => Number(stored('limit', '400')))
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() =>
    stored<Theme>('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'),
  )
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

  const { graph, error, updatedAt } = useGraph(current, scope, limit)

  useEffect(() => { document.documentElement.dataset.theme = theme }, [theme])
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
    setCurrent(path)
  }

  const status = error
    ? error
    : graph
      ? `${graph.commits.length}${graph.truncated ? '+' : ''} commits . ${clockOf(updatedAt)}`
      : 'reading...'

  return (
    <>
      <header className="bar">
        <RepoPicker repos={repos} current={current} onPick={pick} onChanged={refreshRepos} />
        <span className="path" {...dragProps}>{graph?.path}</span>
        <span className="spacer" {...dragProps} />
        <input
          ref={search}
          type="search"
          value={query}
          placeholder="filter: text, author, hash, ref"
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          value={scope}
          onChange={(event) => {
            const next = event.target.value as Scope
            setScope(next)
            localStorage.setItem('scope', next)
          }}
        >
          <option value="all">all branches</option>
          <option value="head">current branch</option>
        </select>
        <select
          value={limit}
          onChange={(event) => {
            const next = Number(event.target.value)
            setLimit(next)
            localStorage.setItem('limit', String(next))
          }}
        >
          {LIMITS.map((value) => (
            <option key={value} value={value}>{value === 0 ? 'all' : value}</option>
          ))}
        </select>
        <button
          onClick={() => {
            const next: Theme = theme === 'dark' ? 'light' : 'dark'
            setTheme(next)
            localStorage.setItem('theme', next)
          }}
        >
          theme
        </button>
        <span className={error ? 'status bad' : 'status'}>{status}</span>
        <WindowControls />
      </header>

      {graph
        ? <GraphView graph={graph} theme={theme} query={query} selected={selected} onSelect={setSelected} />
        : <p className="empty">{error ?? 'reading the repository...'}</p>}

      <CommitPanel repo={current} hash={selected} onClose={() => setSelected(null)} />
    </>
  )
}
