import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Commit, Edge, GitRef, Graph } from '../api'
import type { TrailMode } from '../settings'
import {
  DOT, GUTTER, HEAD, LANES, ROW, ago, colorOf, dayLabel, edgePath, edgeSpan, graphWidth, laneX,
  rowY, tint, type Theme,
} from '../lanes'
import { useColumns } from '../columns'

const OVERSCAN = 10

/** Why a history stops here rather than at its first commit. */
const SHALLOW = 'the clone was cut here: git holds no parent for this commit'

/** What a row of uncommitted work says of itself when there is no room to say it. */
const WORK = 'what this worktree holds and no commit does'

/** Why a branch is marked as done with, and why the same change is drawn twice. */
const MERGED = 'a trunk already holds this branch, as these commits or as a replay of them'
const TWIN = 'the same change under another hash, which is what a replay leaves behind'

/** What the two columns on the right are written in, so a width measured is a width drawn. */
const RULER = '11px "Segoe UI", system-ui, sans-serif'

/** And what a label is written in, which is half a pixel smaller and enough to matter over five. */
const LABEL = '10.5px "Segoe UI", system-ui, sans-serif'

/** What a label costs beside its text: the padding either side, the border, and the gap after. */
const LABEL_ROOM = 12

/** And what the dot on a pushed branch costs beside that, itself and the gap before it. */
const DOT_ROOM = 8
const LABEL_GAP = 5

/** Never wider than this, however long a name is. The tail is what tells two refs apart. */
const LABEL_CAP = 190

/**
 * What the subject keeps whatever a commit carries.
 *
 * A row of labels alone names no commit, and a release commit carries four of them: past this
 * the labels stop taking room and start being counted instead.
 */
const SUBJECT_FLOOR = 96

/** What the column that holds them both spends on itself, which `index.css` spells out. */
const MSG_PAD = 12
const MSG_GAP = 8

const ruler = document.createElement('canvas').getContext('2d')

/**
 * How wide one string is drawn, measured once however many rows carry it.
 *
 * Six thousand commits are a few dozen authors and a few hundred days, so all
 * but the first row carrying a name answers from here. Measuring them one by
 * one cost twenty six milliseconds of every read.
 */
const measured = new Map<string, number>()

function widthOf(value: string, font = RULER): number {
  const key = `${font}\u0000${value}`
  const held = measured.get(key)
  if (held !== undefined) return held
  if (ruler) ruler.font = font
  const width = ruler ? ruler.measureText(value).width : 0
  measured.set(key, width)
  return width
}

/**
 * The order labels are read in, which is not the order git hands them over in.
 *
 * A commit's refs come out of git's own decoration, and that order is neither sorted nor stable
 * between one commit and the next: two rows carrying a branch and its remote copy printed them
 * one way round on one row and the other way round on the row above, which is a thing the eye
 * catches and cannot use. Fixed here rather than in either backend, since what it settles is how
 * a row reads and both backends hand over the same shapes.
 *
 * A tag first, because it names a version and a branch names whoever is standing on it. Then
 * what is yours, then the copy of it on a remote. That is also the order they are given up in
 * when there is no room for all of them.
 */
const RANK: Record<string, number> = { tag: 0, both: 1, local: 1, remote: 2, shallow: 3 }

/**
 * One label as a row draws it, which is not always one ref.
 *
 * A branch you have pushed is two refs standing on the same commit under the same name, and the
 * row printed both: `dashboard-facts dashboard-facts`, once in each colour. It is one label now,
 * green like the branch it is, with a blue dot saying the remote has it too. Which of the three
 * a label is remains the thing worth seeing at a glance, since a branch that is only local and a
 * branch that is only on the remote are two different situations to be in.
 */
interface Chip {
  key: string
  text: string
  kind: 'tag' | 'local' | 'remote' | 'both' | 'shallow'
  title: string
  /** Whether a trunk already holds it, which the row says once for all of them. */
  merged: boolean
}

/**
 * The one remote every remote ref in this repository is on, or nothing where there are several.
 *
 * A label says which remote by being drawn in the colour of one, so `origin/` in front of the
 * name is the same fact twice and eleven characters of a narrow column. Where a repository has
 * two remotes the prefix is the only thing telling `origin/dev` from `upstream/dev`, and it
 * stays: what the colour says there is `a remote`, not `which`.
 */
