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

const BURGER = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M2.4 4.2h11.2M2.4 8h11.2M2.4 11.8h11.2" />
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
        {BURGER}
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
