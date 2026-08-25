import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { Commit, Graph } from '../api'
import {
  DOT, ROW, ago, colorOf, dayLabel, edgePath, edgeSpan, graphWidth, laneX, rowY, tint, type Theme,
} from '../lanes'

const OVERSCAN = 10

interface Props {
  graph: Graph
  theme: Theme
  query: string
  selected: string | null
  onSelect: (hash: string) => void
}

function matches(commit: Commit, needle: string): boolean {
  if (!needle) return true
  return (
    commit.s.toLowerCase().includes(needle) ||
    commit.an.toLowerCase().includes(needle) ||
    commit.h.startsWith(needle) ||
    commit.refs.some((ref) => ref.n.toLowerCase().includes(needle))
  )
}

export function GraphView({ graph, theme, query, selected, onSelect }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(800)
  // the commit the eye is on, so new commits landing on top do not move it
  const anchor = useRef<{ h: string; delta: number } | null>(null)

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
  const needle = query.trim().toLowerCase()

  const visible = graph.commits.slice(first, last)
  const wires = graph.edges.filter((edge) => {
    const [from, to] = edgeSpan(edge)
    return to >= first && from <= last
  })

  if (count === 0) {
    return <div className="scroller"><p className="empty">No commit in this repository yet.</p></div>
  }

  return (
    <div className="scroller" ref={scroller} onScroll={onScroll}>
      <div className="canvas" style={{ height: count * ROW, '--gw': `${width}px` } as CSSProperties}>
        <svg
          className="wires"
          width={width}
          height={windowHeight}
          viewBox={`0 ${windowTop} ${width} ${windowHeight}`}
          style={{ top: windowTop }}
        >
          {wires.map((edge) => {
            const stroke = colorOf(edge.c, theme)
            if (edge.tr === null) {
              // the parent is below the window: a stub going nowhere
              return (
                <path
                  key={`${edge.fr}-${edge.rl}-end`}
                  d={edgePath(edge.fr, edge.fl, edge.rl, edge.fr + 1, edge.rl)}
                  stroke={stroke}
                  strokeDasharray="3 3"
                  strokeWidth={1.6}
                  fill="none"
                  opacity={0.5}
                />
              )
            }
            return (
              <path
                key={`${edge.fr}-${edge.rl}-${edge.tr}`}
                d={edgePath(edge.fr, edge.fl, edge.rl, edge.tr, edge.tl)}
                stroke={stroke}
                strokeWidth={1.6}
                fill="none"
              />
            )
          })}
          {visible.map((commit) => {
            const fill = colorOf(commit.c, theme)
            const tagged = commit.refs.length > 0
            return (
              <circle
                key={commit.h}
                cx={laneX(commit.lane)}
                cy={rowY(commit.row)}
                r={tagged ? DOT + 1.4 : DOT}
                fill={tagged ? 'var(--bg)' : fill}
                stroke={fill}
                strokeWidth={tagged ? 2.4 : 1.6}
              />
            )
          })}
        </svg>

        <div className="rows" style={{ transform: `translateY(${windowTop}px)` }}>
          {visible.map((commit, index) => {
            const when = new Date(commit.t)
            const label = dayLabel(when)
            const previous = graph.commits[first + index - 1]
            const newDay = !previous || dayLabel(new Date(previous.t)) !== label
            const className = [
              'row',
              newDay ? 'day' : '',
              commit.h === selected ? 'sel' : '',
              matches(commit, needle) ? '' : 'faded',
            ].filter(Boolean).join(' ')
            return (
              <div key={commit.h} className={className} onClick={() => onSelect(commit.h)}>
                <div className="gut">{newDay ? label : ''}</div>
                <div />
                <div className="msg">
                  {commit.refs.map((ref) => (
                    <span key={ref.k + ref.n} className={`ref ${ref.k}`}>{ref.n}</span>
                  ))}
                  {commit.s}
                </div>
                <div className="who">
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
