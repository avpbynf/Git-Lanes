import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  fetchRepos, filtering, NO_FILTERS,
  type Filters, type Order, type RepoEntry,
} from './api'
import { ago } from './lanes'
import { searching } from './search'
import { ALL, HEADS, readScope, refOf, scopeOf } from './scope'
import { readSettings, writeSettings, type Settings } from './settings'
import { useGraph } from './useGraph'
import { CommitPanel } from './components/CommitPanel'
import { FilterBar } from './components/FilterBar'
import { GraphView } from './components/GraphView'
import { SettingsMenu } from './components/SettingsMenu'
import { Sidebar } from './components/Sidebar'
import { WindowControls } from './components/WindowControls'
import { dragProps } from './window'

/** Windows tells no case from another, and the two ends of this spell paths as they please. */
const samePath = (left: string | null, right: string | null) =>
  Boolean(left) && left?.toLowerCase().replace(/\//g, '\\') === right?.toLowerCase().replace(/\//g, '\\')

export default function App() {
  const [repos, setRepos] = useState<RepoEntry[]>([])
  const [current, setCurrent] = useState<string | null>(() => localStorage.getItem('repo'))
  const [scope, setScope] = useState(() => readScope(localStorage.getItem('scope')))
  const [order, setOrder] = useState<Order>(() =>
    localStorage.getItem('order') === 'topo' ? 'topo' : 'date',
  )
  // a narrowing that outlived the session would hide commits nobody asked it to hide
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [query, setQuery] = useState('')
  const [regex, setRegex] = useState(() => localStorage.getItem('regex') === 'yes')
  const [matchCase, setMatchCase] = useState(() => localStorage.getItem('case') === 'yes')
  const [selected, setSelected] = useState<string | null>(null)
  const [jump, setJump] = useState<{ h: string; n: number; near?: boolean } | null>(null)
  // the ref the reading sits on, spelled in full, which is what the tree highlights
  const [taken, setTaken] = useState<string | null>(null)
  const [settings, setSettings] = useState<Settings>(readSettings)
  const [version, setVersion] = useState('')
  const search = useRef<HTMLInputElement>(null)

  const refreshRepos = useCallback(async () => {
    try {
      const listed = await fetchRepos()
      setRepos(listed.repos)
      setVersion(listed.version)
      // What was read last is remembered by the browser and the list of projects by the backend,
      // and the two can disagree: a project forgotten in one window is still named in another's
      // storage, and the graph would then show a repository no row in the tree can reach. The
      // list is what decides.
      setCurrent((held) => {
        const known = listed.repos.some((repo) => samePath(repo.path, held))
        return known ? held : listed.default ?? listed.repos[0]?.path ?? null
      })
    } catch {
      // a backend that is not answering is reported by the graph itself
    }
  }, [])

  // the state lands after the fetch resolves, never synchronously here
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void refreshRepos() }, [refreshRepos])

  const { graph, error, updatedAt, reload } = useGraph(current, scope, order, filters)

  useEffect(() => { document.documentElement.dataset.theme = settings.theme }, [settings.theme])
  useEffect(() => { if (current) localStorage.setItem('repo', current) }, [current])
  useEffect(() => { document.title = graph ? `${graph.repo} . Git Lanes` : 'Git Lanes' }, [graph])

  const beat = graph?.fingerprint
  // the branch a project sits on is read with the list, so it goes stale unless
  // the list is read again when the repository being watched moves
  // the state lands after the fetch resolves, never synchronously here
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (beat) void refreshRepos() }, [beat, refreshRepos])

  const change = useCallback((patch: Partial<Settings>) => {
    setSettings((held) => {
      const next = { ...held, ...patch }
      writeSettings(next)
      return next
    })
    // going back to one global view releases the ref that was bounding it, which
    // otherwise stays with no control left to undo it
    if (patch.branchClick === 'reveal') {
      const held = refOf(scope)
      if (held) setTaken(held)
      setScope(ALL)
      localStorage.setItem('scope', ALL)
    }
  }, [scope])

  const pick = (path: string) => {
    setSelected(null)
    setTaken(null)
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

  /**
   * A ref taken in the tree, bound to when that is the mode.
   *
   * Its tip is shown either way. Bounding without moving would leave whatever
   * was read before selected under a graph that is no longer its own.
   */
  const take = (refname: string, head: string) => {
    setTaken(refname)
    if (settings.branchClick === 'filter') {
      const next = scopeOf(refname)
      setScope(next)
      localStorage.setItem('scope', next)
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
  const choose = useCallback((hash: string) => {
    setSelected(hash)
    const commit = graph?.commits.find((one) => one.h === hash)
    const ends = commit?.refs.filter((ref) => ref.k === 'local').map((ref) => HEADS + ref.n) ?? []
    if (!ends.length || ends.includes(taken ?? '')) return
    setTaken(ends.find((name) => name === HEADS + graph?.branch) ?? ends[0])
  }, [graph, taken])

  /**
   * The commit one row down or up, taken as if it had been clicked.
   *
   * With nothing taken yet either arrow lands on the first row, which is where
   * the graph opens. The row is brought into view and no further: one already
   * on screen leaves the graph where it stands.
   */
  const step = useCallback((delta: number) => {
    const commits = graph?.commits
    if (!commits?.length) return
    const at = commits.findIndex((commit) => commit.h === selected)
    const next = commits[Math.min(Math.max(at + delta, 0), commits.length - 1)]
    if (!next || next.h === selected) return
    choose(next.h)
    setJump((held) => ({ h: next.h, n: (held?.n ?? 0) + 1, near: true }))
  }, [graph, selected, choose])

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === '/' && document.activeElement !== search.current) {
        event.preventDefault()
        search.current?.focus()
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        // a field being typed in owns its own arrows, caret and history alike
        if (document.activeElement?.tagName === 'INPUT') return
        event.preventDefault()
        step(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key !== 'Escape') return
      if (selected) setSelected(null)
      else if (query) setQuery('')
    }
    addEventListener('keydown', keys)
    return () => removeEventListener('keydown', keys)
  }, [selected, query, step])

  const narrow = (patch: Partial<Filters>) => setFilters((held) => ({ ...held, ...patch }))

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

  const lit = refOf(scope) ?? taken ?? (graph?.branch ? HEADS + graph.branch : null)
  const freshness = updatedAt ? `refresh, read ${ago(new Date(updatedAt))}` : 'refresh'

  return (
    <>
      <header className="bar" {...dragProps}>
        <SettingsMenu settings={settings} onChange={change} />
        {/* the tool, not the repository: which one is open is what the tree says */}
        <span className="title">Git Lanes{version && ` ${version}`}</span>
        <span className="spacer" />
        {/* nothing to say while it works: only a failure is worth a line in the bar */}
        {error && <span className="status bad">{error}</span>}
        <WindowControls />
      </header>

      <main className="body">
        <Sidebar
          repos={repos}
          current={current}
          shown={settings.showRefs}
          active={lit}
          fingerprint={graph?.fingerprint ?? ''}
          onPickRepo={pick}
          onRepos={refreshRepos}
          onTake={take}
        />

        {/* the filters read commits, so they start where the tree ends */}
        <div className="right">
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

          <div className="under">
            {graph
              ? <GraphView
                  graph={graph}
                  theme={settings.theme}
                  match={found.match}
                  narrowed={filtering(filters)}
                  selected={selected}
                  trail={settings.trail}
                  jump={jump}
                  onSelect={choose}
                />
              : <p className="empty">{error ?? 'reading the repository...'}</p>}

            <CommitPanel
              repo={current}
              hash={selected}
              known={chosen}
              beat={beat}
              mode={settings.panel}
              onClose={() => setSelected(null)}
            />
          </div>
        </div>
      </main>
    </>
  )
}