function soleRemote(commits: Commit[]): string | null {
  let only: string | null = null
  for (const commit of commits) {
    for (const ref of commit.refs) {
      if (ref.k !== 'remote') continue
      const slash = ref.n.indexOf('/')
      if (slash < 1) return null
      const remote = ref.n.slice(0, slash)
      if (only === null) only = remote
      else if (only !== remote) return null
    }
  }
  return only
}

/**
 * The labels one row carries, in the order it reads them and with its pairs joined.
 *
 * A local and a remote pair only where the remote's own name has been taken off, which is to say
 * where there is one remote to take off: with two, `origin/dev` and `upstream/dev` are two
 * different places a branch has got to and joining either to the local would hide that.
 */
function chipsOf(refs: GitRef[], only: string | null): Chip[] {
  const short = (ref: GitRef) =>
    only && ref.k === 'remote' && ref.n.startsWith(`${only}/`) ? ref.n.slice(only.length + 1) : ref.n
  const spelt = (ref: GitRef) =>
    ref.k === 'local' ? `local/${ref.n}` : ref.k === 'tag' ? `tag/${ref.n}` : ref.n

  const locals = new Map(refs.filter((ref) => ref.k === 'local').map((ref) => [ref.n, ref]))
  const joined = new Set<string>()
  const chips: Chip[] = []

  for (const ref of refs) {
    if (ref.k === 'shallow') {
      chips.push({ key: 'shallow', text: ref.n, kind: 'shallow', title: SHALLOW, merged: false })
      continue
    }
    if (ref.k === 'remote') {
      const name = short(ref)
      const mate = only ? locals.get(name) : undefined
      if (mate) {
        joined.add(name)
        chips.push({
          key: `both:${name}`,
          text: name,
          kind: 'both',
          title: `${spelt(mate)} and ${ref.n}`,
          merged: Boolean(mate.m || ref.m),
        })
        continue
      }
      chips.push({ key: `r:${ref.n}`, text: name, kind: 'remote', title: ref.n, merged: Boolean(ref.m) })
      continue
    }
    chips.push({
      key: `${ref.k}:${ref.n}`,
      text: ref.n,
      kind: ref.k === 'tag' ? 'tag' : 'local',
      title: spelt(ref),
      merged: Boolean(ref.m),
    })
  }

  return chips
    .filter((chip) => !(chip.kind === 'local' && joined.has(chip.text)))
    .sort((one, two) => RANK[one.kind] - RANK[two.kind] || one.text.localeCompare(two.text))
}

/**
 * As many labels whole as the room holds, and a count for the rest.
 *
 * What used to happen here was that every label gave up its head at once, so a release commit
 * read `...v` `...1-beta` `...in/main`: five labels nobody could tell apart, where four whole
 * ones and a `+1` say the same thing and can be read. What is left out is named in the tooltip
 * of that count, and stands whole in the tree beside it.
 */
function fitRefs(refs: Chip[], room: number): [Chip[], Chip[]] {
  const widths = refs.map(
    (chip) =>
      Math.min(widthOf(chip.text, LABEL) + LABEL_ROOM, LABEL_CAP) +
      (chip.kind === 'both' ? DOT_ROOM : 0),
  )
  const whole = widths.reduce((sum, width) => sum + width + LABEL_GAP, -LABEL_GAP)
  if (whole <= room) return [refs, []]

  let taken = 0
  let used = widthOf(`+${refs.length}`, LABEL) + LABEL_ROOM
  while (taken < refs.length && used + widths[taken] + LABEL_GAP <= room) {
    used += widths[taken] + LABEL_GAP
    taken += 1
  }
  return [refs.slice(0, taken), refs.slice(taken)]
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
  const widths = values.map((value) => widthOf(value)).sort((a, b) => a - b)
  return Math.ceil(widths[Math.min(widths.length - 1, Math.floor(widths.length * share))])
}

