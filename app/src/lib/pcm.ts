// Pure PCM helpers (no Web Audio), shared by the UI, the encoder worker and tests.

/** Uncompressed PCM gets heavy past this (≈ 21 MB per minute of 16-bit stereo); warn the user. */
export const LONG_AUDIO_SECONDS = 30 * 60

/** min/max pairs per bucket for drawing a waveform; channels are merged. */
export function computePeaks(channels: Float32Array[], buckets: number): Float32Array {
  const length = channels[0]?.length ?? 0
  const out = new Float32Array(buckets * 2)
  if (!length || buckets <= 0) return out
  const per = length / buckets
  // Sampling every sample of a long file is wasteful; ~2000 reads per bucket is plenty.
  const stride = Math.max(1, Math.floor(per / 2000))
  for (let b = 0; b < buckets; b++) {
    const from = Math.floor(b * per)
    const to = Math.min(length, Math.max(from + 1, Math.floor((b + 1) * per)))
    let lo = 0
    let hi = 0
    for (const ch of channels) {
      for (let i = from; i < to; i += stride) {
        const s = ch[i]
        if (s < lo) lo = s
        else if (s > hi) hi = s
      }
    }
    out[b * 2] = lo
    out[b * 2 + 1] = hi
  }
  return out
}

export function floatToInt16(src: Float32Array, dst: Int16Array = new Int16Array(src.length)): Int16Array {
  for (let i = 0; i < src.length; i++) {
    const s = src[i]
    dst[i] = s >= 1 ? 0x7fff : s <= -1 ? -0x8000 : s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return dst
}

export interface Segment {
  /** Seconds of audio. */
  duration: number
  /** Silence after this segment, seconds; ignored for the last one. */
  gapAfter: number
}

/** Timeline start of each segment and the overall length (no silence at the ends). */
export function layout(segments: Segment[]): { starts: number[]; total: number; gapTotal: number } {
  const starts: number[] = []
  let t = 0
  let gapTotal = 0
  segments.forEach((s, i) => {
    starts.push(t)
    t += s.duration
    if (i < segments.length - 1) {
      t += s.gapAfter
      gapTotal += s.gapAfter
    }
  })
  return { starts, total: t, gapTotal }
}

/** Target format for a merge: the highest rate (as far as MP3 allows) and at most stereo. */
export function mergeTarget(inputs: { sampleRate: number; channels: number }[]) {
  const sampleRate = encodableRate(Math.max(...inputs.map((i) => i.sampleRate)))
  const channels = Math.min(2, Math.max(...inputs.map((i) => i.channels)))
  return { sampleRate, channels }
}

/** Nearest rate MP3 supports at or below the given one (96 kHz → 48 kHz). */
export function encodableRate(rate: number): number {
  const rates = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000]
  return rates.filter((r) => r <= rate).at(-1) ?? 8000
}
