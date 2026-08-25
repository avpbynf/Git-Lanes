import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { fetchBranches, type Branch, type BranchList, type PlainRef } from '../api'
import { ago } from '../lanes'
import { usePanelWidth } from '../panel'
import { countOf, tree, type Leaf, type Named, type Node } from '../refs'

const MIN_WIDTH = 200
const WIDTH = 300

interface Props {
  repo: string | null
  shown: boolean
  /** The ref the reading sits on, which is what the tree highlights. */
  active: string | null
  /** Moves whenever a ref does, which is when the tree is worth reading again. */
  fingerprint: string
  /** Only a local branch can bound the graph, so the kind travels with the name. */
  onTake: (name: string, head: string, local: boolean) => void
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

export function RefsPanel({ repo, shown, active, fingerprint, onTake }: Props) {
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [hunt, setHunt] = useState('')
  // remote branches and tags are many and rarely what one is looking at
  const [shut, setShut] = useState<Set<string>>(() => new Set(['\0remote', '\0tags']))

  useEffect(() => {
    if (!shown) return
    let live = true
    fetchBranches(repo)
      .then((list) => live && setAnswer({ repo, list }))
      .catch((err) => live && setAnswer({ repo, error: err instanceof Error ? err.message : String(err) }))
    return () => {
      live = false
    }
  }, [shown, repo, fingerprint])

  const { width, grip } = usePanelWidth('refs', WIDTH, MIN_WIDTH, 'left')

  const fold = (path: string) =>
    setShut((was) => {
      const next = new Set(was)
      if (!next.delete(path)) next.add(path)
      return next
    })

  // the answer carries the repository it read, so a stale tree never shows under another one
  const answered = answer?.repo === repo ? answer : null
  const list = answered?.list
  const needle = hunt.trim().toLowerCase()

  // the hunt narrows the flat list, and the tree is built from what survives, so
  // a folder holding nothing that matches never draws at all
  const shape = useMemo(() => {
    const keep = <T extends Named>(refs: T[]) =>
      needle ? refs.filter((one) => one.name.toLowerCase().includes(needle)) : refs
    return {
      locals: tree(keep(list?.branches ?? [])),
      remotes: tree(keep(list?.remotes ?? [])),
      tags: tree(keep(list?.tags ?? [])),
    }
  }, [list, needle])

  const branchLeaf = (node: Leaf<Branch>, depth: number) => (
    <button
      key={node.path}
      className={node.ref.name === active ? 'twig leaf on' : 'twig leaf'}
      style={{ paddingLeft: 6 + depth * 12 + 14 }}
      title={storyOf(node.ref, list?.base ?? null)}
      onClick={() => onTake(node.ref.name, node.ref.head, true)}
    >
      <span className="name">{node.name}</span>
      {node.ref.current && <span className="here">HEAD</span>}
      {!node.ref.upstream && <span className="nowhere">new</span>}
      <Divergence behind={node.ref.behind} ahead={node.ref.ahead} />
    </button>
  )

  const plainLeaf = (node: Leaf<PlainRef>, depth: number) => (
    <button
      key={node.path}
      className={node.ref.name === active ? 'twig leaf on' : 'twig leaf'}
      style={{ paddingLeft: 6 + depth * 12 + 14 }}
      title={`${node.ref.head.slice(0, 12)}\n${ago(new Date(node.ref.t))}`}
      onClick={() => onTake(node.ref.name, node.ref.head, false)}
    >
      <span className="name">{node.name}</span>
    </button>
  )

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

  return (
    <aside className={shown ? 'refs-panel' : 'refs-panel gone'} style={{ width }}>
      <header>
        <span className="strong">refs</span>
      </header>

      <div className="hunt">
        <input
          value={hunt}
          spellCheck={false}
          placeholder="branch or tag"
          onChange={(event) => setHunt(event.target.value)}
        />
      </div>

      <div className="tree">
        {answered?.error && <p className="empty">{answered.error}</p>}
        {!answered && <p className="empty">reading...</p>}
        {list && (
          <>
            {section('\0local', 'local', list.branches.length,
              <Twig nodes={shape.locals} depth={1} shut={shut} onFold={fold} leaf={branchLeaf} />)}
            {section('\0remote', 'remote', list.remotes.length,
              <Twig nodes={shape.remotes} depth={1} shut={shut} onFold={fold} leaf={plainLeaf} />)}
            {section('\0tags', 'tags', list.tags.length,
              <Twig nodes={shape.tags} depth={1} shut={shut} onFold={fold} leaf={plainLeaf} />)}
          </>
        )}
      </div>

      <div className="grip" {...grip} />
    </aside>
  )
}
