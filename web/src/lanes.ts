import type { Edge } from './api'

export const ROW = 28
/** The day label and nothing else, wide enough for `25 Aug 24`, until a hand says otherwise. */
export const GUTTER = 64
/** The strip naming the columns, which is also what they are dragged by. */
export const HEAD = 24
/**
 * How much room the drawing takes before it starts scrolling inside its own column.
 *
 * A history of a hundred branches is a drawing wider than any window, and letting it push the
 * author and the date off the side means scrolling right to read a name and losing the graph to
 * do it. Past this it scrolls on its own instead, and a hand can put the boundary elsewhere.
 */
export const LANES = 260
export const LANE = 16
export const PADX = 12
export const DOT = 3.6

const PALETTES = {
  dark: ['#e8846c', '#5c9dff', '#4fc08d', '#d8b24a', '#b47ce6', '#3fbfd0', '#e37fb4', '#8fbf3f', '#e09a4e', '#7f8ff0'],
  light: ['#c0523a', '#2f6fd0', '#1f8a55', '#9c7412', '#7b4bbf', '#127f92', '#b2447f', '#5c8210', '#b06612', '#4a5ec8'],
}

export type Theme = keyof typeof PALETTES

export const colorOf = (index: number, theme: Theme) => {
  const palette = PALETTES[theme]
  return palette[index % palette.length]
}

export const laneX = (lane: number) => PADX + lane * LANE
export const rowY = (row: number) => row * ROW + ROW / 2
export const graphWidth = (lanes: number) => PADX * 2 + Math.max(lanes, 1) * LANE

/** The rows an edge covers, so a windowed view can skip the ones it cannot see. */
export const edgeSpan = (edge: Edge): [number, number] => [edge.fr, edge.tr ?? edge.fr + 1]

/**
 * An edge leaves its commit, travels down one lane, and lands on its parent.
 * Each change of lane costs one row of bezier, which is what draws the elbow.
 */
export function edgePath(fromRow: number, fromLane: number, routeLane: number, toRow: number, toLane: number): string {
  const y0 = rowY(fromRow)
  const y1 = rowY(toRow)
  const x0 = laneX(fromLane)
  const xr = laneX(routeLane)
  const x1 = laneX(toLane)
  if (x0 === xr && xr === x1) return `M ${x0} ${y0} L ${x1} ${y1}`

  const bends = (x0 !== xr ? 1 : 0) + (xr !== x1 ? 1 : 0)
  if (y1 - y0 < bends * ROW) {
    // no room for the elbows, one clean S instead of a horizontal jog
    const mid = (y0 + y1) / 2
    return `M ${x0} ${y0} C ${x0} ${mid}, ${x1} ${mid}, ${x1} ${y1}`
  }

  let path = `M ${x0} ${y0}`
  let top = y0
  if (x0 !== xr) {
    const bottom = y0 + ROW
    const mid = (y0 + bottom) / 2
    path += ` C ${x0} ${mid}, ${xr} ${mid}, ${xr} ${bottom}`
    top = bottom
  }
  if (xr !== x1) {
    const start = y1 - ROW
    const mid = (start + y1) / 2
    if (start > top) path += ` L ${xr} ${start}`
    path += ` C ${xr} ${mid}, ${x1} ${mid}, ${x1} ${y1}`
  } else if (y1 > top) {
    path += ` L ${xr} ${y1}`
  }
  return path
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabel(date: Date): string {
  const sameYear = date.getFullYear() === new Date().getFullYear()
  return `${date.getDate()} ${MONTHS[date.getMonth()]}${sameYear ? '' : ' ' + String(date.getFullYear()).slice(2)}`
}

/**
 * How long ago, in as few characters as it takes.
 *
 * Past a week the clock time goes: nobody scans a column of minutes from last
 * March, and the row carries the whole date in its tooltip anyway. The column
 * is as wide as its widest answer, so every character here costs one there.
 */
export function ago(date: Date, now = Date.now()): string {
  const seconds = (now - date.getTime()) / 1000
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  if (seconds < 6 * 86400) return `${Math.floor(seconds / 86400)} d ago`
  return dayLabel(date)
}

/** A stable colour for an author, so the initials read as the same person. */
export function tint(name: string): string {
  let hash = 0
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff
  return `hsl(${hash % 360} 45% 68%)`
}
