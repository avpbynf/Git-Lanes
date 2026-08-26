import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  canRunActions, fetchCommit, fetchWorking, WORKING,
  type Commit, type CommitDetail, type WorkingDetail,
} from '../api'
import { useActions } from '../actions'
import { MIN_WIDTH, usePanelWidth, WIDTH } from '../panel'
import type { PanelMode } from '../settings'

const CLOSE = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" />
  </svg>
)

/** Opens the file the commands are written in, which is the only way there is to add one. */
const PENCIL = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.5 13.5l1-3.5 7-7 2.5 2.5-7 7-3.5 1zM9.5 4l2.5 2.5" />
  </svg>
)

/** How long a read may take before it is worth saying that it is running. */
const PATIENCE = 250

interface Props {
  repo: string | null
  hash: string | null
  /** What the graph already knows of the commit, so the panel answers the click at once. */
  known: Commit | null
  /** The repository's fingerprint, which is also what says the file of commands was saved. */
  beat: string | undefined
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

export function CommitPanel({ repo, hash, known, beat, mode, onClose }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [slowFor, setSlowFor] = useState<string | null>(null)
  const { width, grip } = usePanelWidth('panel', WIDTH, MIN_WIDTH, 'right')
  const doing = useActions(repo, beat)
  const tail = useRef<HTMLDivElement>(null)

  // a build says a lot and what is being waited for is the last line of it
  useEffect(() => {
    tail.current?.scrollIntoView({ block: 'end' })
  }, [doing.lines, doing.ended])

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

  // the row of commands, which is now empty when a project has written none: what used to fill
  // it in that case was the way in to the file, and the way in is the pencil in the header
  const doable =
    canRunActions &&
    hash &&
    !hash.startsWith(WORKING) &&
    (doing.actions.length > 0 || doing.trouble || doing.running)

  const added = detail?.files.reduce((sum, file) => sum + (file.a ?? 0), 0) ?? 0
  const removed = detail?.files.reduce((sum, file) => sum + (file.d ?? 0), 0) ?? 0

  /**
   * One file of the two lists, which are the same list twice and now answer a click alike.
   *
   * A row is only worth clicking where something is written to open it, so where nothing is it
   * stays a row: a cursor that promises what no click delivers is worse than no cursor at all.
   */
  const open = doing.diffReady && Boolean(hash)
  const row = (key: string, path: string, counts: ReactNode) => (
    <div
      key={key}
      className={open ? 'file open' : 'file'}
      title={open ? `${path} . open the diff` : path}
      onClick={open && hash ? () => void doing.diff(hash, path) : undefined}
    >
      <span className="n">{counts}</span>
      <span className="p">{path}</span>
    </div>
  )

  return (
    <aside className={shown ? 'panel' : 'panel gone'} style={{ width }}>
      <div className="grip" {...grip} />
      <header>
        <span className="strong">{hash?.startsWith(WORKING) ? 'worktree' : 'commit'}</span>
        <span className="spacer" />
        {canRunActions && (
          <button
            className="icon"
            title={doing.actions.length ? 'edit the actions' : 'add an action'}
            onClick={() => void doing.edit()}
          >
            {PENCIL}
          </button>
        )}
        {mode === 'onClick' && (
          <button className="icon" title="close" onClick={onClose}>{CLOSE}</button>
        )}
      </header>
      <div className={waiting ? 'panel-body waiting' : 'panel-body'}>
        {!hash && <p className="empty">pick a commit in the graph</p>}
        {held?.error && <p className="empty">{held.error}</p>}
        {title && <h2>{title}</h2>}
        {waiting && !held && <p className="empty">reading...</p>}
        {doable && (
          <div className="doings">
            {doing.actions.map((action, index) => (
              <button
                key={action.name}
                disabled={Boolean(doing.running)}
                title={
                  doing.running
                    ? `${doing.running.name} is running on ${doing.running.sha.slice(0, 7)}`
                    : action.run
                }
                onClick={() => {
                  const refname = known?.refs.find((ref) => ref.k === 'local')?.n ?? ''
                  void doing.start(index, hash, refname)
                }}
              >
                {action.name}
              </button>
            ))}
            {doing.trouble && <span className="trouble">{doing.trouble}</span>}
            {doing.running && (
              <button className="quiet" onClick={() => void doing.stop()}>stop</button>
            )}
          </div>
        )}

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
              work.files.map((file) =>
                row(
                  file.st + file.path,
                  file.path,
                  file.st === 'untracked'
                    ? <i className="a">new</i>
                    : file.a === null
                      ? 'bin'
                      : <><i className="a">+{file.a}</i> <i className="d">-{file.d}</i></>,
                ),
              )
            )}
          </>
        )}
        {detail && (
          <>
            <p className="meta">
              <code>{detail.h.slice(0, 12)}</code> . <span title={detail.ae}>{detail.an}</span> .{' '}
              {new Date(detail.at).toLocaleString()}
              {detail.merge ? ' . merge commit' : ''}
              {detail.files.length > 0 && (
                <>
                  <br />
                  {detail.files.length} file{detail.files.length === 1 ? '' : 's'} .{' '}
                  <i className="a">+{added}</i> <i className="d">-{removed}</i>
                </>
              )}
            </p>
            {body && <pre>{body}</pre>}
            {detail.files.length === 0 ? (
              <p className="empty">no file listed, which is what a merge shows</p>
            ) : (
              detail.files.map((file) =>
                row(
                  file.path,
                  file.path,
                  file.a === null
                    ? 'bin'
                    : <><i className="a">+{file.a}</i> <i className="d">-{file.d}</i></>,
                ),
              )
            )}
          </>
        )}

        {/* last, so that what a command writes never pushes the commit's own facts off the
            screen: the output is the one thing here that grows while somebody is reading */}
        {doing.logFor === hash && (doing.lines.length > 0 || doing.ended) && (
          <div className="log">
            <p className={doing.ended && doing.ended.code !== 0 ? 'empty bad' : 'empty'}>
              {doing.running
                ? `${doing.running.name}, on ${doing.running.sha.slice(0, 7)}`
                : doing.ended?.message}
              <button className="quiet" onClick={doing.clear}>clear</button>
            </p>
            <pre>
              {doing.lines.map((line, index) => (
                <span key={index} className={line.bad ? 'bad' : undefined}>
                  {line.text}
                  {'\n'}
                </span>
              ))}
              <div ref={tail} />
            </pre>
          </div>
        )}
      </div>
    </aside>
  )
}
