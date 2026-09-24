import { useEffect, useRef, useState } from 'react'
import { clamp, formatTime } from '../lib/time.ts'

type Handle = 'start' | 'end'

const MIN_SELECTION = 0.1
const BAR = 2
const BAR_GAP = 1

interface Props {
  /** min/max pairs from computePeaks(). */
  peaks: Float32Array
  duration: number
  start: number
  end: number
  playhead: number | null
  onRange: (start: number, end: number) => void
  /** A handle was let go (drag or keyboard); the preview replays from just before it. */
  onHandleRelease: (handle: Handle, time: number) => void
  onSeek: (time: number) => void
}

export function Waveform(props: Props) {
  const { peaks, duration, start, end } = props
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const drag = useRef<Handle | null>(null)

  useEffect(() => {
    const el = trackRef.current!
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current!
    const track = trackRef.current!
    const dpr = window.devicePixelRatio || 1
    const w = track.clientWidth
    const h = track.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    const ctx = canvas.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)
    if (!w || !duration) return

    const styles = getComputedStyle(canvas)
    const inside = styles.getPropertyValue('--shu').trim() || '#c24a22'
    const outside = styles.getPropertyValue('--line').trim() || '#d9d2c3'
    const buckets = peaks.length / 2
    const bars = Math.floor(w / (BAR + BAR_GAP))
    const mid = h / 2
    // Loudness is shown relative to the loudest point, so quiet recordings still read.
    let max = 0.001
    for (let i = 0; i < peaks.length; i++) max = Math.max(max, Math.abs(peaks[i]))

    for (let b = 0; b < bars; b++) {
      const from = Math.floor((b / bars) * buckets)
      const to = Math.max(from + 1, Math.floor(((b + 1) / bars) * buckets))
      let lo = 0
      let hi = 0
      for (let i = from; i < to; i++) {
        lo = Math.min(lo, peaks[i * 2])
        hi = Math.max(hi, peaks[i * 2 + 1])
      }
      const top = mid - (hi / max) * (mid - 2)
      const bottom = mid - (lo / max) * (mid - 2)
      const x = b * (BAR + BAR_GAP)
      const t = ((b + 0.5) / bars) * duration
      ctx.fillStyle = t >= start && t <= end ? inside : outside
      ctx.fillRect(x, top, BAR, Math.max(1.5, bottom - top))
    }
  }, [peaks, duration, start, end, width])

  const timeAt = (clientX: number) => {
    const r = trackRef.current!.getBoundingClientRect()
    return clamp(((clientX - r.left) / r.width) * duration, 0, duration)
  }

  const moveHandle = (handle: Handle, t: number) => {
    if (handle === 'start') props.onRange(clamp(t, 0, Math.max(0, end - MIN_SELECTION)), end)
    else props.onRange(start, clamp(t, Math.min(duration, start + MIN_SELECTION), duration))
  }

  const pct = (t: number) => `${(duration ? t / duration : 0) * 100}%`

  const handleEl = (handle: Handle) => {
    const t = handle === 'start' ? start : end
    return (
      <div
        className="handle"
        role="slider"
        tabIndex={0}
        aria-label={handle === 'start' ? '开始' : '结束'}
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={t}
        aria-valuetext={formatTime(t)}
        style={{ left: pct(t) }}
        onPointerDown={(e) => {
          e.stopPropagation()
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = handle
        }}
        onPointerMove={(e) => {
          if (drag.current === handle) moveHandle(handle, timeAt(e.clientX))
        }}
        onPointerUp={(e) => {
          if (drag.current !== handle) return
          drag.current = null
          const released = timeAt(e.clientX)
          props.onHandleRelease(handle, handle === 'start' ? Math.min(released, end - MIN_SELECTION) : Math.max(released, start + MIN_SELECTION))
        }}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 1 : 0.1
          const delta = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          if (!delta) return
          e.preventDefault()
          e.stopPropagation()
          moveHandle(handle, t + delta)
        }}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') props.onHandleRelease(handle, t)
        }}
      />
    )
  }

  return (
    <div
      className="wave"
      onPointerDown={(e) => {
        if (e.button === 0) props.onSeek(timeAt(e.clientX))
      }}
    >
      <canvas ref={canvasRef} aria-hidden />
      <div className="track" ref={trackRef}>
        <div className="sel" style={{ left: pct(start), width: pct(Math.max(0, end - start)) }} />
        {props.playhead !== null && <div className="playhead" style={{ left: pct(props.playhead) }} />}
        {handleEl('start')}
        {handleEl('end')}
      </div>
    </div>
  )
}
