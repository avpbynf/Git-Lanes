import type { Theme } from './lanes'

/** What a click on a branch does: bound the graph to it, or go to its tip. */
export type BranchClick = 'filter' | 'reveal'

/** Where the commit panel lives: over the graph, or beside it for good. */
export type PanelMode = 'over' | 'beside'

export interface Settings {
  theme: Theme
  branchClick: BranchClick
  panel: PanelMode
}

const KEY = 'settings'

const FALLBACK: Settings = {
  theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  branchClick: 'reveal',
  panel: 'over',
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
