import type { Theme } from './lanes'

/** What a click on a ref does: go to its tip, or bound the graph to it. */
export type BranchClick = 'reveal' | 'filter'

export interface Settings {
  theme: Theme
  branchClick: BranchClick
  /**
   * The two side panels.
   *
   * Both are columns of their own, always there, each dragged to the width it
   * deserves. Whoever wants the graph alone says so here, once, rather than
   * opening and closing them all day.
   */
  showRefs: boolean
  showPanel: boolean
}

const KEY = 'settings'

const FALLBACK: Settings = {
  theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  branchClick: 'reveal',
  showRefs: true,
  showPanel: true,
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
