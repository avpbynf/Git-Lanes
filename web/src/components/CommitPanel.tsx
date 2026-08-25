import { useEffect, useState } from 'react'
import {
  fetchCommit, fetchWorking, WORKING,
  type Commit, type CommitDetail, type WorkingDetail,
} from '../api'
import { usePanelWidth } from '../panel'
import type { PanelMode } from '../settings'

const CLOSE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />
  </svg>
)

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
  /** Read instead of a commit when what was clicked is a worktree's uncommitted work. */
  work?: WorkingDetail
  error?: string
}

export function CommitPanel({ repo, hash, known, mode, onClose }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [slowFor, setSlowFor] = useState<string | null>(null)
  const { width, grip } = usePanelWidth('panel', WIDTH, MIN_WIDTH, 'right')

  useEffect(() => {
    if (!hash) return
    let live = true
    const folder = hash.startsWith(WORKING) ? hash.slice(WORKING.length) : null
    const read: Promise<Answer> = folder
      ? fetchWorking(repo, folder).then((work) => ({ hash, work }))
      : fetchCommit(repo, hash).then((detail) => ({ hash, detail }))
    read
      .then((answer) => live && setAnswer(answer))
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

  /**
   * The commit last read in full stays until the next one is read in full.
   *
   * A body that empties and fills again is what the eye reads as a flicker, and
   * a local read is quick enough that the swap looks like one move. Held past a
   * quarter of a second it fades, so nothing pretends to answer for a commit it
   * was not read for.
   */
  const held = hash ? answer : null
  const detail = held?.detail
  const work = held?.work
  const [first, ...rest] = (detail?.body ?? '').split('\n')
  const body = rest.join('\n').trim()
  // nothing to hold on the first open, so the row that was clicked lends its subject
  const title = held ? (work ? 'uncommitted changes' : detail ? first : undefined) : known?.s
  const waiting = Boolean(hash) && held?.hash !== hash && slowFor === hash

  // asked for on a click, it is the click that brings it, and the cross that sends it away
  const shown = mode === 'always' || (mode === 'onClick' && Boolean(hash))

  return (
    <aside className={shown ? 'panel' : 'panel gone'} style={{ width }}>
      <div className="grip" {...grip} />
      <header>
        <span className="strong">{hash?.startsWith(WORKING) ? 'worktree' : 'commit'}</span>
        {mode === 'onClick' && (
          <>
            <span className="spacer" />
            <button className="icon" title="close" onClick={onClose}>{CLOSE}</button>
          </>
        )}
      </header>
      <div className={waiting ? 'panel-body waiting' : 'panel-body'}>
        {!hash && <p className="empty">pick a commit in the graph</p>}
        {held?.error && <p className="empty">{held.error}</p>}
        {title && <h2>{title}</h2>}
        {waiting && !held && <p className="empty">reading...</p>}
        {work && (
          <>
            <p className="meta">
              <code>{work.branch}</code> . {work.here ? 'the worktree being read' : work.path}
              <br />
              {work.staged} staged, {work.changed} changed, {work.untracked} untracked
            </p>
            {work.files.length === 0 ? (
              <p className="empty">nothing left uncommitted here</p>
            ) : (
              work.files.map((file) => (
                <div key={file.st + file.path} className="file">
                  <span className="n">
                    {file.st === 'untracked'
                      ? <i className="a">new</i>
                      : file.a === null
                        ? 'bin'
                        : <><i className="a">+{file.a}</i> <i className="d">-{file.d}</i></>}
                  </span>
                  <span className="p">{file.path}</span>
                </div>
              ))
            )}
          </>
        )}
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
