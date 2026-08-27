import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  canPickFolder, closeRepo, discoverRepos, fetchBranches, openRepo, orderRepos, pickFolder,
  type Branch, type BranchList, type PlainRef, type RepoEntry,
} from '../api'
import { since } from '../lanes'
import { MIN_WIDTH, usePanelWidth } from '../panel'
import { countOf, ordered, tree, type Leaf, type Named, type Node } from '../refs'
import { HEADS, REMOTES, TAGS } from '../scope'

interface Props {
  repos: RepoEntry[]
  current: string | null
  shown: boolean
  /** The full name of the ref the reading sits on, which the tree highlights. */
  active: string | null
  /**
   * The commit picked in the graph, so every ref standing on it is lit rather than one of them.
   *
   * A release commit carries a tag, a branch, its remote and the remote's HEAD, and the graph
   * squeezes those four labels into one row: the tree is where there is room to say which four,
   * and lighting the first alone said the other three were somewhere else.
   */
  here: string | null
  /** Moves whenever a ref does, which is when the tree is worth reading again. */
  fingerprint: string
  onPickRepo: (path: string) => void
  /** The list of repositories changed under us and is worth reading again. */
  onRepos: () => void
  /** The ref spelled in full, since that is what bounds a graph and tells two apart. */
  onTake: (refname: string, head: string) => void
}

interface Answer {
  repo: string | null
  list?: BranchList
  error?: string
}

/** How far a branch stands from its base, silent when the two are level. */
function Divergence({ behind, ahead }: { behind: number; ahead: number }) {
  if (!behind && !ahead) return null
  return (
    <span className="gap">
      {ahead > 0 && <span className="ahead">{ahead}</span>}
      {behind > 0 && <span className="behind">{behind}</span>}
    </span>
  )
}

/** Everything about a branch, for the tooltip the row is too narrow to hold. */
function storyOf(branch: Branch, base: string | null): string {
  const lines = [branch.head.slice(0, 12), `last touched ${since(new Date(branch.t))}`]
  const against = branch.base ?? base
  if (against) lines.push(`${branch.ahead} ahead, ${branch.behind} behind ${against}`)
  if (!branch.upstream) lines.push('not pushed')
  else if (branch.upstream.gone) lines.push(`${branch.upstream.name} is gone`)
  else if (!branch.upstream.ahead && !branch.upstream.behind) lines.push(`pushed to ${branch.upstream.name}`)
  else lines.push(`${branch.upstream.ahead} to push, ${branch.upstream.behind} to pull`)
  return lines.join('\n')
}

interface TwigProps<T extends Named> {
  nodes: Node<T>[]
  depth: number
  shut: Set<string>
  onFold: (path: string) => void
  leaf: (node: Leaf<T>, depth: number) => ReactNode
}

function Twig<T extends Named>({ nodes, depth, shut, onFold, leaf }: TwigProps<T>) {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'leaf' ? (
          leaf(node, depth)
        ) : (
          <div key={node.path}>
            <button
              className="twig fold"
              style={{ paddingLeft: 6 + depth * 12 }}
              onClick={() => onFold(node.path)}
            >
              <span className="caret">{shut.has(node.path) ? '>' : 'v'}</span>
              <span className="name">{node.name}</span>
              <span className="count">{countOf(node)}</span>
            </button>
            {!shut.has(node.path) && (
              <Twig nodes={node.children} depth={depth + 1} shut={shut} onFold={onFold} leaf={leaf} />
            )}
          </div>
        ),
      )}
    </>
  )
}

