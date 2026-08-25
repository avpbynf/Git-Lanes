import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchFingerprint, fetchGraph, type Filters, type Graph, type Order, type Scope } from './api'

const REF_POLL = 2500

interface Answer {
  key: string
  graph?: Graph
  error?: string
  at: number
}

/**
 * The graph of one repository, read whole and kept fresh.
 *
 * Whole because a page of it costs almost as much: measured on six thousand
 * commits, reading everything took eighty milliseconds more than reading four
 * hundred. What a read costs is spawning git, not walking history, so asking
 * again while scrolling was paying that price over and over for nothing.
 *
 * What is polled is a cheap fingerprint of the refs, of HEAD and of the working
 * tree, and the graph is read again only when it moves. There is no blind
 * reload on a timer: at two megabytes a repository it would be the one thing
 * this tool does that costs anything. A hidden tab polls nothing and catches up
 * the moment it comes back.
 *
 * The answer carries the question it answers, so switching repository shows an
 * empty view at once instead of the previous one for a frame. And only the last
 * read asked for may answer, so a slow one landing late never puts back what a
 * newer one replaced.
 */
export function useGraph(repo: string | null, scope: Scope, order: Order, filters: Filters) {
  const key = `${repo ?? ''}|${scope}`
  const [answer, setAnswer] = useState<Answer | null>(null)
  const fingerprint = useRef<string | null>(null)
  const ticket = useRef(0)

  const load = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const graph = await fetchGraph(repo, scope, order, filters)
      if (mine !== ticket.current) return
      fingerprint.current = graph.fingerprint
      setAnswer({ key, graph, at: Date.now() })
    } catch (err) {
      if (mine !== ticket.current) return
      setAnswer({ key, error: err instanceof Error ? err.message : String(err), at: Date.now() })
    }
  }, [repo, scope, order, filters, key])

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
    const wake = () => {
      if (!document.hidden) void load()
    }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('focus', wake)
    return () => {
      clearInterval(refs)
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
