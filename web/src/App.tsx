import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchRepos, filtering, NO_FILTERS,
  type Filters, type Order, type RepoEntry,
} from './api'
import { ago } from './lanes'
import { searching } from './search'
import { ALL, branchOf, readScope, scopeOf } from './scope'
import { readSettings, writeSettings, type Settings } from './settings'
import { useGraph } from './useGraph'
import { CommitPanel } from './components/CommitPanel'
import { FilterBar } from './components/FilterBar'
import { GraphView } from './components/GraphView'
import { RefsPanel } from './components/RefsPanel'
import { RepoPicker } from './components/RepoPicker'
import { SettingsMenu } from './components/SettingsMenu'
import { WindowControls } from './components/WindowControls'
import { dragProps } from './window'

/** How many commits a read asks for, and how many the next one adds. */
const PAGE = 400

export default function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('repo'))
  const [scope, setScope] = useState(() => readScope(localStorage.getItem('scope')))
  const [limit, setLimit] = useState(PAGE)
  const [order, setOrder] = useState<Order>(() =>
    localStorage.getItem('order') === 'topo' ? 'topo' : 'date',
  )
  // a narrowing that outlived the session would hide commits nobody asked it to hide
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(() => localStorage.getItem('regex') === 'yes')
  const [matchCase, setMatchCase] = useState(() => localStorage.getItem('case') === 'yes')
  const [selected, setSelected] = useState<string | null>(null)
  const [jump, setJump] = useState<{ h: string; n: number } | null>(null)
  // the ref the reading sits on, which is what the tree highlights
  const [taken, setTaken] = useState<string | null>(null)
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

  const { graph, error, updatedAt, reload } = useGraph(current, scope, limit, order, filters)

  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])
  useEffect(() => { if (current) localStorage.setItem('repo', current) }, [current])
  useEffect(() => { document.title = graph ? `${graph.repo} . gitlanes` : 'gitlanes' }, [graph])

  const change = useCallback((patch: Partial<Settings>) => {
    setSettings((held) => {
      const next = { ...held, ...patch }
      writeSettings(next)
      return next
    })
    // going back to one global view releases the branch that was bounding it, which
    // otherwise stays with no control left to undo it
    if (patch.branchClick === 'reveal') {
      const held = branchOf(scope)
      if (held) setTaken(held)
      setLimit(PAGE)
      setScope(ALL)
      localStorage.setItem('scope', ALL)
    }
  }, [scope])

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
    setTaken(null)
    setLimit(PAGE)
    setScope(ALL)
    localStorage.setItem('scope', ALL)
    // authors and paths belong to the repository that was open, not to the next one
    setFilters(NO_FILTERS)
    setCurrent(path)
  }

  const goTo = (hash: string) => {
    setSelected(hash)
    setJump((held) => ({ h: hash, n: (held?.n ?? 0) + 1 }))
  }

  /** A ref taken in the tree: bound to, when that is the mode and it is a branch. */
  const take = (name: string, head: string, local: boolean) => {
    setTaken(name)
    if (local && settings.branchClick === 'filter') {
      setLimit(PAGE)
      setScope(scopeOf(name))
      localStorage.setItem('scope', scopeOf(name))
      return
    }
    goTo(head)
  }

  /**
   * A commit picked in the graph, and the branch it ends if it ends one.
   *
   * Clicking the tip of a branch is the same gesture as clicking that branch in
   * the tree, so the tree lights up the same way. When several branches stand on
   * the commit, the one already lit wins, then the one HEAD is on.
   */
  const choose = (hash: string) => {
    setSelected(hash)
    const commit = graph?.commits.find((one) => one.h === hash)
    const ends = commit?.refs.filter((ref) => ref.k === 'local').map((ref) => ref.n) ?? []
    if (!ends.length || ends.includes(taken ?? '')) return
    setTaken(ends.find((name) => name === graph?.branch) ?? ends[0])
  }

  const narrow = (patch: Partial<Filters>) => {
    setLimit(PAGE)
    setFilters((held) => ({ ...held, ...patch }))
  }

  const mode = (patch: { regex?: boolean; matchCase?: boolean }) => {
    if (patch.regex !== undefined) {
      setRegex(patch.regex)
      localStorage.setItem('regex', patch.regex ? 'yes' : 'no')
    }
    if (patch.matchCase !== undefined) {
      setMatchCase(patch.matchCase)
      localStorage.setItem('case', patch.matchCase ? 'yes' : 'no')
    }
  }

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

  // the row that was clicked, which already holds the subject the panel opens with
  const chosen = useMemo(
    () => (selected ? graph?.commits.find((commit) => commit.h === selected) ?? null : null),
    [graph, selected],
  )

  // who wrote what is on screen, which is the only list of authors worth offering
  const authors = useMemo(
    () => [...new Set(graph?.commits.map((commit) => commit.an) ?? [])].sort(),
    [graph],
  )

  const found = useMemo(() => searching(query, regex, matchCase), [query, regex, matchCase])

  const lit = branchOf(scope) ?? taken ?? graph?.branch ?? null
  const freshness = updatedAt ? `refresh, read ${ago(new Date(updatedAt))}` : 'refresh'

  return (
    <>
      <header className="bar" {...dragProps}>
        <SettingsMenu settings={settings} onChange={change} />
        <RepoPicker repos={repos} current={current} onPick={pick} onChanged={refreshRepos} />
        <span className="spacer" />
        {/* nothing to say while it works: only a failure is worth a line in the bar */}
        {error && <span className="status bad">{error}</span>}
        <WindowControls />
      </header>

      <FilterBar
        search={search}
        query={query}
        onQuery={setQuery}
        regex={regex}
        matchCase={matchCase}
        broken={found.broken}
        onMode={mode}
        authors={authors}
        filters={filters}
        onFilters={narrow}
        order={order}
        onOrder={() => {
          const next: Order = order === 'date' ? 'topo' : 'date'
          setOrder(next)
          localStorage.setItem('order', next)
        }}
        freshness={freshness}
        onReload={() => void reload()}
      />

      <main className="body">
        <RefsPanel
          repo={current}
          shown={settings.showRefs}
          active={lit}
          fingerprint={graph?.fingerprint ?? ''}
          onTake={take}
        />

        {graph
          ? <GraphView
              graph={graph}
              theme={settings.theme}
              match={found.match}
              narrowed={filtering(filters)}
              selected={selected}
              jump={jump}
              onSelect={choose}
              onMore={more}
            />
          : <p className="empty">{error ?? 'reading the repository...'}</p>}

        <CommitPanel repo={current} hash={selected} known={chosen} shown={settings.showPanel} />
      </main>
    </>
  )
}
