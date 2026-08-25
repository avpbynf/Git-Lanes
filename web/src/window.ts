import type { MouseEvent } from 'react'
import { insideApp } from './api'

/**
 * The window the page is drawn in, when the page IS the window.
 *
 * The app runs undecorated, so it draws its own title bar. The move is asked
 * for by hand rather than through the data-tauri-drag-region attribute: one
 * mechanism, and one place to look when it does not answer.
 */
export interface WindowHandle {
  minimize: () => Promise<void>
  toggleMaximize: () => Promise<void>
  startDragging: () => Promise<void>
  close: () => Promise<void>
}

type WithTauri = {
  __TAURI__?: { window?: { getCurrentWindow?: () => WindowHandle } }
}

export const windowHandle: WindowHandle | null = insideApp
  ? ((globalThis as WithTauri).__TAURI__?.window?.getCurrentWindow?.() ?? null)
  : null

/** Spread on anything that should behave like a title bar. */
export const dragProps = windowHandle
  ? {
      onMouseDown: (event: MouseEvent) => {
        if (event.button !== 0) return
        if (event.detail === 2) {
          void windowHandle.toggleMaximize()
          return
        }
        void windowHandle.startDragging()
      },
    }
  : {}
