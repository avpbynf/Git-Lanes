import { useRef, useState, type PointerEvent } from 'react'

/** Which of the fixed columns a hand can move. The subject is what the others leave. */
export type Column = 'gutter' | 'lanes' | 'who' | 'when'

/** What a column may not go under. Below this there is nothing left to read in it. */
const MIN = 24

const KEY = 'columns'

type Held = Partial<Record<Column, number>>

function read(): Held {
  try {
    const held = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Held
    return typeof held === 'object' && held !== null ? held : {}
  } catch {
    return {}
  }
}

/**
 * The width of the columns that are not the subject, where a hand last put them.
 *
 * A width set by hand replaces the measurement rather than starting from it, and stays until it
 * is given back: what somebody wants to see is not always what the widest name among six
 * thousand commits wants. A grip let go of twice hands the measurement back.
 *
 * The pointer is captured, so a drag survives leaving the few pixels it started on, and the
 * width is written down once it settles rather than once per pixel.
 */
export function useColumns() {
  const [held, setHeld] = useState<Held>(read)
  const from = useRef<{ column: Column; x: number; width: number; sign: number } | null>(null)

  const write = (next: Held) => {
    setHeld(next)
    localStorage.setItem(KEY, JSON.stringify(next))
  }

  /**
   * `sign` is which way widens: the gutter grows to the right of its grip, the two columns on
   * the right grow to the left of theirs.
   */
  const grip = (column: Column, width: number, sign: number) => ({
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      from.current = { column, x: event.clientX, width, sign }
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      const start = from.current
      if (!start) return
      const wide = start.width + start.sign * (event.clientX - start.x)
      setHeld((was) => ({ ...was, [start.column]: Math.max(MIN, Math.round(wide)) }))
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!from.current) return
      from.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      write(held)
    },
    onDoubleClick: () => {
      const next = { ...held }
      delete next[column]
      write(next)
    },
  })

  return { held, grip }
}
