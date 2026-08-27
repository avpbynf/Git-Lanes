import { useRef, useState, type PointerEvent } from 'react'

/**
 * How wide either side opens, which is also how narrow it may be pulled.
 *
 * One number for both, since the two are the same thing mirrored: a panel that stopped wider
 * than the other read as a panel that was holding something back, and what somebody wants a
 * column reduced to is their business rather than this file's.
 *
 * And one number rather than two, since what a column opens at is a guess about somebody's
 * screen and their reading, made before either is known. Opening at the narrowest it goes puts
 * that guess where it belongs: the window opens for the graph, and a column widened by hand
 * stays widened, so the guess is only ever made once and never against anybody.
 */
export const MIN_WIDTH = 200

/**
 * A panel dragged wider or narrower by one of its edges.
 *
 * The pointer is captured, so the drag survives leaving the few pixels it
 * started on, and the width is only written down once the drag settles: a write
 * per pixel would be a thousand writes per drag.
 */
export function usePanelWidth(key: string, min: number, side: 'left' | 'right') {
  const [width, setWidth] = useState(() => {
    const held = Number(localStorage.getItem(key))
    return held >= min ? held : min
  })
  const sizing = useRef(false)
  /**
   * The width as the drag has it, kept where the settling can read it.
   *
   * State lands on a render, and a hand that lets go in the same breath as its last move lets go
   * before that render: read from state, the width written down would be the one before last.
   */
  const held = useRef(width)

  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    sizing.current = true
  }

  const size = (event: PointerEvent<HTMLDivElement>) => {
    if (!sizing.current) return
    const wide = side === 'right' ? innerWidth - event.clientX : event.clientX
    held.current = Math.max(min, Math.round(wide))
    setWidth(held.current)
  }

  const settle = (event: PointerEvent<HTMLDivElement>) => {
    if (!sizing.current) return
    sizing.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(key, String(held.current))
  }

  return { width, grip: { onPointerDown: grab, onPointerMove: size, onPointerUp: settle } }
}