/** What it takes to walk a graph: the edges by end, the row of a hash, and who came from whom. */
interface Links {
  out: Map<number, Edge[]>
  into: Map<number, Edge[]>
  /** The row a hash sits on, so a parent named in a commit can be followed to it. */
  rowOf: Map<string, number>
  /** The rows whose first parent is this one, which is the line carrying on upwards. */
  born: Map<number, number[]>
}

function linksOf(graph: Graph): Links {
  const out = new Map<number, Edge[]>()
  const into = new Map<number, Edge[]>()
  const rowOf = new Map<string, number>()
  const born = new Map<number, number[]>()
  const add = <T,>(map: Map<number, T[]>, row: number, held: T) => {
    const there = map.get(row)
    if (there) there.push(held)
    else map.set(row, [held])
  }

  for (const edge of graph.edges) {
    add(out, edge.fr, edge)
    if (edge.tr !== null) add(into, edge.tr, edge)
  }
  graph.commits.forEach((commit, row) => rowOf.set(commit.h, row))
  graph.commits.forEach((commit, row) => {
    const first = commit.p[0] === undefined ? undefined : rowOf.get(commit.p[0])
    if (first !== undefined) add(born, first, row)
  })

  return { out, into, rowOf, born }
}

/**
 * The path a commit came by: down its first parents to the root, and up the line that carried on
 * from it.
 *
 * Walked along the parent links and not along the lane, which is what a lane cannot answer. A
 * branch of one commit sits alone in its own lane, and lighting that lane lit one segment and
 * stopped at the elbow, exactly where the interesting part starts. The path crosses the elbow
 * and carries on down whatever lane the history took.
 *
 * Upwards it follows the commits this one is the first parent of. Where there are several, the
 * one sharing this lane is the line carrying on, and the others are branches leaving it.
 */
function pathOf(graph: Graph, links: Links, row: number): Set<Edge> {
  const path = new Set<Edge>()
  const between = (from: number, to: number) =>
    links.out.get(from)?.find((edge) => edge.tr === to)

  let at = row
  for (;;) {
    const first = graph.commits[at]?.p[0]
    const next = first === undefined ? undefined : links.rowOf.get(first)
    if (next === undefined) break
    const edge = between(at, next)
    if (!edge || path.has(edge)) break
    path.add(edge)
    at = next
  }

  at = row
  for (;;) {
    const held = links.born.get(at)
    if (!held?.length) break
    const lane = graph.commits[at]?.lane
    const next =
      held.find((one) => graph.commits[one]?.lane === lane) ??
      (held.length === 1 ? held[0] : undefined)
    if (next === undefined) break
    const edge = between(next, at)
    if (!edge || path.has(edge)) break
    path.add(edge)
    at = next
  }

  return path
}

interface Props {
  graph: Graph
  theme: Theme
  /** What the text filter keeps lit. Everything else is dimmed, never removed. */
  match: (commit: Commit) => boolean
  /** Whether git was asked to leave commits out, which changes what nothing means. */
  narrowed: boolean
  selected: string | null
  /** When the path a commit came by is lit, which is a matter of taste and so a setting. */
  trail: TrailMode
  /** `near` scrolls no further than it takes to show the row, rather than centring it. */
  jump: { h: string; n: number; near?: boolean } | null
  onSelect: (hash: string) => void
}

