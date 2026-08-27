import { useRef, useState, type PointerEvent } from 'react'

/**
 * Which of the fixed columns a hand can move. The subject is what the others leave.
 *
 * The dates are not among them. What that column holds is `14 min` and `12 Aug`, so the width
 * that fits them is the width that fits them, and a grip there offered a choice between the
 * right answer and a wrong one. It stands against the right edge at what it measures.
 */
export type Column = 'gutter' | 'lanes' | 'who'

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
  /**
   * The widths as the drag has them, kept where the settling can read them.
   *
   * State lands on a render, and a hand that lets go in the same breath as its last move lets go
   * before that render: read from state, what is written down is the width before last.
   */
  const now = useRef<Held>(held)

  const write = (next: Held) => {
    now.current = next
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
      now.current = { ...now.current, [start.column]: Math.max(MIN, Math.round(wide)) }
      setHeld(now.current)
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (!from.current) return
      from.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      write(now.current)
    },
    onDoubleClick: () => {
      const next = { ...now.current }
      delete next[column]
      write(next)
    },
  })

  return { held, grip }
}
