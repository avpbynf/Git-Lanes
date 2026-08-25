import { useEffect, useRef, useState } from 'react'
import { fetchBranches, type Branch, type BranchList } from '../api'
import { ago } from '../lanes'
import { ALL, branchOf, scopeOf } from '../scope'
import type { BranchClick } from '../settings'

interface Props {
  repo: string | null
  scope: string
  click: BranchClick
  /** Where HEAD stands, which is what the button shows when nothing bounds the graph. */
  branch: string | null
  dirty: boolean
  /** The branch last gone to, so the highlight follows the reading and not only HEAD. */
  picked: string | null
  onScope: (scope: string) => void
  onReveal: (branch: Branch) => void
}

interface Answer {
  repo: string | null
  list?: BranchList
  error?: string
}

/** How far a branch stands from its base, silent when the two are level. */
function Divergence({ behind, ahead }: { behind: number; ahead: number }) {
  if (!behind && !ahead) return <span className="dim">even</span>
  return (
    <>
      {ahead > 0 && <span className="ahead">{ahead} ahead</span>}
      {behind > 0 && <span className="behind">{behind} behind</span>}
    </>
  )
}

/** What the remote knows of a branch: nothing, the same thing, or an older tip. */
function Pushed({ upstream }: { upstream: Branch['upstream'] }) {
  if (!upstream) return <span className="nowhere">not pushed</span>
  if (upstream.gone) return <span className="nowhere">upstream gone</span>
  if (!upstream.ahead && !upstream.behind) return <span className="dim">pushed</span>
  return (
    <>
      {upstream.ahead > 0 && <span className="ahead">{upstream.ahead} to push</span>}
      {upstream.behind > 0 && <span className="behind">{upstream.behind} to pull</span>}
    </>
  )
}

export function BranchMenu({ repo, scope, click, branch, dirty, picked, onScope, onReveal }: Props) {
  const [open, setOpen] = useState(false)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const box = useRef<HTMLDivElement>(null)

  // read when the list opens, and again when the repository changes under it
  useEffect(() => {
    if (!open) return
    let live = true
    fetchBranches(repo)
      .then((list) => live && setAnswer({ repo, list }))
      .catch((err) => live && setAnswer({ repo, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [open, repo])

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // the answer carries the repository it read, so a stale list never shows under another one
  const shown = answer?.repo === repo ? answer : null
  const list = shown?.list
  const bound = branchOf(scope)
  // what the highlight sits on: what bounds the graph, else what was last gone to, else HEAD
  const active = bound ?? picked ?? branch

  const take = (taken: Branch) => {
    if (click === 'filter') onScope(scopeOf(taken.name))
    else onReveal(taken)
    setOpen(false)
  }

  return (
    <div className="branches" ref={box}>
      <button className="pick" onClick={() => setOpen(!open)}>
        {/* the star is about the working tree, so it only follows the branch HEAD is on */}
        <span className="strong">{active ?? 'no branch'}{dirty && active === branch ? ' *' : ''}</span>
        <span className="caret">{open ? '^' : 'v'}</span>
      </button>

      {open && (
        <div className="drop">
          {shown?.error && <p className="empty">{shown.error}</p>}
          {!shown && <p className="empty">reading...</p>}
          {list?.branches.length === 0 && <p className="empty">no branch yet</p>}
          {list && list.branches.length > 0 && (
            <>
              {/* only bounding the graph needs a way back out of a branch */}
              {click === 'filter' && (
                <button
                  className={scope === ALL ? 'brow every on' : 'brow every'}
                  onClick={() => {
                    onScope(ALL)
                    setOpen(false)
                  }}
                >
                  <span className="name strong">all branches</span>
                  <span className="cell dim">everything the repository holds</span>
                </button>
              )}
              <p className="head">
                measured against <span className="strong">{list.base ?? 'nothing'}</span>
              </p>
              {list.branches.map((one) => (
                <button
                  key={one.name}
                  className={one.name === active ? 'brow on' : 'brow'}
                  onClick={() => take(one)}
                  title={one.head}
                >
                  <span className="name">
                    <span className="strong">{one.name}</span>
                    {one.current && <span className="vs"> (current)</span>}
                    {one.base && one.base !== list.base && <span className="vs"> vs {one.base}</span>}
                  </span>
                  <span className="cell">
                    <Divergence behind={one.behind} ahead={one.ahead} />
                  </span>
                  <span className="cell" title={one.upstream?.name ?? 'no upstream'}>
                    <Pushed upstream={one.upstream} />
                  </span>
                  <span className="age">{ago(new Date(one.t))}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
