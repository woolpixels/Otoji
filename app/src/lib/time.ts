// Time codes are always mm:ss.s (hh:mm:ss.s past an hour) so the monospace digits never jump.

const pad = (n: number, w = 2) => String(n).padStart(w, '0')

/** 72.46 → "01:12.5" */
export function formatTime(sec: number): string {
  const tenths = Math.max(0, Math.round(sec * 10))
  const s = Math.floor(tenths / 10) % 60
  const m = Math.floor(tenths / 600) % 60
  const h = Math.floor(tenths / 36000)
  const body = `${pad(m)}:${pad(s)}.${tenths % 10}`
  return h > 0 ? `${h}:${body}` : body
}

/** Whole seconds, for file metadata: 375.2 → "06:15" */
export function formatDuration(sec: number): string {
  const total = Math.max(0, Math.round(sec))
  const s = total % 60
  const m = Math.floor(total / 60) % 60
  const h = Math.floor(total / 3600)
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/**
 * Accepts "mm:ss.s", "hh:mm:ss.s" or plain seconds ("72.5"). Full-width colons and
 * periods from a Chinese IME are tolerated. Returns null when it cannot be read.
 */
export function parseTime(input: string): number | null {
  const text = input.trim().replace(/[：]/g, ':').replace(/[。．]/g, '.')
  if (!text) return null
  const parts = text.split(':')
  if (parts.length > 3) return null
  if (!parts.every((p, i) => (i === parts.length - 1 ? /^\d+(\.\d*)?$|^\.\d+$/ : /^\d+$/).test(p))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Range suffix for trimmed exports: 72, 267.5 → "0112-0427" (minutes may exceed 99). */
export function rangeTag(start: number, end: number): string {
  const mmss = (t: number) => {
    const total = Math.floor(t)
    return `${pad(Math.floor(total / 60))}${pad(total % 60)}`
  }
  return `${mmss(start)}-${mmss(end)}`
}

/** Seconds to a short label: 0.5 → "0.5", 1 → "1", 1.25 → "1.3" */
export function formatSeconds(sec: number): string {
  return String(Math.round(sec * 10) / 10)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Constant-bitrate MP3 size estimate. */
export const estimateMp3Bytes = (kbps: number, seconds: number) => (kbps * 1000 / 8) * seconds
