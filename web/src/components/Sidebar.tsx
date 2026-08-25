import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  canPickFolder, closeRepo, discoverRepos, fetchBranches, openRepo, pickFolder,
  type Branch, type BranchList, type PlainRef, type RepoEntry,
} from '../api'
import { ago } from '../lanes'
import { usePanelWidth } from '../panel'
import { countOf, ordered, tree, type Leaf, type Named, type Node } from '../refs'
import { HEADS, REMOTES, TAGS } from '../scope'

const MIN_WIDTH = 200
const WIDTH = 300

interface Props {
  repos: RepoEntry[]
  current: string | null
  shown: boolean
  /** The full name of the ref the reading sits on, which the tree highlights. */
  active: string | null
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
  const lines = [branch.head.slice(0, 12), `last touched ${ago(new Date(branch.t))}`]
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
  repos, current, shown, active, fingerprint, onPickRepo, onRepos, onTake,
}: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [hunt, setHunt] = useState('')
  // remote branches and tags are many and rarely what one is looking for
  const [shut, setShut] = useState<Set<string>>(() => new Set(['\0remote', '\0tags']))
  const [typed, setTyped] = useState('')
  const [found, setFound] = useState<{ root: string; hits: RepoEntry[] } | null>(null)
  const [trouble, setTrouble] = useState<string | null>(null)

  useEffect(() => {
    if (!shown) return
    let live = true
    fetchBranches(current)
      .then((list) => live && setAnswer({ repo: current, list }))
      .catch((err) => live && setAnswer({ repo: current, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [shown, current, fingerprint])

  const { width, grip } = usePanelWidth('refs', WIDTH, MIN_WIDTH, 'left')

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
    try {
      const { repo } = await openRepo(path)
      onRepos()
      onPickRepo(repo.path)
      setTyped('')
    } catch {
      try {
        const { repos: hits } = await discoverRepos(path)
        if (!hits.length) setTrouble(`no repository in or under ${path}`)
        else setFound({ root: path, hits })
      } catch (err) {
        setTrouble(err instanceof Error ? err.message : String(err))
      }
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
    await closeRepo(path)
    onRepos()
  }

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

  const branchLeaf = (node: Leaf<Branch>, depth: number) => {
    const refname = HEADS + node.ref.name
    return (
      <button
        key={node.path}
        className={refname === active ? 'twig leaf on' : 'twig leaf'}
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
        className={refname === active ? 'twig leaf on' : 'twig leaf'}
        style={{ paddingLeft: 6 + depth * 12 + 14 }}
        title={`${node.ref.head.slice(0, 12)}\n${ago(new Date(node.ref.t))}`}
        onClick={() => onTake(refname, node.ref.head)}
      >
        <span className="name">{node.name}</span>
      </button>
    )
  }

  const section = (key: string, label: string, count: number, body: ReactNode) => (
    <div className="part" key={key}>
      <button className="twig part-head" onClick={() => fold(key)}>
        <span className="caret">{shut.has(key) ? '>' : 'v'}</span>
        <span className="name">{label}</span>
        <span className="count">{count}</span>
      </button>
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
        {section('\0projects', 'projects', repos.length,
          <>
            {shelf.map((repo) => (
              <div
                key={repo.path}
                className={repo.path === current ? 'project on' : 'project'}
              >
                <button className="body" title={repo.path} onClick={() => onPickRepo(repo.path)}>
                  <span className="name">{repo.name}</span>
                  <span className="dim">{repo.error ?? repo.branch}{repo.dirty ? ' *' : ''}</span>
                </button>
                <button className="x" title="forget it" onClick={() => void drop(repo.path)}>x</button>
              </div>
            ))}
            {repos.length === 0 && <p className="empty">nothing opened yet</p>}
            {shelf.length === 0 && repos.length > 0 && <p className="empty">no project by that name</p>}

            {canPickFolder ? (
              <button
                className="twig add"
                onClick={() => void pickFolder().then((path) => openFolder(path))}
              >
                + open a folder
              </button>
            ) : (
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
                <p className="empty">{found.hits.length} under that folder</p>
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
          </>,
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
