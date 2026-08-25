import { useEffect, useRef, useState } from 'react'
import type { Theme } from '../lanes'
import type { BranchClick, PanelMode, Settings } from '../settings'

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
}

interface ChoiceProps {
  label: string
  hint: string
  value: string
  options: [string, string][]
  onPick: (value: string) => void
}

/** Eight teeth on a 16 grid, outer radius 6.75, root 4.9. Drawn, not hand written. */
const COG = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M12.79 6.98L14.60 6.60A6.75 6.75 0 0 1 14.60 9.40L12.79 9.02A4.9 4.9 0 0 1 12.11 10.67L13.66 11.68A6.75 6.75 0 0 1 11.68 13.66L10.67 12.11A4.9 4.9 0 0 1 9.02 12.79L9.40 14.60A6.75 6.75 0 0 1 6.60 14.60L6.98 12.79A4.9 4.9 0 0 1 5.33 12.11L4.32 13.66A6.75 6.75 0 0 1 2.34 11.68L3.89 10.67A4.9 4.9 0 0 1 3.21 9.02L1.40 9.40A6.75 6.75 0 0 1 1.40 6.60L3.21 6.98A4.9 4.9 0 0 1 3.89 5.33L2.34 4.32A6.75 6.75 0 0 1 4.32 2.34L5.33 3.89A4.9 4.9 0 0 1 6.98 3.21L6.60 1.40A6.75 6.75 0 0 1 9.40 1.40L9.02 3.21A4.9 4.9 0 0 1 10.67 3.89L11.68 2.34A6.75 6.75 0 0 1 13.66 4.32L12.11 5.33A4.9 4.9 0 0 1 12.79 6.98Z" />
    <circle cx="8" cy="8" r="2.3" />
  </svg>
)

function Choice({ label, hint, value, options, onPick }: ChoiceProps) {
  return (
    <div className="opt">
      <span className="what">
        <span className="strong">{label}</span>
        <span className="hint">{hint}</span>
      </span>
      <span className="seg">
        {options.map(([key, text]) => (
          <button key={key} className={key === value ? 'on' : ''} onClick={() => onPick(key)}>
            {text}
          </button>
        ))}
      </span>
    </div>
  )
}

export function SettingsMenu({ settings, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  return (
    <div className="settings" ref={box}>
      <button className="icon" title="settings" onClick={() => setOpen(!open)}>
        {COG}
      </button>

      {open && (
        <div className="drop">
          <Choice
            label="theme"
            hint="what the window is painted with"
            value={settings.theme}
            options={[['dark', 'dark'], ['light', 'light']]}
            onPick={(value) => onChange({ theme: value as Theme })}
          />
          <Choice
            label="a branch clicked"
            hint="in the list next to the repository"
            value={settings.branchClick}
            options={[['reveal', 'goes to its tip'], ['filter', 'bounds the graph']]}
            onPick={(value) => onChange({ branchClick: value as BranchClick })}
          />
          <Choice
            label="the commit panel"
            hint="where the message and the files show"
            value={settings.panel}
            options={[['over', 'over the graph'], ['beside', 'beside it']]}
            onPick={(value) => onChange({ panel: value as PanelMode })}
          />
        </div>
      )}
    </div>
  )
}
