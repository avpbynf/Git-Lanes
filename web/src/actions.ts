import { useCallback, useEffect, useRef, useState } from 'react'
import {
  editActions, fetchActions, fetchDiffReady, openDiff, runAction, stopAction, watchAction, WORKING,
  type Action, type ActionEnded, type ActionLine,
} from './api'

/** How many lines of output are kept. A build says a lot, and nobody scrolls back past this. */
const KEPT = 2000

interface Running {
  /** The commit it was started on, so a run reads as belonging to a row and not to the window. */
  sha: string
  name: string
}

/**
 * A project's own commands, and the one that is running.
 *
 * The listening is set up once and not per run: the events come from the window itself, and a
 * page that subscribed on every click would end up with as many listeners as clicks.
 *
 * `beat` is the repository's fingerprint, which carries the stamp of the file the commands are
 * written in. Reading them again whenever it moves is what puts an edit on screen: the file is
 * opened in whatever the system opens JSON with, and nothing else here would ever hear it saved.
 */
export function useActions(repo: string | null, beat: string | undefined) {
  const [actions, setActions] = useState<Action[]>([])
  /** Whether a file in the panel is worth clicking, which the same file decides. */
  const [diffReady, setDiffReady] = useState(false)
  /** Why there are none, when the reason is not simply that none are written. */
  const [trouble, setTrouble] = useState<string | null>(null)
  /** The commit the output on screen belongs to, and nowhere else is it shown. */
  const [logFor, setLogFor] = useState<string | null>(null)
  const [lines, setLines] = useState<ActionLine[]>([])
  const [running, setRunning] = useState<Running | null>(null)
  const [ended, setEnded] = useState<ActionEnded | null>(null)
  // the run outlives the render it started in, and the end has to find it however late it lands
  const held = useRef<Running | null>(null)

  useEffect(() => {
    let live = true
    fetchActions(repo)
      .then((found) => {
        if (!live) return
        setActions(found)
        setTrouble(null)
      })
      .catch((err) => {
        if (!live) return
        setActions([])
        // said out loud rather than swallowed: a list that is empty because the file would not
        // parse looks exactly like a list that is empty because nothing is written in it
        setTrouble(err instanceof Error ? err.message : String(err))
      })
    fetchDiffReady()
      .then((ready) => live && setDiffReady(ready))
      .catch(() => live && setDiffReady(false))
    return () => {
      live = false
    }
  }, [repo, beat])

  useEffect(() => {
    let stop: (() => void) | null = null
    let live = true
    void watchAction(
      (line) => setLines((was) => (was.length > KEPT ? [...was.slice(-KEPT), line] : [...was, line])),
      (over) => {
        setEnded(over)
        setRunning(null)
        held.current = null
      },
    ).then((off) => {
      if (live) stop = off
      else off()
    })
    return () => {
      live = false
      stop?.()
    }
  }, [])

  const start = useCallback(
    async (index: number, sha: string, refname: string) => {
      const action = actions[index]
      if (!action) return
      setLines([])
      setEnded(null)
      const now = { sha, name: action.name }
      setRunning(now)
      setLogFor(sha)
      held.current = now
      try {
        await runAction(repo, index, sha, refname)
      } catch (err) {
        setRunning(null)
        held.current = null
        setEnded({ code: -1, message: err instanceof Error ? err.message : String(err) })
      }
    },
    [actions, repo],
  )

  const stop = useCallback(async () => {
    try {
      await stopAction()
    } catch (err) {
      setEnded({ code: -1, message: err instanceof Error ? err.message : String(err) })
      setRunning(null)
      held.current = null
    }
  }, [])

  /** Opens the file the actions are written in, which is the only way there is to add one. */
  const edit = useCallback(async () => {
    try {
      await editActions(repo)
    } catch (err) {
      setEnded({ code: -1, message: err instanceof Error ? err.message : String(err) })
    }
  }, [repo])

  /**
   * One file's two sides, in whatever the user's own line says opens them.
   *
   * What was clicked is either a commit or a worktree, and the row already says which: what goes
   * wrong is said where a command's own trouble is said, rather than swallowed.
   */
  const diff = useCallback(
    async (hash: string, path: string) => {
      const folder = hash.startsWith(WORKING) ? hash.slice(WORKING.length) : ''
      try {
        await openDiff(repo, folder ? '' : hash, path, folder)
      } catch (err) {
        setLogFor(hash)
        setEnded({ code: -1, message: err instanceof Error ? err.message : String(err) })
      }
    },
    [repo],
  )

  const clear = useCallback(() => {
    setLines([])
    setEnded(null)
    setLogFor(null)
  }, [])

  return { actions, diffReady, trouble, lines, logFor, running, ended, start, stop, edit, diff, clear }
}
