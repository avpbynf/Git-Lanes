import { useEffect, useRef, useState } from 'react'
import { fetchBranches, type Branch, type BranchList } from '../api'
import { ago } from '../lanes'

interface Props {
  repo: string | null
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

export function BranchDivergence({ repo }: Props) {
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

  return (
    <div className="branches" ref={box}>
      <button className="pick" onClick={() => setOpen(!open)}>
        branches
        <span className="caret">{open ? '^' : 'v'}</span>
      </button>

      {open && (
        <div className="drop">
          {shown?.error && <p className="empty">{shown.error}</p>}
          {!shown && <p className="empty">reading...</p>}
          {list?.branches.length === 0 && <p className="empty">no branch yet</p>}
          {list && list.branches.length > 0 && (
            <>
              <p className="head">
                measured against <span className="strong">{list.base ?? 'nothing'}</span>
              </p>
              {list.branches.map((branch) => (
                <div key={branch.name} className={branch.current ? 'brow on' : 'brow'}>
                  <span className="name" title={branch.head}>
                    <span className="strong">{branch.name}</span>
                    {branch.base && branch.base !== list.base && <span className="vs"> vs {branch.base}</span>}
                  </span>
                  <span className="cell">
                    <Divergence behind={branch.behind} ahead={branch.ahead} />
                  </span>
                  <span className="cell" title={branch.upstream?.name ?? 'no upstream'}>
                    <Pushed upstream={branch.upstream} />
                  </span>
                  <span className="age">{ago(new Date(branch.t))}</span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
