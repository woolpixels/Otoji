// Web Audio plumbing: decoding, format conversion and slicing of AudioBuffers.

import type { AudioInfo } from './probe.ts'

let playbackContext: AudioContext | null = null

/** One AudioContext for all previews; it resamples each buffer on playback. */
export function getPlaybackContext(): AudioContext {
  playbackContext ??= new AudioContext({ latencyHint: 'interactive' })
  if (playbackContext.state === 'suspended') void playbackContext.resume()
  return playbackContext
}

/** Used when the container does not say; decodeAudioData will resample to it. */
const FALLBACK_RATE = 48000

export class NoAudioError extends Error {}
export class DecodeError extends Error {}

/**
 * Decodes the audio of a media file at its own sample rate (decodeAudioData
 * resamples to the context's rate, so the context is created at the source rate).
 * Falls back to ffmpeg.wasm, loaded only when the browser cannot decode the track.
 */
export async function decodeMedia(file: File, info: AudioInfo | null, onFallback?: () => void): Promise<AudioBuffer> {
  if (info && !info.hasAudio) throw new NoAudioError('没有音轨')
  const rate = info?.sampleRate && info.sampleRate >= 8000 && info.sampleRate <= 384000 ? info.sampleRate : FALLBACK_RATE
  try {
    return await decodeBytes(await file.arrayBuffer(), rate)
  } catch {
    onFallback?.()
    const { decodeWithFfmpeg } = await import('./ffmpeg.ts')
    let wav: ArrayBuffer
    try {
      wav = await decodeWithFfmpeg(file)
    } catch (err) {
      if (err instanceof NoAudioError) throw err
      throw new DecodeError('无法解码')
    }
    return decodeBytes(wav, rate)
  }
}

function decodeBytes(bytes: ArrayBuffer, rate: number): Promise<AudioBuffer> {
  return new OfflineAudioContext(1, 1, rate).decodeAudioData(bytes)
}

/** Resamples and/or remixes (mono → stereo copies, 5.1 → stereo downmixes). */
export async function conform(buffer: AudioBuffer, sampleRate: number, channels: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === channels) return buffer
  const length = Math.ceil(buffer.duration * sampleRate)
  const ctx = new OfflineAudioContext(channels, Math.max(1, length), sampleRate)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

/** Copies seconds [from, to) into a new AudioBuffer. */
export function sliceBuffer(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const start = Math.max(0, Math.round(from * buffer.sampleRate))
  const end = Math.min(buffer.length, Math.round(to * buffer.sampleRate))
  const out = new AudioBuffer({ length: Math.max(1, end - start), numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate })
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(start, end), c)
  return out
}

export function channelData(buffer: AudioBuffer): Float32Array[] {
  return Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
}

export function describeChannels(n: number): string {
  if (n === 1) return '单声道'
  if (n === 2) return '立体声'
  if (n === 6) return '5.1 声道'
  return `${n} 声道`
}

export function describeRate(rate: number): string {
  return `${Number((rate / 1000).toFixed(1))} kHz`
}
