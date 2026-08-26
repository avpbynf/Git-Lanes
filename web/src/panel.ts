import { useRef, useState, type PointerEvent } from 'react'

/**
 * How narrow either side may be pulled.
 *
 * One number for both, since the two are the same thing mirrored: a panel that stopped wider
 * than the other read as a panel that was holding something back, and what somebody wants a
 * column reduced to is their business rather than this file's.
 */
export const MIN_WIDTH = 200

/**
 * How wide either side starts, before anyone drags it.
 *
 * One number for both, for the same reason: two columns that opened at different widths read as
 * two different kinds of thing, when they are one thing mirrored. Narrow on purpose, since what
 * the window is open for is the graph between them.
 */
export const WIDTH = 300

/**
 * A panel dragged wider or narrower by one of its edges.
 *
 * The pointer is captured, so the drag survives leaving the few pixels it
 * started on, and the width is only written down once the drag settles: a write
 * per pixel would be a thousand writes per drag.
 */
export function usePanelWidth(key: string, fallback: number, min: number, side: 'left' | 'right') {
  const [width, setWidth] = useState(() => {
    const held = Number(localStorage.getItem(key))
    return held >= min ? held : fallback
  })
  const sizing = useRef(false)

  const grab = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    sizing.current = true
  }

  const size = (event: PointerEvent<HTMLDivElement>) => {
    if (!sizing.current) return
    const wide = side === 'right' ? innerWidth - event.clientX : event.clientX
    setWidth(Math.max(min, Math.round(wide)))
  }

  const settle = (event: PointerEvent<HTMLDivElement>) => {
    if (!sizing.current) return
    sizing.current = false
    event.currentTarget.releasePointerCapture(event.pointerId)
    localStorage.setItem(key, String(width))
  }

  return { width, grip: { onPointerDown: grab, onPointerMove: size, onPointerUp: settle } }
}
