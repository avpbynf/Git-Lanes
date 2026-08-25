import { useEffect, useState } from 'react'
import { fetchCommit, type Commit, type CommitDetail } from '../api'
import { usePanelWidth } from '../panel'
import { CLOSE, PIN } from './icons'

const MIN_WIDTH = 320
const WIDTH = 440

/** How long a read may take before it is worth saying that it is running. */
const PATIENCE = 250

interface Props {
  repo: string | null
  hash: string | null
  /** What the graph already knows of the commit, so the panel answers the click at once. */
  known: Commit | null
  pinned: boolean
  onPin: (pinned: boolean) => void
  onClose: () => void
}

interface Answer {
  hash: string
  detail?: CommitDetail
  error?: string
}

export function CommitPanel({ repo, hash, known, pinned, onPin, onClose }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [slowFor, setSlowFor] = useState<string | null>(null)
  const { width, grip } = usePanelWidth('panel', WIDTH, MIN_WIDTH, 'right')

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
  const [first, ...rest] = (detail?.body ?? '').split('\n')
  const body = rest.join('\n').trim()
  // nothing to hold on the first open, so the row that was clicked lends its subject
  const title = held ? (detail ? first : undefined) : known?.s
  const waiting = Boolean(hash) && held?.hash !== hash && slowFor === hash

  const className = ['panel', pinned ? 'pinned' : 'over', hash ? 'open' : '']
    .filter(Boolean)
    .join(' ')

  return (
    <aside className={className} style={{ width }}>
      <div className="grip" {...grip} />
      <header>
        <span className="strong">commit</span>
        <span className="spacer" />
        <button
          className={pinned ? 'icon pin on' : 'icon pin'}
          title={pinned ? 'let it float over the graph' : 'hold its own room'}
          onClick={() => onPin(!pinned)}
        >
          {PIN}
        </button>
        <button className="icon" title="close" onClick={onClose}>{CLOSE}</button>
      </header>
      <div className={waiting ? 'panel-body waiting' : 'panel-body'}>
        {!hash && <p className="empty">pick a commit in the graph</p>}
        {held?.error && <p className="empty">{held.error}</p>}
        {title && <h2>{title}</h2>}
        {waiting && !held && <p className="empty">reading...</p>}
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
