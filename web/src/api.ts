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

export type Scope = 'all' | 'head'

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

export const fetchGraph = (repo: string | null, scope: Scope, limit: number) =>
  get<Graph>('/api/graph', { repo: repo ?? undefined, scope, limit })

export const fetchFingerprint = (repo: string | null) =>
  get<{ fingerprint: string }>('/api/fingerprint', { repo: repo ?? undefined })

export const fetchCommit = (repo: string | null, hash: string) =>
  get<CommitDetail>('/api/commit', { repo: repo ?? undefined, h: hash })

export const fetchRepos = () =>
  get<{ repos: RepoEntry[]; default: string | null }>('/api/repos')

export const discoverRepos = (root: string) =>
  get<{ repos: RepoEntry[] }>('/api/discover', { root })

export const openRepo = (path: string) =>
  post<{ repo: RepoEntry }>('/api/repos/open', { path })

export const closeRepo = (path: string) =>
  post<{ repos: RepoEntry[] }>('/api/repos/close', { path })
