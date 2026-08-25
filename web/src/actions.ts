import { useCallback, useEffect, useRef, useState } from 'react'
import {
  editActions, fetchActions, runAction, stopAction, watchAction,
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
 */
export function useActions(repo: string | null) {
  const [actions, setActions] = useState<Action[]>([])
  const [lines, setLines] = useState<ActionLine[]>([])
  const [running, setRunning] = useState<Running | null>(null)
  const [ended, setEnded] = useState<ActionEnded | null>(null)
  // the run outlives the render it started in, and the end has to find it however late it lands
  const held = useRef<Running | null>(null)

  useEffect(() => {
    let live = true
    fetchActions(repo)
      .then((found) => live && setActions(found))
      .catch(() => live && setActions([]))
    return () => {
      live = false
    }
  }, [repo])

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

  const clear = useCallback(() => {
    setLines([])
    setEnded(null)
  }, [])

  return { actions, lines, running, ended, start, stop, edit, clear }
}
