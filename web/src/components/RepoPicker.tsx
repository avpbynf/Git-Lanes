import { useEffect, useRef, useState } from 'react'
import { closeRepo, discoverRepos, openRepo, type RepoEntry } from '../api'

interface Props {
  repos: RepoEntry[]
  current: string | null
  onPick: (path: string) => void
  onChanged: () => void
}

const parentOf = (path: string) => path.replace(/[\\/][^\\/]+$/, '')

export function RepoPicker({ repos, current, onPick, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState<string | null>(null)
  const [found, setFound] = useState<RepoEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const box = useRef<HTMLDivElement>(null)

  const active = repos.find((repo) => repo.path === current)
  // untouched, the folder to scan is the one holding the current repository
  const root = typed ?? (current ? parentOf(current) : '')

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const scan = async () => {
    setError(null)
    setFound(null)
    try {
      const { repos: hits } = await discoverRepos(root)
      setFound(hits)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const add = async (path: string) => {
    try {
      await openRepo(path)
      onChanged()
      onPick(path)
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const drop = async (path: string) => {
    await closeRepo(path)
    onChanged()
  }

  const known = new Set(repos.map((repo) => repo.path))

  return (
    <div className="picker" ref={box}>
      <button className="pick" onClick={() => setOpen(!open)}>
        <span className="strong">{active?.name ?? 'no repository'}</span>
        {active?.branch && <span className="chip branch">{active.branch}{active.dirty ? ' *' : ''}</span>}
        <span className="caret">{open ? '^' : 'v'}</span>
      </button>

      {open && (
        <div className="drop">
          {repos.length === 0 && <p className="empty">nothing opened yet, scan a folder below</p>}
          {repos.map((repo) => (
            <div key={repo.path} className={repo.path === current ? 'entry on' : 'entry'}>
              <button className="line" onClick={() => { onPick(repo.path); setOpen(false) }}>
                <span className="strong">{repo.name}</span>
                <span className="dim">{repo.error ?? repo.branch}{repo.dirty ? ' *' : ''}</span>
                <span className="path">{repo.path}</span>
              </button>
              <button className="x" title="remove from the list" onClick={() => drop(repo.path)}>x</button>
            </div>
          ))}

          <div className="scan">
            <input
              value={root}
              spellCheck={false}
              placeholder="a folder holding repositories"
              onChange={(event) => setTyped(event.target.value)}
              onKeyDown={(event) => event.key === 'Enter' && scan()}
            />
            <button onClick={scan}>scan</button>
          </div>

          {error && <p className="empty">{error}</p>}
          {found?.length === 0 && <p className="empty">no repository under that folder</p>}
          {found && found.length > 0 && (
            <div className="found">
              {found.map((repo) => (
                <button
                  key={repo.path}
                  className="line"
                  disabled={known.has(repo.path)}
                  onClick={() => add(repo.path)}
                >
                  <span className="strong">{repo.name}</span>
                  <span className="dim">{repo.error ? 'unreadable' : repo.branch}</span>
                  <span className="path">{known.has(repo.path) ? 'already open' : repo.path}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
