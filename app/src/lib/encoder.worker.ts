/// <reference lib="webworker" />
// MP3 encoding runs here so a long file never freezes the page. Audio arrives in
// pieces (and silences as frame counts), so the whole result never has to exist
// as one giant PCM buffer on the main thread.

import { Mp3Encoder } from '@breezystack/lamejs'
import { floatToInt16 } from './pcm.ts'
import type { EncoderReply, EncoderRequest } from './encoder.ts'

declare const self: DedicatedWorkerGlobalScope

const BLOCK = 1152 * 16

let encoder: Mp3Encoder | null = null
let channels = 2
let total = 0
let done = 0
let lastReport = 0
let parts: BlobPart[] = []
const left = new Int16Array(BLOCK)
const right = new Int16Array(BLOCK)

const post = (msg: EncoderReply) => self.postMessage(msg)

function report(force = false) {
  const now = performance.now()
  if (force || now - lastReport > 100) {
    lastReport = now
    post({ type: 'progress', done, total })
  }
}

function push(chunk: Uint8Array) {
  // lamejs reuses its output buffer between calls, so each chunk must be copied.
  if (chunk.length) parts.push(chunk.slice())
}

function encodePcm(data: Float32Array[]) {
  const l = data[0]
  const r = data[1] ?? data[0]
  for (let i = 0; i < l.length; i += BLOCK) {
    const n = Math.min(BLOCK, l.length - i)
    const lb = floatToInt16(l.subarray(i, i + n), left.subarray(0, n))
    if (channels === 2) push(encoder!.encodeBuffer(lb, floatToInt16(r.subarray(i, i + n), right.subarray(0, n))))
    else push(encoder!.encodeBuffer(lb))
    done += n
    report()
  }
}

function encodeSilence(frames: number) {
  const zeros = new Int16Array(BLOCK)
  for (let i = 0; i < frames; i += BLOCK) {
    const z = zeros.subarray(0, Math.min(BLOCK, frames - i))
    push(channels === 2 ? encoder!.encodeBuffer(z, z) : encoder!.encodeBuffer(z))
    done += z.length
    report()
  }
}

self.onmessage = (e: MessageEvent<EncoderRequest>) => {
  const msg = e.data
  try {
    switch (msg.type) {
      case 'start':
        channels = msg.channels
        total = msg.totalFrames
        done = 0
        parts = []
        encoder = new Mp3Encoder(msg.channels, msg.sampleRate, msg.kbps)
        break
      case 'pcm':
        encodePcm(msg.channels)
        break
      case 'silence':
        encodeSilence(msg.frames)
        break
      case 'end': {
        push(encoder!.flush())
        report(true)
        post({ type: 'done', blob: new Blob(parts, { type: 'audio/mpeg' }) })
        parts = []
        encoder = null
        break
      }
    }
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
