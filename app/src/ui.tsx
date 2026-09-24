import { useState, type ReactNode } from 'react'
import type { useExport } from './hooks.ts'
import { clamp, formatTime, parseTime } from './lib/time.ts'

export function Segmented<T extends string | number>(props: {
  options: readonly T[]
  value: T | null
  onChange: (v: T) => void
  label: string
  mono?: boolean
  className?: string
  render?: (v: T) => ReactNode
  disabled?: boolean
}) {
  return (
    <div className={`segmented ${props.mono ? 'mono' : ''} ${props.className ?? ''}`} role="group" aria-label={props.label}>
      {props.options.map((o) => (
        <button key={String(o)} type="button" aria-pressed={o === props.value} disabled={props.disabled} onClick={() => props.onChange(o)}>
          {props.render ? props.render(o) : String(o)}
        </button>
      ))}
    </div>
  )
}

export function PlayButton({ playing, onClick, disabled }: { playing: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="play" onClick={onClick} disabled={disabled} aria-label={playing ? '暂停' : '播放'} title={playing ? '暂停（空格）' : '播放（空格）'}>
      {playing ? (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" /></svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4 2.2v11.6c0 .6.7 1 1.2.7l9.2-5.8c.5-.3.5-1 0-1.3L5.2 1.5C4.7 1.2 4 1.6 4 2.2z" /></svg>
      )}
    </button>
  )
}

export function WaveIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="M3 8v4M6.5 5v10M10 2.5v15M13.5 6v8M17 8.5v3" />
    </svg>
  )
}

/** mm:ss.s field that accepts plain seconds too; commits on Enter / blur, clamps to [0, max]. */
export function TimeInput(props: {
  value: number
  max: number
  invalid?: boolean
  /** Shortened relative to the source: shown in vermilion. */
  cut?: boolean
  onCommit: (v: number) => void
  label: string
}) {
  const [text, setText] = useState(formatTime(props.value))
  const [editing, setEditing] = useState(false)
  const shown = editing ? text : formatTime(props.value)

  const commit = (raw: string) => {
    setEditing(false)
    const v = parseTime(raw)
    if (v !== null) props.onCommit(clamp(v, 0, props.max))
  }

  return (
    <input
      className={`time-input ${props.invalid ? 'invalid' : props.cut ? 'cut' : ''}`}
      aria-label={props.label}
      aria-invalid={props.invalid}
      value={shown}
      spellCheck={false}
      inputMode="decimal"
      onFocus={(e) => {
        setText(formatTime(props.value))
        setEditing(true)
        e.currentTarget.select()
      }}
      onChange={(e) => setText(e.target.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        else if (e.key === 'Escape') {
          const input = e.currentTarget
          input.value = formatTime(props.value)
          setEditing(false)
          input.blur()
        }
      }}
    />
  )
}

export function ExportStatus({ exp }: { exp: ReturnType<typeof useExport> }) {
  const s = exp.state
  if (s.kind === 'preparing' || s.kind === 'encoding') {
    const pct = s.kind === 'encoding' ? Math.round(s.progress * 100) : 0
    return (
      <>
        <span className="status">{s.kind === 'preparing' ? '准备中…' : `编码中 ${pct}%`}</span>
        <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${pct}%` }} />
        </div>
        <button type="button" className="btn small" onClick={exp.cancel}>取消</button>
      </>
    )
  }
  if (s.kind === 'error') return <span className="status error">{s.message}</span>
  return null
}

