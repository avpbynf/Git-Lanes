import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Commit, Edge, Graph } from '../api'
import {
  DOT, ROW, ago, colorOf, dayLabel, edgePath, edgeSpan, graphWidth, laneX, rowY, tint, type Theme,
} from '../lanes'

const OVERSCAN = 10

/** Why a history stops here rather than at its first commit. */
const SHALLOW = 'the clone was cut here: git holds no parent for this commit'

/** What the two columns on the right are written in, so a width measured is a width drawn. */
const RULER = '11px "Segoe UI", system-ui, sans-serif'

const ruler = document.createElement('canvas').getContext('2d')

/**
 * How wide one string is drawn, measured once however many rows carry it.
 *
 * Six thousand commits are a few dozen authors and a few hundred days, so all
 * but the first row carrying a name answers from here. Measuring them one by
 * one cost twenty six milliseconds of every read.
 */
const measured = new Map<string, number>()

function widthOf(value: string): number {
  const held = measured.get(value)
  if (held !== undefined) return held
  if (ruler) ruler.font = RULER
  const width = ruler ? ruler.measureText(value).width : 0
  measured.set(value, width)
  return width
}

/**
 * How wide a column has to be to hold what it holds.
 *
 * Not the widest value but the width that share of them fit in: one long name
 * among four hundred would otherwise leave a hole on every other row, and the
 * few cut short keep their whole text in the tooltip. Measured rather than
 * counted in characters, since `ch` answers for the digit zero of whatever
 * font the element inherits, which is not the font the column is drawn in.
 */
function roomFor(values: string[], share: number): number {
  if (!ruler || !values.length) return 0
  const widths = values.map(widthOf).sort((a, b) => a - b)
  return Math.ceil(widths[Math.min(widths.length - 1, Math.floor(widths.length * share))])
}

/** Which rows an edge leaves and which it lands on, so a lane can be walked. */
interface Links {
  out: Map<number, Edge[]>
  into: Map<number, Edge[]>
}

function linksOf(graph: Graph): Links {
  const out = new Map<number, Edge[]>()
  const into = new Map<number, Edge[]>()
  const add = (map: Map<number, Edge[]>, row: number, edge: Edge) => {
    const held = map.get(row)
    if (held) held.push(edge)
    else map.set(row, [edge])
  }
  for (const edge of graph.edges) {
    add(out, edge.fr, edge)
    if (edge.tr !== null) add(into, edge.tr, edge)
  }
  return { out, into }
}

/**
 * The run of lane a row sits in: the edges above and below it that never leave
 * that lane, the elbow at either end included.
 *
 * Walked rather than matched on the lane or on the colour, because neither
 * answers: a lane freed and taken again by another branch is a second run in
 * the same column, and colours are reused the same way.
 */
function runOf(graph: Graph, links: Links, row: number): Set<Edge> {
  const run = new Set<Edge>()
  const lane = graph.commits[row]?.lane
  if (lane === undefined) return run

  let at = row
  for (;;) {
    const down = links.out.get(at)?.find((edge) => edge.rl === lane && edge.fl === lane)
    if (!down || run.has(down)) break
    run.add(down)
    if (down.tr === null || graph.commits[down.tr]?.lane !== lane) break
    at = down.tr
  }

  at = row
  for (;;) {
    const up = links.into.get(at)?.find((edge) => edge.rl === lane && edge.tl === lane)
    if (!up || run.has(up)) break
    run.add(up)
    if (graph.commits[up.fr]?.lane !== lane) break
    at = up.fr
  }

  return run
}

interface Props {
  graph: Graph
  theme: Theme
  /** What the text filter keeps lit. Everything else is dimmed, never removed. */
  match: (commit: Commit) => boolean
  /** Whether git was asked to leave commits out, which changes what nothing means. */
  narrowed: boolean
  selected: string | null
  /** `near` scrolls no further than it takes to show the row, rather than centring it. */
  jump: { h: string; n: number; near?: boolean } | null
  onSelect: (hash: string) => void
}

