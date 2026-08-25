/**
 * What the graph is bounded to.
 *
 * `all` is every ref the repository holds. `branch:<name>` is one branch and
 * the history behind it. The prefix is what keeps a branch actually named
 * `all` from being read as the whole repository.
 */
export const ALL = 'all'

const PREFIX = 'branch:'

export const scopeOf = (branch: string): string => PREFIX + branch

export const branchOf = (scope: string): string | null =>
  scope.startsWith(PREFIX) ? scope.slice(PREFIX.length) : null

/** `head` is what the first version stored, and it no longer has a control. */
export const readScope = (held: string | null): string => (!held || held === 'head' ? ALL : held)