export function Sidebar({
  repos, current, shown, active, here, fingerprint, onPickRepo, onRepos, onTake,
}: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [hunt, setHunt] = useState('')
  // remote branches and tags are many and rarely what one is looking for
  const [shut, setShut] = useState<Set<string>>(() => new Set(['\0remote', '\0tags']))
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<{ root: string; hits: RepoEntry[] } | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)
  const read = useRef('')
  const ticket = useRef(0)

  /**
   * The tree is read once per repository, and again when that repository moves.
   *
   * The graph blanks its fingerprint while it switches, so both signals fire on
   * a switch and the tree would be read twice for one repository. A tree costs a
   * rev-list per branch, so the read made without a fingerprint stands for the
   * one that follows it.
   */
  useEffect(() => {
    if (!shown) return
    const asked = `${current ?? ''}|${fingerprint}`
    const provisional = `${current ?? ''}|`
    const covered = read.current === asked || (read.current === provisional && fingerprint !== '')
    read.current = asked
    if (covered) return

    /*
     * A ticket, and deliberately no cleanup.
     *
     * The run that skips would otherwise cancel the read the run before it
     * started, since both fire on one switch. The tree then never arrives, and
     * only for a repository whose graph is read faster than its tree, which is
     * the small ones. Only a newer read may retire an older one.
     */
    const mine = ++ticket.current
    fetchBranches(current)
      .then((list) => {
        if (mine === ticket.current) setAnswer({ repo: current, list })
      })
      .catch((err) => {
        if (mine !== ticket.current) return
        setAnswer({ repo: current, error: err instanceof Error ? err.message : String(err) })
      })
  }, [shown, current, fingerprint])

  const { width, grip } = usePanelWidth('refs', MIN_WIDTH, 'left')

  const fold = (path: string) =>
    setShut((was) => {
      const next = new Set(was)
      if (!next.delete(path)) next.add(path)
      return next
    })

  /**
   * One gesture for what used to be two.
   *
   * A folder is chosen, and if it is a repository it opens. If it is not one but
   * holds some, those are offered instead: scanning is not a separate errand, it
   * is what choosing a folder means when the folder is a shelf and not a book.
   */
  const openFolder = async (path: string | null) => {
    setTrouble(null)
    setFound(null)
    if (!path) return

    let refused: string
    try {
      const { repo } = await openRepo(path)
      onRepos()
      onPickRepo(repo.path)
      setTyped('')
      return
    } catch (err) {
      refused = err instanceof Error ? err.message : String(err)
    }

    // not a repository itself, so perhaps a shelf of them. If it is neither, the
    // reason it was refused says more than the reason a scan came back empty:
    // a backend that is down answers both, and only the first names the cause.
    try {
      const { repos: hits } = await discoverRepos(path)
      if (hits.length) setFound({ root: path, hits })
      else setTrouble(refused)
    } catch {
      setTrouble(refused)
    }
  }

  const add = async (path: string) => {
    try {
      const { repo } = await openRepo(path)
      onRepos()
      onPickRepo(repo.path)
      setFound(null)
    } catch (err) {
      setTrouble(err instanceof Error ? err.message : String(err))
    }
  }

  const drop = async (path: string) => {
    try {
      await closeRepo(path)
      onRepos()
      // the one being read must not become the one no row can reach any more
      if (path === current) {
        const next = repos.find((repo) => repo.path !== path)
        if (next) onPickRepo(next.path)
      }
    } catch (err) {
      setTrouble(err instanceof Error ? err.message : String(err))
    }
  }

  /**
   * The project under the pointer and the place it would take, or nothing at all.
   *
   * The list shows it already there rather than drawing anything of its own: what a hand is
   * doing is putting a row somewhere, and the row being there is what says so.
   */
  const [moving, setMoving] = useState<{ path: string; to: number } | null>(null)
  /** Where the pointer went down, until it has gone far enough to be a drag rather than a click. */
  const grabbed = useRef<{ path: string; y: number } | null>(null)
  /**
   * The same placement as `moving`, kept where the drop can read it.
   *
   * State lands on a render, and a hand that lets go in the same breath as its last move lets go
   * before that render: read from there, the drop would save the place before last.
   */
  const placed = useRef<{ path: string; to: number } | null>(null)
  const shelfRef = useRef<HTMLDivElement>(null)

  // the answer carries the repository it read, so a stale tree never shows under another one
  const answered = answer?.repo === current ? answer : null
  const list = answered?.list
  const needle = hunt.trim().toLowerCase()

  // one field for everything below it: the projects are hunted the same way the refs are
  const shelf = useMemo(
    () =>
      needle
        ? repos.filter(
            (repo) =>
              repo.name.toLowerCase().includes(needle) || repo.path.toLowerCase().includes(needle),
          )
        : repos,
    [repos, needle],
  )

  /** A shelf with one of its rows put somewhere else, which is what a hand on one is asking for. */
  const arrange = (list: RepoEntry[], put: { path: string; to: number } | null) => {
    if (!put) return list
    const one = list.find((repo) => repo.path === put.path)
    if (!one) return list
    const rest = list.filter((repo) => repo.path !== put.path)
    rest.splice(Math.max(0, Math.min(put.to, rest.length)), 0, one)
    return rest
  }

  /** The shelf as the hand is leaving it, which is the shelf itself while no hand is on it. */
  const arranged = useMemo(() => arrange(shelf, moving), [shelf, moving])

  /** Which row the pointer is over, by the halves of the rows as they stand at that moment. */
  const placeAt = (y: number) => {
    const rows = [...(shelfRef.current?.querySelectorAll('.project') ?? [])]
    for (let index = 0; index < rows.length; index += 1) {
      const box = rows[index].getBoundingClientRect()
      if (y < box.top + box.height / 2) return index
    }
    return Math.max(0, rows.length - 1)
  }

  const onGrab = (event: PointerEvent<HTMLDivElement>, repo: RepoEntry) => {
    // a hunted list is a list with rows missing from it, and an order set on those rows is an
    // order set on a list nobody has: the whole shelf has to be on screen to be rearranged
    if (needle || event.button !== 0) return
    grabbed.current = { path: repo.path, y: event.clientY }
  }

  const onDrag = (event: PointerEvent<HTMLDivElement>) => {
    const held = grabbed.current
    if (!held) return
    if (!moving) {
      // four pixels, so that a click with a hand that is not perfectly still stays a click
      if (Math.abs(event.clientY - held.y) < 4) return
      event.currentTarget.setPointerCapture(event.pointerId)
    }
    const put = { path: held.path, to: placeAt(event.clientY) }
    placed.current = put
    setMoving(put)
  }

  /**
   * The click a drop leaves behind, which would open whatever the row landed on.
   *
   * Caught on the row itself rather than remembered in a flag: a flag has to be put down again,
   * and the click it waits for is one a drop does not always produce. The listener goes at the
   * end of the same turn, so a drop that raised no click leaves nothing behind either.
   */
  const swallowClick = (row: HTMLElement) => {
    const eat = (event: Event) => {
      event.stopPropagation()
      event.preventDefault()
    }
    row.addEventListener('click', eat, { capture: true, once: true })
    setTimeout(() => row.removeEventListener('click', eat, { capture: true }), 0)
  }

  const onDrop = async (event: PointerEvent<HTMLDivElement>) => {
    const row = event.currentTarget
    const held = grabbed.current
    const put = placed.current
    grabbed.current = null
    placed.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    if (!held || !put) return
    swallowClick(row)
    const order = arrange(shelf, put).map((repo) => repo.path)
    setMoving(null)
    try {
      await orderRepos(order)
      onRepos()
    } catch (err) {
      setTrouble(err instanceof Error ? err.message : String(err))
      onRepos()
    }
  }

  const shape = useMemo(() => {
    const keep = <T extends Named>(refs: T[]) =>
      needle ? refs.filter((one) => one.name.toLowerCase().includes(needle)) : refs
    return {
      locals: ordered(tree(keep(list?.branches ?? []))),
      remotes: ordered(tree(keep(list?.remotes ?? []))),
      // a tag is looked for by how recent it is, and the alphabet says nothing of that
      tags: tree(keep(list?.tags ?? [])),
    }
  }, [list, needle])

  /** Lit either because the graph is bounded by it, or because it stands on the commit read. */
  const litUp = (refname: string, head: string) => refname === active || head === here

  const branchLeaf = (node: Leaf<Branch>, depth: number) => {
    const refname = HEADS + node.ref.name
    return (
      <button
        key={node.path}
        className={litUp(refname, node.ref.head) ? 'twig leaf on' : 'twig leaf'}
        style={{ paddingLeft: 6 + depth * 12 + 14 }}
        title={storyOf(node.ref, list?.base ?? null)}
        onClick={() => onTake(refname, node.ref.head)}
      >
        <span className="name">{node.name}</span>
        {node.ref.current && <span className="here">HEAD</span>}
        {!node.ref.upstream && <span className="nowhere">new</span>}
        <Divergence behind={node.ref.behind} ahead={node.ref.ahead} />
      </button>
    )
  }

  /** Remote branches and tags differ only by the drawer their name lives in. */
  const plainLeaf = (drawer: string) => (node: Leaf<PlainRef>, depth: number) => {
    const refname = drawer + node.ref.name
    return (
      <button
        key={node.path}
        className={litUp(refname, node.ref.head) ? 'twig leaf on' : 'twig leaf'}
        style={{ paddingLeft: 6 + depth * 12 + 14 }}
        title={`${node.ref.head.slice(0, 12)}\n${since(new Date(node.ref.t))}`}
        onClick={() => onTake(refname, node.ref.head)}
      >
        <span className="name">{node.name}</span>
      </button>
    )
  }

  /**
   * A drawer, and what may stand at the end of the row naming it.
   *
   * `beside` is a sibling of the fold rather than something inside it: what folds a drawer is a
   * button, and a button holds no second one.
   *
   * `count` is left out where the rows are few enough to be counted by looking at them. It earns
   * its place on a drawer that holds a hundred branches and is shut.
   */
  const section = (
    key: string,
    label: string,
    count: number | null,
    body: ReactNode,
    beside?: ReactNode,
  ) => (
    <div className="part" key={key}>
      <div className="part-row">
        <button className="twig part-head" onClick={() => fold(key)}>
          <span className="caret">{shut.has(key) ? '>' : 'v'}</span>
          <span className="name">{label}</span>
          {count !== null && <span className="count">{count}</span>}
        </button>
        {beside}
      </div>
      {!shut.has(key) && body}
    </div>
  )

  const known = new Set(repos.map((repo) => repo.path))

  return (
    <aside className={shown ? 'sidebar' : 'sidebar gone'} style={{ width }}>
      <div className="hunt">
        <input
          value={hunt}
          spellCheck={false}
          placeholder="project, branch or tag"
          onChange={(event) => setHunt(event.target.value)}
        />
      </div>

      <div className="tree">
        {section('\0projects', 'projects', null,
          <div ref={shelfRef}>
            {arranged.map((repo) => (
              <div
                key={repo.path}
                className={
                  [
                    'project',
                    repo.path === current ? 'on' : '',
                    moving?.path === repo.path ? 'lifted' : '',
                  ].filter(Boolean).join(' ')
                }
                onPointerDown={(event) => onGrab(event, repo)}
                onPointerMove={onDrag}
                onPointerUp={(event) => void onDrop(event)}
                onPointerCancel={(event) => void onDrop(event)}
              >
                <button className="body" title={repo.path} onClick={() => onPickRepo(repo.path)}>
                  <span className="name">{repo.name}</span>
                  <span className="dim">{repo.error ?? repo.branch}{repo.dirty ? ' *' : ''}</span>
                </button>
                <button className="x" title="forget it" onClick={() => void drop(repo.path)}>x</button>
              </div>
            ))}
            {repos.length === 0 && <p className="empty asks">add a folder</p>}
            {shelf.length === 0 && repos.length > 0 && <p className="empty">no project by that name</p>}

            {!canPickFolder && (
              <div className="byhand">
                <input
                  value={typed}
                  spellCheck={false}
                  placeholder="a folder to open"
                  onChange={(event) => setTyped(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && void openFolder(typed)}
                />
                <button onClick={() => void openFolder(typed)}>open</button>
              </div>
            )}

            {trouble && <p className="empty">{trouble}</p>}
            {found && (
              <div className="found">
                <p className="empty">{found.hits.length} under {found.root}</p>
                {found.hits.map((repo) => (
                  <button
                    key={repo.path}
                    className="twig leaf"
                    style={{ paddingLeft: 32 }}
                    disabled={known.has(repo.path)}
                    title={repo.path}
                    onClick={() => void add(repo.path)}
                  >
                    <span className="name">{repo.name}</span>
                    <span className="dim">{known.has(repo.path) ? 'already open' : repo.branch}</span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          canPickFolder ? (
            <button
              className="add"
              title="open a folder, or one holding repositories"
              onClick={() => {
                pickFolder()
                  .then((path) => openFolder(path))
                  .catch((err) => setTrouble(err instanceof Error ? err.message : String(err)))
              }}
            >
              +
            </button>
          ) : undefined,
        )}

        {answered?.error && <p className="empty">{answered.error}</p>}
        {!answered && <p className="empty">reading...</p>}
        {list && (
          <>
            {section('\0local', 'local', list.branches.length,
              <Twig nodes={shape.locals} depth={1} shut={shut} onFold={fold} leaf={branchLeaf} />)}
            {section('\0remote', 'remote', list.remotes.length,
              <Twig nodes={shape.remotes} depth={1} shut={shut} onFold={fold} leaf={plainLeaf(REMOTES)} />)}
            {section('\0tags', 'tags', list.tags.length,
              <Twig nodes={shape.tags} depth={1} shut={shut} onFold={fold} leaf={plainLeaf(TAGS)} />)}
          </>
        )}
      </div>

      <div className="grip" {...grip} />
    </aside>
  )
}
