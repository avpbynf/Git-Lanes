import type { Commit } from './api'

/**
 * The text filter, which dims rather than removes.
 *
 * It stays in the browser on purpose: what git filters out never comes back to
 * be dimmed, and dimming is what keeps the shape of the graph readable while
 * the eye looks for one commit in it.
 */
export interface Search {
  match: (commit: Commit) => boolean
  /** A regular expression still being typed, which compiles to nothing yet. */
  broken: boolean
}

const EVERYTHING = () => true

export function searching(query: string, regex: boolean, matchCase: boolean): Search {
  const needle = query.trim()
  if (!needle) return { match: EVERYTHING, broken: false }

  if (regex) {
    let pattern: RegExp
    try {
      pattern = new RegExp(needle, matchCase ? '' : 'i')
    } catch {
      // half an expression matches nothing, and dimming the whole graph says nothing
      return { match: EVERYTHING, broken: true }
    }
    return {
      match: (commit) =>
        pattern.test(commit.s) ||
        pattern.test(commit.an) ||
        pattern.test(commit.h) ||
        commit.refs.some((ref) => pattern.test(ref.n)),
      broken: false,
    }
  }

  const held = matchCase ? needle : needle.toLowerCase()
  const fold = (text: string) => (matchCase ? text : text.toLowerCase())
  return {
    match: (commit) =>
      fold(commit.s).includes(held) ||
      fold(commit.an).includes(held) ||
      commit.h.startsWith(needle.toLowerCase()) ||
      commit.refs.some((ref) => fold(ref.n).includes(held)),
    broken: false,
  }
}
