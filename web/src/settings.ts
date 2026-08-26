import type { Theme } from './lanes'

/** What a click on a ref does: go to its tip, or bound the graph to it. */
export type BranchClick = 'reveal' | 'filter'

/** Whether the commit panel is a column of its own, one a click opens, or nothing. */
export type PanelMode = 'always' | 'onClick' | 'never'

/** When the path a commit came by is lit: under the pointer, on a click, or never. */
export type TrailMode = 'hover' | 'click' | 'off'

export interface Settings {
  theme: Theme
  branchClick: BranchClick
  /**
   * The two side panels.
   *
   * Both are columns of their own, each dragged to the width it deserves.
   * Whoever wants the graph alone says so here, once, rather than opening and
   * closing them all day. The commit panel has a third way: gone until a commit
   * is clicked, and a cross to send it away again.
   */
  showRefs: boolean
  panel: PanelMode
  /**
   * Lighting the path a commit came by dims everything else, which is the point and also the
   * objection: it moves under the pointer whether or not anybody asked. So it is a choice, and
   * the click is there for whoever wants the graph to hold still until they say otherwise.
   */
  trail: TrailMode
}

const KEY = 'settings'

const FALLBACK: Settings = {
  theme: matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark',
  branchClick: 'reveal',
  showRefs: true,
  // the graph keeps its whole width until a commit is actually asked for
  panel: 'onClick',
  trail: 'hover',
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
