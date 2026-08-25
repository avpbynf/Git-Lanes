import type { Theme } from './lanes'

/** What a click on a ref does: go to its tip, or bound the graph to it. */
export type BranchClick = 'reveal' | 'filter'

export interface Settings {
  theme: Theme
  branchClick: BranchClick
  /** The refs panel: whether it is showing, and whether it holds its own room. */
  refsOpen: boolean
  refsPinned: boolean
  /** The commit panel only holds its own room; a commit is what opens it. */
  panelPinned: boolean
}

const KEY = 'settings'

const FALLBACK: Settings = {
  theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  branchClick: 'reveal',
  refsOpen: false,
  refsPinned: false,
  panelPinned: false,
}

/** A key the stored shape never had falls back, so an old blob never breaks a boot. */
export function readSettings(): Settings {
  try {
    const held = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>
    return { ...FALLBACK, ...held }
  } catch {
    return FALLBACK
  }
}

export function writeSettings(settings: Settings): void {
  localStorage.setItem(KEY, JSON.stringify(settings))
}