export function GraphView({ graph, theme, match, narrowed, selected, jump, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(800)
  // the row the pointer is on, which is what says which lane to follow
  const [hovered, setHovered] = useState<number | null>(null)
  // the commit the eye is on, so new commits landing on top do not move it
  const anchor = useRef<{ h: string; delta: number } | null>(null)
  const jumped = useRef(0)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const observer = new ResizeObserver(() => setViewport(element.clientHeight))
    observer.observe(element)
    setViewport(element.clientHeight)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    const element = scroller.current
    if (!element) return
    const held = anchor.current
    if (!held) {
      element.scrollTop = 0
      return
    }
    const index = graph.commits.findIndex((commit) => commit.h === held.h)
    element.scrollTop = index >= 0 ? index * ROW + held.delta : 0
  }, [graph])

  /**
   * A commit asked for from outside, put in the middle of the view.
   *
   * The nonce is spent only once the commit is really there, so a tip that the
   * graph has not read yet still lands the day a wider read brings it in.
   */
  useEffect(() => {
    const element = scroller.current
    if (!element || !jump || jump.n === jumped.current) return
    const index = graph.commits.findIndex((commit) => commit.h === jump.h)
    if (index < 0) return
    jumped.current = jump.n
    const top = index * ROW
    if (!jump.near) {
      element.scrollTop = Math.max(0, top - element.clientHeight / 2 + ROW / 2)
      return
    }
    // walking the graph one row at a time moves it one row at a time: recentring
    // on every step would throw away the place the eye was reading
    const from = element.scrollTop
    if (top < from) element.scrollTop = top
    else if (top + ROW > from + element.clientHeight) {
      element.scrollTop = top + ROW - element.clientHeight
    }
  }, [jump, graph])

  const onScroll = () => {
    const element = scroller.current
    if (!element) return
    setScrollTop(element.scrollTop)
    const row = Math.floor(element.scrollTop / ROW)
    const commit = graph.commits[row]
    anchor.current =
      element.scrollTop < 4 || !commit ? null : { h: commit.h, delta: element.scrollTop - row * ROW }
  }

  const count = graph.commits.length
  const first = Math.max(0, Math.floor(scrollTop / ROW) - OVERSCAN)
  const last = Math.min(count, Math.ceil((scrollTop + viewport) / ROW) + OVERSCAN)
  const windowTop = first * ROW
  const windowHeight = Math.max((last - first) * ROW, 0)
  const width = graphWidth(graph.lanes)

  /**
   * How wide the two columns on the right have to be, and no wider.
   *
   * They cannot be sized by the browser: every row is a grid of its own, so an
   * automatic width would land differently on each and the columns would not
   * line up. Measured over what is loaded, once, they line up and a repository
   * of short names gives the room back to the subject. A date is never cut, a
   * name may be.
   */
  const widths = useMemo(
    () => ({
      who: roomFor(graph.commits.map((commit) => commit.an), 0.95),
      when: roomFor(graph.commits.map((commit) => ago(new Date(commit.t))), 1),
    }),
    [graph],
  )

  const links = useMemo(() => linksOf(graph), [graph])
  const run = useMemo(
    () => (hovered === null ? null : runOf(graph, links, hovered)),
    [graph, links, hovered],
  )

  const visible = graph.commits.slice(first, last)
  const wires = graph.edges.filter((edge) => {
    const [from, to] = edgeSpan(edge)
    return to >= first && from <= last
  })

  if (count === 0) {
    return (
      <div className="scroller">
        <p className="empty">
          {narrowed
            ? 'no commit answers these filters'
            : 'no commit in this repository yet'}
        </p>
      </div>
    )
  }

  return (
    <div className="scroller" ref={scroller} onScroll={onScroll}>
      <div
        className="canvas"
        style={{
          height: count * ROW,
          '--gw': `${width}px`,
          '--who': `${widths.who}px`,
          '--when': `${widths.when}px`,
        } as CSSProperties}
      >
        <svg
          className="wires"
          width={width}
          height={windowHeight}
          viewBox={`0 ${windowTop} ${width} ${windowHeight}`}
          style={{ top: windowTop }}
        >
          {/* the lane being followed keeps its strength and the rest give way */}
          <g className={run ? 'faint' : undefined}>
            {wires.map((edge) => {
              const stroke = colorOf(edge.c, theme)
              const lit = run?.has(edge) ? ' lit' : ''
              if (edge.tr === null) {
                // the parent is below the window: a stub going nowhere
                return (
                  <path
                    key={`${edge.fr}-${edge.rl}-end`}
                    className={`stub${lit}`}
                    d={edgePath(edge.fr, edge.fl, edge.rl, edge.fr + 1, edge.rl)}
                    stroke={stroke}
                    strokeDasharray="3 3"
                    strokeWidth={1.6}
                    fill="none"
                  />
                )
              }
              return (
                <path
                  key={`${edge.fr}-${edge.rl}-${edge.tr}`}
                  className={lit.trim() || undefined}
                  d={edgePath(edge.fr, edge.fl, edge.rl, edge.tr, edge.tl)}
                  stroke={stroke}
                  strokeWidth={1.6}
                  fill="none"
                />
              )
            })}
          </g>
          {visible.map((commit) => {
            const fill = colorOf(commit.c, theme)
            const head = commit.refs.some((ref) => ref.k === 'head')
            // a shallow marker is not a ref, so it does not ring the dot like one
            const tagged = commit.refs.some((ref) => ref.k !== 'head' && ref.k !== 'shallow')
            const x = laneX(commit.lane)
            const y = rowY(commit.row)
            return (
              <g key={commit.h} className={match(commit) ? undefined : 'faded'}>
                {/* the commit being read carries the mark, since the row it sits
                    on is off screen as soon as the graph is scrolled past it */}
                {commit.h === selected && (
                  <circle className="picked" cx={x} cy={y} r={DOT + 4.4} fill="none" />
                )}
                {/* where HEAD stands gets a halo, which is what a ref label would say twice */}
                {head && (
                  <circle cx={x} cy={y} r={DOT + 3.2} fill="none" stroke={fill} strokeWidth={1.4} />
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={tagged ? DOT + 1.4 : DOT}
                  fill={tagged ? 'var(--bg)' : fill}
                  stroke={fill}
                  strokeWidth={tagged ? 2.4 : 1.6}
                />
              </g>
            )
          })}
        </svg>

        <div
          className="rows"
          style={{ transform: `translateY(${windowTop}px)` }}
          onMouseLeave={() => setHovered(null)}
        >
          {visible.map((commit, index) => {
            const when = new Date(commit.t)
            const label = dayLabel(when)
            const previous = graph.commits[first + index - 1]
            const newDay = !previous || dayLabel(new Date(previous.t)) !== label
            // HEAD wears its halo on the dot, so a label saying so would say it twice
            const carried = commit.refs.filter((ref) => ref.k !== 'head')
            // the topmost row has the bar above it, and a rule there reads as a thick border
            const className = [
              'row',
              newDay && first + index > 0 ? 'day' : '',
              commit.h === selected ? 'sel' : '',
              match(commit) ? '' : 'faded',
            ].filter(Boolean).join(' ')
            return (
              <div
                key={commit.h}
                className={className}
                onClick={() => onSelect(commit.h)}
                onMouseEnter={() => setHovered(first + index)}
              >
                <div className="gut">{newDay ? label : ''}</div>
                <div />
                <div className="msg">
                  <span className="subject">{commit.s}</span>
                  {carried.length > 0 && (
                    <span className="refs">
                      {carried.map((ref) => (
                        <span
                          key={ref.k + ref.n}
                          className={`ref ${ref.k}`}
                          title={ref.k === 'shallow' ? SHALLOW : undefined}
                        >
                          {ref.n}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <div className="who" title={commit.an}>
                  <span className="ava" style={{ background: tint(commit.an) }}>
                    {commit.an.slice(0, 1).toUpperCase()}
                  </span>
                  {commit.an}
                </div>
                <div className="when" title={when.toLocaleString()}>{ago(when)}</div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
