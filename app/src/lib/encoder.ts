// Main-thread side of the MP3 encoder worker.

export type EncoderRequest =
  | { type: 'start'; sampleRate: number; channels: number; kbps: number; totalFrames: number }
  | { type: 'pcm'; channels: Float32Array[] }
  | { type: 'silence'; frames: number }
  | { type: 'end' }

export type EncoderReply =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; blob: Blob }
  | { type: 'error'; message: string }

/** One piece of the output: a slice of an AudioBuffer, or silence. */
export type EncodePiece =
  | { buffer: AudioBuffer; from?: number; to?: number }
  | { silence: number }

export interface EncodeJob {
  sampleRate: number
  channels: 1 | 2
  kbps: number
  /** Buffers must already be at the job's sample rate and channel count. */
  pieces: EncodePiece[]
  onProgress?: (fraction: number) => void
  signal?: AbortSignal
}

// Posting a few seconds at a time keeps each copy small.
const POST_SECONDS = 10

export function encodeMp3(job: EncodeJob): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (job.signal?.aborted) return reject(new DOMException('已取消', 'AbortError'))
    const worker = new Worker(new URL('./encoder.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => {
      worker.terminate()
      job.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      finish()
      reject(new DOMException('已取消', 'AbortError'))
    }
    job.signal?.addEventListener('abort', onAbort)

    worker.onmessage = (e: MessageEvent<EncoderReply>) => {
      const msg = e.data
      if (msg.type === 'progress') job.onProgress?.(msg.total ? msg.done / msg.total : 0)
      else if (msg.type === 'done') {
        finish()
        resolve(msg.blob)
      } else {
        finish()
        reject(new Error(msg.message))
      }
    }
    worker.onerror = (e) => {
      finish()
      reject(new Error(e.message || '编码器出错'))
    }

    const send = (msg: EncoderRequest, transfer: Transferable[] = []) => worker.postMessage(msg, transfer)

    const rate = job.sampleRate
    const totalFrames = job.pieces.reduce((sum, p) => {
      if ('silence' in p) return sum + Math.round(p.silence * rate)
      const from = Math.round((p.from ?? 0) * rate)
      const to = p.to === undefined ? p.buffer.length : Math.round(p.to * rate)
      return sum + Math.max(0, Math.min(to, p.buffer.length) - from)
    }, 0)
    send({ type: 'start', sampleRate: rate, channels: job.channels, kbps: job.kbps, totalFrames })

    for (const p of job.pieces) {
      if ('silence' in p) {
        const frames = Math.round(p.silence * rate)
        if (frames > 0) send({ type: 'silence', frames })
        continue
      }
      const from = Math.round((p.from ?? 0) * rate)
      const to = Math.min(p.buffer.length, p.to === undefined ? p.buffer.length : Math.round(p.to * rate))
      const step = POST_SECONDS * rate
      for (let i = from; i < to; i += step) {
        const end = Math.min(to, i + step)
        const data: Float32Array[] = []
        for (let c = 0; c < job.channels; c++) data.push(p.buffer.getChannelData(Math.min(c, p.buffer.numberOfChannels - 1)).slice(i, end))
        send({ type: 'pcm', channels: data }, data.map((d) => d.buffer))
      }
    }
    send({ type: 'end' })
  })
}
