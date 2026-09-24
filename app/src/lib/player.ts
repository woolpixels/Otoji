// Preview without encoding: clips are scheduled one after another on an
// AudioContext, with each silence gap as the offset of the next start.
// The plan is re-read whenever a clip ends, so edits to order or gaps made
// during playback take effect from the next clip on.

import { getPlaybackContext } from './audio.ts'

export interface Clip {
  id: string
  buffer: AudioBuffer
  /** Seconds within the buffer. */
  from: number
  to: number
  /** Silence before the next clip, seconds. */
  gapAfter: number
}

export interface PlayPosition {
  id: string
  /** Seconds within the clip's buffer; below `from` while waiting out the gap before it. */
  time: number
}

export class SequencePlayer {
  private source: AudioBufferSourceNode | null = null
  private current: { id: string; ctxStart: number; offset: number } | null = null
  private token = 0
  private readonly getPlan: () => Clip[]
  private readonly onStop: () => void

  constructor(getPlan: () => Clip[], onStop: () => void) {
    this.getPlan = getPlan
    this.onStop = onStop
  }

  get playing() {
    return this.current !== null
  }

  /** Starts clip `id` at `at` seconds into its buffer (defaults to the clip start). */
  play(id: string, at?: number) {
    this.halt()
    const clip = this.getPlan().find((c) => c.id === id)
    if (!clip) return this.onStop()
    const ctx = getPlaybackContext()
    const token = ++this.token
    this.startClip(clip, Math.min(Math.max(at ?? clip.from, clip.from), clip.to), ctx.currentTime + 0.02, token)
  }

  stop() {
    if (!this.current) return
    this.halt()
    this.onStop()
  }

  position(): PlayPosition | null {
    if (!this.current) return null
    const ctx = getPlaybackContext()
    return { id: this.current.id, time: this.current.offset + (ctx.currentTime - this.current.ctxStart) }
  }

  private startClip(clip: Clip, at: number, when: number, token: number) {
    const ctx = getPlaybackContext()
    const src = ctx.createBufferSource()
    src.buffer = clip.buffer
    src.connect(ctx.destination)
    src.onended = () => {
      if (token === this.token) this.advance(clip.id, token)
    }
    const duration = Math.max(0, clip.to - at)
    src.start(when, at, duration)
    this.source = src
    // During the gap before this clip, position() runs "before" `from`.
    this.current = { id: clip.id, ctxStart: when, offset: at }
  }

  private advance(finishedId: string, token: number) {
    const plan = this.getPlan()
    const i = plan.findIndex((c) => c.id === finishedId)
    const next = i >= 0 ? plan[i + 1] : undefined
    if (!next) {
      this.halt()
      this.onStop()
      return
    }
    const ctx = getPlaybackContext()
    this.startClip(next, next.from, ctx.currentTime + plan[i].gapAfter, token)
  }

  private halt() {
    this.token++
    if (this.source) {
      this.source.onended = null
      try {
        this.source.stop()
      } catch {
        // already stopped
      }
      this.source.disconnect()
    }
    this.source = null
    this.current = null
  }
}
