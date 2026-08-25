import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { fetchCommit, type Commit, type CommitDetail } from '../api'
import type { PanelMode } from '../settings'

const MIN_WIDTH = 320
const WIDTH = 440

/** How long a read may take before it is worth saying that it is running. */
const PATIENCE = 250

interface Props {
  repo: string | null
  hash: string | null
  /** What the graph already knows of the commit, so the panel answers the click at once. */
  known: Commit | null
  mode: PanelMode
  onClose: () => void
}

interface Answer {
  hash: string
  detail?: CommitDetail
  error?: string
}

function heldWidth(): number {
  const held = Number(localStorage.getItem('panel'))
  return held >= MIN_WIDTH ? held : WIDTH
}

export function CommitPanel({ repo, hash, known, mode, onClose }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [slowFor, setSlowFor] = useState<string | null>(null)
  const [width, setWidth] = useState(heldWidth)
  const sizing = useRef(false)

  useEffect(() => {
    if (!hash) return
    let live = true
    fetchCommit(repo, hash)
      .then((detail) => live && setAnswer({ hash, detail }))
      .catch((err) => live && setAnswer({ hash, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [repo, hash])

  // a read this short is not worth announcing: saying so and unsaying it is the flicker
  useEffect(() => {
    if (!hash) return
    const timer = setTimeout(() => setSlowFor(hash), PATIENCE)
    return () => clearTimeout(timer)
  }, [repo, hash])

  // the pointer is captured, so the drag survives leaving the few pixels it started on
  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    sizing.current = true
  }

  const size = (event: PointerEvent<HTMLDivElement>) => {
    if (sizing.current) setWidth(Math.max(MIN_WIDTH, Math.round(innerWidth - event.clientX)))
  }

  const settle = (event: PointerEvent<HTMLDivElement>) => {
    if (!sizing.current) return
    sizing.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem('panel', String(width))
  }

  // the answer carries its own hash, so a stale one never shows under a new commit
  const shown = answer?.hash === hash ? answer : null
  const detail = shown?.detail
  const [first, ...rest] = (detail?.body ?? '').split('\n')
  const body = rest.join('\n').trim()
  // the subject is already on screen in the row that was clicked, so it lands with the click
  const title = detail ? first : known?.s
  const waiting = Boolean(hash) && !shown && slowFor === hash

  const className = ['panel', mode, hash ? 'open' : ''].filter(Boolean).join(' ')

  return (
    <aside className={className} style={{ width }}>
      <div className="grip" onPointerDown={grab} onPointerMove={size} onPointerUp={settle} />
      <header>
        <span className="strong">commit</span>
        <span className="spacer" />
        {mode === 'over' && <button onClick={onClose}>close</button>}
      </header>
      <div className="panel-body">
        {!hash && <p className="empty">pick a commit in the graph</p>}
        {hash && shown?.error && <p className="empty">{shown.error}</p>}
        {title && <h2>{title}</h2>}
        {waiting && <p className="empty">reading...</p>}
        {detail && (
          <>
            <p className="meta">
              <code>{detail.h.slice(0, 12)}</code> . {detail.an} &lt;{detail.ae}&gt;
              <br />
              {new Date(detail.at).toLocaleString()}
              {detail.merge ? ' . merge commit' : ''}
            </p>
            {body && <pre>{body}</pre>}
            {detail.files.length === 0 ? (
              <p className="empty">no file listed, which is what a merge shows</p>
            ) : (
              detail.files.map((file) => (
                <div key={file.path} className="file">
                  <span className="n">
                    {file.a === null ? 'bin' : <><i className="a">+{file.a}</i> <i className="d">-{file.d}</i></>}
                  </span>
                  <span className="p">{file.path}</span>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </aside>
  )
}
