/**
 * What the graph is bounded to.
 *
 * `all` is every ref the repository holds. `ref:<full name>` is one ref and the
 * history behind it, spelled the long way: `refs/heads/dev`, `refs/tags/v0.7.5`,
 * `refs/remotes/origin/dev`. Git reads a tag as a starting point exactly as it
 * reads a branch, so nothing here has to know which kind it was handed.
 *
 * The full spelling is also what keeps a ref named like an option an option's
 * problem and not ours, and what tells a tag `dev` from a branch `dev`.
 */
export const ALL = 'all'

const REF = 'ref:'

export const HEADS = 'refs/heads/'
export const TAGS = 'refs/tags/'
export const REMOTES = 'refs/remotes/'

export const scopeOf = (refname: string): string => REF + refname

export const refOf = (scope: string): string | null =>
  scope.startsWith(REF) ? scope.slice(REF.length) : null

/** What to call a ref on screen, which is its name without the drawer it lives in. */
export function shortOf(refname: string): string {
  for (const drawer of [HEADS, TAGS, REMOTES]) {
    if (refname.startsWith(drawer)) return refname.slice(drawer.length)
  }
  return refname
}

/**
 * `head`, then `branch:<short name>`: the two shapes this was stored as before.
 * Neither has a control any more, so both are read once and rewritten.
 */
export function readScope(held: string | null): string {
  if (!held || held === 'head') return ALL
  if (held.startsWith('branch:')) return scopeOf(HEADS + held.slice('branch:'.length))
  return held
}
