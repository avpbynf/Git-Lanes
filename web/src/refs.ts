/**
 * Ref names read as a tree.
 *
 * A branch called `feat/custom-images` is one branch, not two, but the slash in
 * it is how people already file their work. Splitting on it turns thirty flat
 * names into four folders, and git forbids a name being both a folder and a
 * ref, so a fork and a leaf never collide.
 *
 * The order refs arrive in is kept: the backends hand them over most recently
 * touched first, which is the order worth reading them in.
 */

export interface Named {
  name: string
}

export interface Leaf<T extends Named> {
  kind: 'leaf'
  name: string
  path: string
  ref: T
}

export interface Fork<T extends Named> {
  kind: 'fork'
  name: string
  path: string
  children: Node<T>[]
}

export type Node<T extends Named> = Leaf<T> | Fork<T>

export function tree<T extends Named>(refs: T[]): Node<T>[] {
  const roots: Node<T>[] = []
  for (const ref of refs) {
    const parts = ref.name.split('/')
    let level = roots
    let path = ''
    for (const part of parts.slice(0, -1)) {
      path = path ? `${path}/${part}` : part
      const held = level.find(
        (node): node is Fork<T> => node.kind === 'fork' && node.name === part,
      )
      const fork: Fork<T> = held ?? { kind: 'fork', name: part, path, children: [] }
      if (!held) level.push(fork)
      level = fork.children
    }
    level.push({ kind: 'leaf', name: parts[parts.length - 1], path: ref.name, ref })
  }
  return roots
}

/** How many refs hang under a node, which is what a closed folder shows. */
export function countOf<T extends Named>(node: Node<T>): number {
  return node.kind === 'leaf' ? 1 : node.children.reduce((sum, one) => sum + countOf(one), 0)
}
