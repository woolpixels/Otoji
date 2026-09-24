import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { encodeMp3, type EncodeJob } from './lib/encoder.ts'
import { downloadTarget, type SaveTarget } from './lib/save.ts'

export const QUALITIES = [128, 192, 320] as const
export type Quality = (typeof QUALITIES)[number]

/** Drag-and-drop target plus a hidden file input; returns the handlers and the "over" flag. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [over, setOver] = useState(false)
  const depth = useRef(0)
  return {
    over,
    handlers: {
      onDragEnter: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        depth.current++
        setOver(true)
      },
      onDragLeave: () => {
        depth.current = Math.max(0, depth.current - 1)
        if (depth.current === 0) setOver(false)
      },
      onDragOver: (e: React.DragEvent) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      },
      onDrop: (e: React.DragEvent) => {
        e.preventDefault()
        depth.current = 0
        setOver(false)
        const files = Array.from(e.dataTransfer.files)
        if (files.length) onFiles(files)
      },
    },
  }
}

export function openFilePicker(accept: string, multiple: boolean, onFiles: (files: File[]) => void) {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = accept
  input.multiple = multiple
  input.onchange = () => {
    const files = Array.from(input.files ?? [])
    if (files.length) onFiles(files)
  }
  input.click()
}

type ExportState =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'encoding'; progress: number }
  | { kind: 'done'; result: ExportResult }
  | { kind: 'error'; message: string }

/** What the finished page shows about the file that was just written. */
export interface ExportResult {
  name: string
  method: SaveTarget['method']
  blob: Blob
  duration: number
  kbps: number
  sampleRate: number
  channels: number
}

/** Build the job (may resample) → encode in the worker → download into 下载. */
export function useExport() {
  const [state, setState] = useState<ExportState>({ kind: 'idle' })
  const abort = useRef<AbortController | null>(null)

  const busy = state.kind === 'preparing' || state.kind === 'encoding'

  async function run(fileName: string, duration: number, buildJob: () => Promise<Omit<EncodeJob, 'onProgress' | 'signal'>>) {
    if (busy) return
    const target = downloadTarget(fileName)
    const controller = new AbortController()
    abort.current = controller
    setState({ kind: 'preparing' })
    try {
      const job = await buildJob()
      if (controller.signal.aborted) throw new DOMException('已取消', 'AbortError')
      setState({ kind: 'encoding', progress: 0 })
      const blob = await encodeMp3({ ...job, signal: controller.signal, onProgress: (p) => setState({ kind: 'encoding', progress: p }) })
      await target.write(blob)
      setState({
        kind: 'done',
        result: { name: target.name, method: target.method, blob, duration, kbps: job.kbps, sampleRate: job.sampleRate, channels: job.channels },
      })
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') setState({ kind: 'idle' })
      else setState({ kind: 'error', message: `导出失败：${err instanceof Error ? err.message : String(err)}` })
    } finally {
      abort.current = null
    }
  }

  return {
    state,
    busy,
    run,
    cancel: () => abort.current?.abort(),
    /** Leaves the finished page (or clears an error) and goes back to editing. */
    reset: () => setState({ kind: 'idle' }),
  }
}

/** True when a key event comes from a text field, where shortcuts must not fire. */
export const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
}

/** Calls `fn` every animation frame while `active`. */
export function useFrame(active: boolean, fn: () => void) {
  const ref = useRef(fn)
  useLayoutEffect(() => {
    ref.current = fn
  })
  useEffect(() => {
    if (!active) return
    let id = 0
    const tick = () => {
      ref.current()
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [active])
}

/** Latest-value ref, for event handlers registered once. */
export function useLatest<T>(value: T) {
  const ref = useRef(value)
  useLayoutEffect(() => {
    ref.current = value
  })
  return ref
}