export function GraphView({
  graph, theme, match, narrowed, selected, trail, jump, onSelect,
}: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const columns = useColumns()
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(800)
  /** How wide the rows are, which is what says how many labels one of them holds. */
  const [across, setAcross] = useState(1000)
  // the row the pointer is on, which is what says which lane to follow
  const [hovered, setHovered] = useState<number | null>(null)
  // how far the drawing is scrolled inside its own column, when it is wider than the room given
  const [pan, setPan] = useState(0)
  // the commit the eye is on, so new commits landing on top do not move it
  const anchor = useRef<{ h: string; delta: number } | null>(null)
  const jumped = useRef(0)

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    const measure = () => {
      setViewport(element.clientHeight)
      setAcross(element.clientWidth)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    measure()
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
    element.scrollTop = index >= 0 ? index * ROW + HEAD + held.delta : 0
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
    const top = index * ROW + HEAD
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
    // the strip naming the columns sits above the rows, so what is scrolled past starts after it
    const under = element.scrollTop - HEAD
    const row = Math.max(0, Math.floor(under / ROW))
    const commit = graph.commits[row]
    anchor.current =
      element.scrollTop < 4 || !commit ? null : { h: commit.h, delta: under - row * ROW }
  }

  const count = graph.commits.length
  const under = scrollTop - HEAD
  const first = Math.max(0, Math.floor(under / ROW) - OVERSCAN)
  const last = Math.min(count, Math.ceil((under + viewport) / ROW) + OVERSCAN)
  const windowTop = first * ROW
  const windowHeight = Math.max((last - first) * ROW, 0)
  // what the drawing needs, and what it is given: past the second the first one scrolls
  const drawn = graphWidth(graph.lanes)

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

  // the same change elsewhere, lit beside the one clicked: either of the two finds the other,
  // the backends carrying the pair both ways round
  const twin = useMemo(
    () => (selected ? graph.commits.find((commit) => commit.h === selected)?.tw ?? null : null),
    [graph, selected],
  )

  const links = useMemo(() => linksOf(graph), [graph])

  const only = useMemo(() => soleRemote(graph.commits), [graph])

  // under the pointer, or held on the commit last clicked, or nowhere at all
  const walking = useMemo(() => {
    if (trail === 'off') return null
    if (trail === 'click') return selected === null ? null : links.rowOf.get(selected) ?? null
    return hovered
  }, [trail, selected, hovered, links])

  const run = useMemo(
    () => (walking === null ? null : pathOf(graph, links, walking)),
    [graph, links, walking],
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

  // measured on what is loaded, until a hand puts a column somewhere else and keeps it there
  const gutter = columns.held.gutter ?? GUTTER
  // never more room than the drawing needs, however much a hand asked for
  const lanes = Math.min(columns.held.lanes ?? LANES, drawn)
  const who = columns.held.who ?? widths.who
  const when = columns.held.when ?? widths.when
  // what is scrolled past above the rows, which is what the drawing has to be moved by to stay
  // where the rows it belongs to are
  const above = Math.max(0, scrollTop - HEAD)
  /* what the subject and the labels share, once the four measured columns have taken theirs.
     The subject's floor is taken out of it here, so a label never has the last of the room */
  const shared = across - gutter - lanes - (who + 32) - (when + 18) - MSG_PAD
  const forRefs = Math.max(0, shared - SUBJECT_FLOOR - MSG_GAP)

  return (
    <div
      className="scroller"
      ref={scroller}
      onScroll={onScroll}
      style={{
        '--gw': `${lanes}px`,
        '--gutter': `${gutter}px`,
        '--who': `${who}px`,
        '--when': `${when}px`,
      } as CSSProperties}
    >
      {/* the columns are named where they are dragged from, and a grip let go of twice
          gives the measurement back */}
      <div className="head">
        <div className="gut">
          <span className="edge right" {...columns.grip('gutter', gutter, 1)} />
        </div>
        {/* the drawing scrolls sideways from here, where a scrollbar is in the way of nothing:
            over the rows it would swallow the hovering the rows themselves answer. The grip is
            beside that strip and not inside it, or its own width would be something to scroll */}
        <div>
          <div
            className="lanes-strip"
            onScroll={(event) => setPan(event.currentTarget.scrollLeft)}
          >
            <div style={{ width: drawn, height: 1 }} />
          </div>
          <span className="edge right" {...columns.grip('lanes', lanes, 1)} />
        </div>
        <div className="msg">commit</div>
        <div className="who">
          <span className="edge" {...columns.grip('who', who, -1)} />
          author
        </div>
        <div className="when">
          <span className="edge" {...columns.grip('when', when, -1)} />
          when
        </div>
      </div>

      <div className="canvas" style={{ height: count * ROW }}>
        {/* held in the room its column was given, and scrolled inside it. It follows the scroll
            by hand rather than by sticking to it, since what is under it is a window of rows
            that moves for the same reason */}
        <div className="lanes" style={{ top: above, height: viewport, width: lanes }}>
        <svg
          className="wires"
          width={drawn}
          height={windowHeight}
          viewBox={`0 ${windowTop} ${drawn} ${windowHeight}`}
          style={{ top: windowTop - above, left: -pan }}
        >
          {/* the lane being followed keeps its strength and the rest give way */}
          <g className={run ? 'faint' : undefined}>
            {wires.map((edge) => {
              const stroke = colorOf(edge.c, theme)
              // what hangs off a working row is not history yet, and is drawn as not being it
              const loose = graph.commits[edge.fr]?.wt ? ' loose' : ''
              const lit = (run?.has(edge) ? ' lit' : '') + loose
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
            const work = Boolean(commit.wt)
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
                {commit.h === twin && (
                  <circle className="twinned" cx={x} cy={y} r={DOT + 4.4} fill="none" />
                )}
                {/* where HEAD stands gets a halo, which is what a ref label would say twice */}
                {head && (
                  <circle cx={x} cy={y} r={DOT + 3.2} fill="none" stroke={fill} strokeWidth={1.4} />
                )}
                <circle
                  className={work ? 'work' : undefined}
                  cx={x}
                  cy={y}
                  r={tagged || work ? DOT + 1.4 : DOT}
                  fill={tagged || work ? 'var(--bg)' : fill}
                  stroke={fill}
                  strokeWidth={tagged ? 2.4 : 1.6}
                />
              </g>
            )
          })}
        </svg>
        </div>

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
            const carried = chipsOf(commit.refs.filter((ref) => ref.k !== 'head'), only)
            // the merged badge stands beside them and takes its room from the same purse
            const badged = carried.some((chip) => chip.merged)
            const [shownRefs, restRefs] = fitRefs(
              carried,
              forRefs - (badged ? widthOf('merged', LABEL) + LABEL_ROOM + LABEL_GAP : 0),
            )
            // the topmost row has the bar above it, and a rule there reads as a thick border
            const className = [
              'row',
              commit.wt ? 'work' : '',
              newDay && first + index > 0 ? 'day' : '',
              commit.h === selected ? 'sel' : '',
              commit.h === twin ? 'twin' : '',
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
                  <span className="subject" title={commit.wt ? WORK : undefined}>{commit.s}</span>
                  {commit.wt && (
                    <span className="refs">
                      {commit.wt.staged > 0 && (
                        <span className="mark">{commit.wt.staged} staged</span>
                      )}
                      {commit.wt.changed > 0 && (
                        <span className="mark">{commit.wt.changed} changed</span>
                      )}
                      {commit.wt.untracked > 0 && (
                        <span className="mark">{commit.wt.untracked} new</span>
                      )}
                    </span>
                  )}
                  {carried.length > 0 && (
                    <span className="refs">
                      {shownRefs.map((chip) => (
                        <span key={chip.key} className="held">
                          {/* the dot is a sibling of the text rather than part of it: the name
                              is read right to left so a narrow column loses its head, and a
                              neutral thing put in that run comes out at the other end */}
                          <span className={`ref ${chip.kind}`} title={chip.title}>
                            <span className="txt">{chip.text}</span>
                            {chip.kind === 'both' && <i className="also" />}
                          </span>
                        </span>
                      ))}
                      {restRefs.length > 0 && (
                        <span
                          className="mark more"
                          title={restRefs.map((chip) => chip.title).join('\n')}
                        >
                          +{restRefs.length}
                        </span>
                      )}
                      {/* once for the row rather than once per label: it answers of the commit,
                          and two branches left on one commit are given the same answer by
                          construction, so a second badge repeats the first word for word */}
                      {badged && <span className="mark" title={MERGED}>merged</span>}
                    </span>
                  )}
                </div>
                {commit.wt ? (
                  // the folder, since a worktree of another folder is the one worth naming, and
                  // the branch it sits on is already drawn on the commit below it
                  <div className="who" title={commit.wt.path}>
                    {commit.wt.here ? '' : commit.wt.path.split(/[\\/]/).pop()}
                  </div>
                ) : (
                  <div className="who" title={commit.an}>
                    <span className="ava" style={{ background: tint(commit.an) }}>
                      {commit.an.slice(0, 1).toUpperCase()}
                    </span>
                    {commit.an}
                  </div>
                )}
                <div className="when" title={commit.tw ? TWIN : when.toLocaleString()}>
                  {ago(when)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
