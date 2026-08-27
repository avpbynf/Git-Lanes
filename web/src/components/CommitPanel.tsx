import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  canRunActions, fetchCommit, fetchWorking, WORKING,
  type Commit, type CommitDetail, type WorkingDetail,
} from '../api'
import { useActions } from '../actions'
import { since } from '../lanes'
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

/** How long the hash says it was copied, before it goes back to being a hash. */
const COPIED = 1200

/** How much of a hash is shown, and therefore how much of it a click copies. */
const SHORT = 12

/**
 * How much of a path is worth keeping.
 *
 * The panel is a narrow column on purpose, and what tells two files apart is the end of their
 * path rather than the repository they both sit in. The whole of it stays in the tooltip.
 */
const DEPTH = 4

/**
 * A date and a time, with nothing between them.
 *
 * What the line itself carries is how long ago, since that is what anybody reads first and it
 * is four characters rather than twenty. This is what the cursor brings, and `toLocaleString`
 * is not used for it: the comma it inserts is the only comma in a line that separates
 * everything else with a dash.
 */
function stamp(at: string): string {
  const date = new Date(at)
  return `${date.toLocaleDateString(undefined, { dateStyle: 'medium' })} ${date.toLocaleTimeString(
    undefined,
    { timeStyle: 'short' },
  )}`
}

function shorten(path: string): [boolean, string] {
  const parts = path.split('/')
  return parts.length > DEPTH ? [true, parts.slice(-DEPTH).join('/')] : [false, path]
}

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
  /**
   * What the last click on a hash did, and to which hash.
   *
   * The hash it names is what puts the word back on a second click of the same one, and the
   * refusal is carried rather than swallowed: a button that answers nothing at all reads as a
   * button nobody wired up.
   */
  const [copied, setCopied] = useState<{ of: string; ok: boolean } | null>(null)
  /**
   * The hash whose output is being read, rather than a tab on its own.
   *
   * Everything else in this panel keeps what it was asked for beside what it got, and a tab is
   * no different: another commit is another question, and the answer to it opens on its facts.
   */
  const [onRun, setOnRun] = useState<string | null>(null)
  /** What the second tab is called, which is the command's own name and outlives its run. */
  const [ran, setRan] = useState<string | null>(null)
  const { width, grip } = usePanelWidth('panel', WIDTH, MIN_WIDTH, 'right')
  const doing = useActions(repo, beat)
  const tail = useRef<HTMLDivElement>(null)
  const column = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), COPIED)
    return () => clearTimeout(timer)
  }, [copied])

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

  /**
   * The second tab exists only once something has been run on this commit.
   *
   * A tab that is always there and empty most of the time is a tab nobody reads: what a
   * command writes is worth a place of its own exactly as long as there is a command to
   * write it, and `clear` is what takes that place back.
   */
  const output = doing.logFor === hash && (doing.lines.length > 0 || Boolean(doing.ended) || Boolean(doing.running))
  const showing = output && onRun === hash ? 'run' : 'commit'

  const added = detail?.files.reduce((sum, file) => sum + (file.a ?? 0), 0) ?? 0
  const removed = detail?.files.reduce((sum, file) => sum + (file.d ?? 0), 0) ?? 0

  /**
   * One file of the two lists, which are the same list twice and now answer a click alike.
   *
   * A row is only worth clicking where something is written to open it, so where nothing is it
   * stays a row: a cursor that promises what no click delivers is worse than no cursor at all.
   */
  const open = doing.diffReady && Boolean(hash)
  const listed = (detail?.files.length ?? 0) + (work?.files.length ?? 0)
  const row = (key: string, path: string, counts: ReactNode) => {
    const [cut, kept] = shorten(path)
    return (
      <div
        key={key}
        className={open ? 'file open' : 'file'}
        title={open ? `${path} . open the diff` : path}
        onClick={open && hash ? () => void doing.diff(hash, path) : undefined}
      >
        <span className="n">{counts}</span>
        {/* outside the path rather than in front of it: the path is read right to left so that
            a column too narrow for it loses its head, and a dot put in there goes to the wrong
            end of the line */}
        <span className="path">
          {cut && <i className="cut">...</i>}
          <span className="p">{kept}</span>
        </span>
      </div>
    )
  }

  /** What it copies is what it shows, since git reads a hash as short as this one anyway. */
  const copy = () => {
    if (!detail) return
    const { h } = detail
    navigator.clipboard.writeText(h.slice(0, SHORT)).then(
      () => setCopied({ of: h, ok: true }),
      () => setCopied({ of: h, ok: false }),
    )
  }

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
      {output && (
        <div className="tabs">
          <button
            className={showing === 'commit' ? 'on' : undefined}
            onClick={() => setOnRun(null)}
          >
            context
          </button>
          {/* a command names itself as long as it likes, and half a narrow column is what
              there is: the whole of it stays under the cursor */}
          <button
            className={showing === 'run' ? 'on' : undefined}
            title={doing.running?.name ?? ran ?? 'what the last command wrote'}
            onClick={() => setOnRun(hash)}
          >
            {doing.running?.name ?? ran ?? 'output'}
          </button>
        </div>
      )}
      <div ref={column} className={waiting ? 'panel-body waiting' : 'panel-body'}>
        {showing === 'run' ? (
          <div className="log">
            <p className={doing.ended && doing.ended.code !== 0 ? 'empty bad' : 'empty'}>
              {doing.running
                ? `running on ${doing.running.sha.slice(0, 7)}`
                : doing.ended?.message}
              <span className="spacer" />
              {doing.running ? (
                <button className="quiet" onClick={() => void doing.stop()}>stop</button>
              ) : (
                <button className="quiet" onClick={doing.clear}>clear</button>
              )}
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
        ) : (
          <>
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
                      setRan(action.name)
                      setOnRun(hash)
                      void doing.start(index, hash, refname)
                    }}
                  >
                    {action.name}
                  </button>
                ))}
                {doing.trouble && <span className="trouble">{doing.trouble}</span>}
              </div>
            )}

            {work && (
              <>
                <p className="meta">
                  <code>{work.branch}</code> - {work.here ? 'the worktree being read' : work.path}
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
                  <span title={detail.ae}>{detail.an}</span>
                  {' - '}
                  <span title={stamp(detail.at)}>{since(new Date(detail.at))}</span>
                  {detail.merge ? ' - merge commit' : ''}
                  {' - '}
                  <button className="sha" title="copy this hash" onClick={copy}>
                    {copied?.of === detail.h
                      ? copied.ok
                        ? 'copied'
                        : 'no clipboard'
                      : detail.h.slice(0, SHORT)}
                  </button>
                  {detail.files.length > 0 && (
                    <>
                      {' - '}
                      {/* the summary of what changed is also the way down to what changed:
                          the list it counts is the one thing here that a click cannot reach */}
                      <button
                        className="jump"
                        title="down to the files"
                        onClick={() =>
                          column.current?.scrollTo({ top: column.current.scrollHeight })
                        }
                      >
                        {detail.files.length} file{detail.files.length === 1 ? '' : 's'}{' '}
                        <i className="a">+{added}</i> <i className="d">-{removed}</i>
                      </button>
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

            {/* said rather than left to be noticed: a list of files that opens nothing looks
                exactly like a list of files whose rows nobody thought to make clickable */}
            {canRunActions && !doing.diffReady && listed > 0 && (
              <p className="lack">
                nothing in your own file says what opens a diff, so these are rows rather than
                buttons. The pencil above opens that file.
              </p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
