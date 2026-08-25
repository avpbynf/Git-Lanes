import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFingerprint, fetchGraph, type Graph, type Scope } from './api'

const REF_POLL = 2500
const FULL_RELOAD = 10000

interface Answer {
  key: string
  graph?: Graph
  error?: string
  at: number
}

/**
 * The graph of one repository, kept fresh.
 *
 * A cheap fingerprint of the refs is polled often, and the whole graph is
 * refetched only when it moves, or every ten seconds in any case. A hidden tab
 * polls nothing and catches up the moment it comes back.
 *
 * The answer carries the question it answers, so switching repository shows an
 * empty view at once instead of the previous repository for one frame. The
 * limit is deliberately out of that question: asking for more commits must
 * leave the ones already drawn where the eye left them, not blank the view.
 *
 * Only the last read asked for is allowed to answer, so a slow one landing
 * after a newer one never shortens the graph back.
 */
export function useGraph(repo: string | null, scope: Scope, limit: number) {
  const key = `${repo ?? ''}|${scope}`
  const [answer, setAnswer] = useState<Answer | null>(null)
  const fingerprint = useRef<string | null>(null)
  const ticket = useRef(0)

  const load = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const graph = await fetchGraph(repo, scope, limit)
      if (mine !== ticket.current) return
      fingerprint.current = graph.fingerprint
      setAnswer({ key, graph, at: Date.now() })
    } catch (err) {
      if (mine !== ticket.current) return
      setAnswer({ key, error: err instanceof Error ? err.message : String(err), at: Date.now() })
    }
  }, [repo, scope, limit, key])

  useEffect(() => {
    // the state lands after the fetch resolves, never synchronously here
    // oxlint-disable-next-line react/set-state-in-effect
    void load()
  }, [load])

  useEffect(() => {
    const refs = setInterval(async () => {
      if (document.hidden) return
      try {
        const { fingerprint: current } = await fetchFingerprint(repo)
        if (current && current !== fingerprint.current) void load()
      } catch {
        // the next tick will say whether the backend is really gone
      }
    }, REF_POLL)
    const full = setInterval(() => {
      if (!document.hidden) void load()
    }, FULL_RELOAD)
    const wake = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      clearInterval(refs)
      clearInterval(full)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('focus', wake)
    }
  }, [load, repo])

  const current = answer?.key === key ? answer : null
  return {
    graph: current?.graph ?? null,
    error: current?.error ?? null,
    updatedAt: current?.at ?? 0,
    reload: load,
  }
}
