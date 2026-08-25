import { windowHandle } from '../window'

/** The three window buttons. In a browser the tab has its own, so nothing. */
export function WindowControls() {
  const handle = windowHandle
  if (!handle) return null

  return (
    <div className="wincontrols">
      <button title="minimise" onClick={() => void handle.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" /></svg>
      </button>
      <button title="maximise" onClick={() => void handle.toggleMaximize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" /></svg>
      </button>
      <button className="quit" title="close" onClick={() => void handle.close()}>
        <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" /></svg>
      </button>
    </div>
  )
}
