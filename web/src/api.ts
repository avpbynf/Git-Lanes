export type RefKind = 'head' | 'local' | 'remote' | 'tag'

export interface GitRef {
  n: string
  k: RefKind
}

export interface Commit {
  h: string
  p: string[]
  an: string
  t: string
  s: string
  refs: GitRef[]
  lane: number
  row: number
  c: number
}

/** One parent link. It leaves fr/fl, travels down lane rl, and lands on tr/tl. */
export interface Edge {
  fr: number
  fl: number
  rl: number
  c: number
  tr: number | null
  tl: number
}

export interface Graph {
  repo: string
  path: string
  branch: string
  dirty: boolean
  commits: Commit[]
  edges: Edge[]
  lanes: number
  truncated: boolean
  fingerprint: string
}

/** Where a branch stands against the remote branch it tracks, if it tracks one. */
export interface Upstream {
  name: string
  behind: number
  ahead: number
  gone: boolean
}

export interface Branch {
  name: string
  head: string
  t: string
  current: boolean
  base: string | null
  behind: number
  ahead: number
  upstream: Upstream | null
}

export interface BranchList {
  base: string | null
  branches: Branch[]
}

export interface RepoEntry {
  path: string
  name: string
  branch?: string
  dirty?: boolean
  error?: string
}

export interface CommitFile {
  a: number | null
  d: number | null
  path: string
}

export interface CommitDetail {
  h: string
  an: string
  ae: string
  at: string
  cn: string
  ct: string
  body: string
  files: CommitFile[]
  merge: boolean
}

/** `all`, or `branch:<name>`. The backends read it, the front end spells it in scope.ts. */
export type Scope = string

/**
 * How the rows are ordered.
 *
 * `date` reads down the calendar, so two branches worked on the same afternoon
 * interleave. `topo` keeps a branch whole, at the cost of dates that jump.
 */
export type Order = 'date' | 'topo'

async function get<T>(path: string, params: Record<string, string | number | undefined> = {}): Promise<T> {
  const url = new URL(path, location.origin)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  const response = await fetch(url)
  const payload = await response.json()
  if (!response.ok || payload?.error) throw new Error(payload?.error ?? response.statusText)
  return payload as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json()
  if (!response.ok || payload?.error) throw new Error(payload?.error ?? response.statusText)
  return payload as T
}

/**
 * Two ways in, one shape out.
 *
 * Inside the desktop window the calls go straight to Rust, and there is no
 * server at all. In a browser they go to the Python backend over HTTP. The
 * answers are identical, so nothing above this file knows which one it got.
 */
type Invoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>

const desktop = (globalThis as { __TAURI__?: { core?: { invoke?: Invoke } } }).__TAURI__?.core?.invoke

export const insideApp = Boolean(desktop)

export const fetchGraph = (repo: string | null, scope: Scope, limit: number, order: Order) =>
  desktop
    ? (desktop('graph', { repo, scope, limit, order }) as Promise<Graph>)
    : get<Graph>('/api/graph', { repo: repo ?? undefined, scope, limit, order })

export const fetchBranches = (repo: string | null) =>
  desktop
    ? (desktop('branches', { repo }) as Promise<BranchList>)
    : get<BranchList>('/api/branches', { repo: repo ?? undefined })

export const fetchFingerprint = (repo: string | null) =>
  desktop
    ? (desktop('fingerprint', { repo }) as Promise<string>).then((fingerprint) => ({ fingerprint }))
    : get<{ fingerprint: string }>('/api/fingerprint', { repo: repo ?? undefined })

export const fetchCommit = (repo: string | null, hash: string) =>
  desktop
    ? (desktop('commit_detail', { repo, hash }) as Promise<CommitDetail>)
    : get<CommitDetail>('/api/commit', { repo: repo ?? undefined, h: hash })

export const fetchRepos = () =>
  desktop
    ? (desktop('repos') as Promise<{ repos: RepoEntry[]; default: string | null }>)
    : get<{ repos: RepoEntry[]; default: string | null }>('/api/repos')

export const discoverRepos = (root: string) =>
  desktop
    ? (desktop('discover', { root }) as Promise<RepoEntry[]>).then((repos) => ({ repos }))
    : get<{ repos: RepoEntry[] }>('/api/discover', { root })

export const openRepo = (path: string) =>
  desktop
    ? (desktop('open_repo', { path }) as Promise<RepoEntry>).then((repo) => ({ repo }))
    : post<{ repo: RepoEntry }>('/api/repos/open', { path })

export const closeRepo = (path: string) =>
  desktop
    ? (desktop('close_repo', { path }) as Promise<RepoEntry[]>).then((repos) => ({ repos }))
    : post<{ repos: RepoEntry[] }>('/api/repos/close', { path })
