// Decoding fallback for tracks the browser cannot read natively. ffmpeg.wasm is
// ~30 MB, so this module is only imported on demand and never enters the main bundle.
// Its files ship with the app, so the fallback also works offline.

import { FFmpeg } from '@ffmpeg/ffmpeg'
import coreURL from '@ffmpeg/core?url'
import wasmURL from '@ffmpeg/core/wasm?url'
import { NoAudioError } from './audio.ts'
import { extension } from './names.ts'

let loading: Promise<FFmpeg> | null = null

function load(): Promise<FFmpeg> {
  loading ??= (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({ coreURL: new URL(coreURL, location.href).href, wasmURL: new URL(wasmURL, location.href).href })
    return ffmpeg
  })().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

/** Extracts the first audio track as 16-bit WAV, keeping rate and channel count. */
export async function decodeWithFfmpeg(file: File): Promise<ArrayBuffer> {
  const ffmpeg = await load()
  const input = `input.${extension(file.name) || 'bin'}`
  const output = 'output.wav'
  const logs: string[] = []
  const onLog = ({ message }: { message: string }) => logs.push(message)
  ffmpeg.on('log', onLog)
  try {
    await ffmpeg.writeFile(input, new Uint8Array(await file.arrayBuffer()))
    const code = await ffmpeg.exec(['-i', input, '-vn', '-map', '0:a:0', '-c:a', 'pcm_s16le', output])
    if (code !== 0) {
      if (logs.some((l) => /matches no streams|does not contain any stream/i.test(l))) throw new NoAudioError('没有音轨')
      throw new Error(logs.slice(-3).join('\n'))
    }
    const data = (await ffmpeg.readFile(output)) as Uint8Array
    return data.slice().buffer
  } finally {
    ffmpeg.off('log', onLog)
    await ffmpeg.deleteFile(input).catch(() => {})
    await ffmpeg.deleteFile(output).catch(() => {})
  }
}
