import { useRef, useState, type PointerEvent } from 'react'

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
