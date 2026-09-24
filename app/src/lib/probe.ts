// Reads just enough of a container to know what is inside before decoding:
// whether a video has an audio track, its codec, sample rate and channel count.
// decodeAudioData() resamples to its context's rate, so knowing the source rate
// up front is what lets us keep it unchanged.

export interface AudioInfo {
  /** false only when the container was understood and has no sound track. */
  hasAudio: boolean
  codec?: string
  sampleRate?: number
  channels?: number
  /** Seconds, from the container header. */
  duration?: number
}

const CODEC_NAMES: Record<string, string> = {
  'mp4a': 'AAC',
  '.mp3': 'MP3',
  'ac-3': 'AC-3',
  'ec-3': 'E-AC-3',
  'alac': 'ALAC',
  'Opus': 'Opus',
  'fLaC': 'FLAC',
  'lpcm': 'PCM',
  'sowt': 'PCM',
  'twos': 'PCM',
  'in24': 'PCM',
  'in32': 'PCM',
  'fl32': 'PCM',
  'fl64': 'PCM',
  'raw ': 'PCM',
  'ulaw': 'μ-law',
  'alaw': 'A-law',
  'ima4': 'IMA ADPCM',
}

const fourcc = (v: DataView, at: number) =>
  String.fromCharCode(v.getUint8(at), v.getUint8(at + 1), v.getUint8(at + 2), v.getUint8(at + 3))

async function readBytes(blob: Blob, start: number, end: number): Promise<DataView> {
  return new DataView(await blob.slice(start, Math.min(end, blob.size)).arrayBuffer())
}

export async function probe(blob: Blob): Promise<AudioInfo | null> {
  const head = await readBytes(blob, 0, 12)
  if (head.byteLength < 12) return null
  if (fourcc(head, 4) === 'ftyp' || ['moov', 'mdat', 'wide', 'free', 'skip'].includes(fourcc(head, 4))) {
    return probeMp4(blob)
  }
  if (fourcc(head, 0) === 'RIFF' && fourcc(head, 8) === 'WAVE') return probeWav(blob)
  return probeMp3(blob)
}

// ── MP4 / MOV (ISO base media & QuickTime) ─────────────────────────────────

interface Box { type: string; start: number; body: number; end: number }

/** Walks top-level boxes via small reads, so a multi-GB mdat is never loaded. */
async function findTopLevel(blob: Blob, type: string): Promise<Box | null> {
  let pos = 0
  while (pos + 8 <= blob.size) {
    const h = await readBytes(blob, pos, pos + 16)
    let size = h.getUint32(0)
    const t = fourcc(h, 4)
    let header = 8
    if (size === 1) {
      if (h.byteLength < 16) return null
      size = Number(h.getBigUint64(8))
      header = 16
    } else if (size === 0) {
      size = blob.size - pos
    }
    if (size < header) return null
    if (t === type) return { type: t, start: pos, body: pos + header, end: pos + size }
    pos += size
  }
  return null
}

function* children(v: DataView, from: number, to: number): Generator<Box> {
  let pos = from
  while (pos + 8 <= to) {
    let size = v.getUint32(pos)
    let header = 8
    if (size === 1) {
      size = Number(v.getBigUint64(pos + 8))
      header = 16
    } else if (size === 0) {
      size = to - pos
    }
    if (size < header || pos + size > to) return
    yield { type: fourcc(v, pos + 4), start: pos, body: pos + header, end: pos + size }
    pos += size
  }
}

const child = (v: DataView, parent: Box, type: string) => {
  for (const b of children(v, parent.body, parent.end)) if (b.type === type) return b
  return null
}

/** mvhd / mdhd: version 0 has 32-bit times, version 1 has 64-bit. */
function readHeaderDuration(v: DataView, box: Box): { timescale: number; duration: number } {
  const version = v.getUint8(box.body)
  if (version === 1) {
    return { timescale: v.getUint32(box.body + 20), duration: Number(v.getBigUint64(box.body + 24)) }
  }
  return { timescale: v.getUint32(box.body + 12), duration: v.getUint32(box.body + 16) }
}

async function probeMp4(blob: Blob): Promise<AudioInfo | null> {
  const moovBox = await findTopLevel(blob, 'moov')
  if (!moovBox) return null
  // moov is metadata only; 64 MB is far beyond any real one and guards against junk sizes.
  if (moovBox.end - moovBox.start > 64 * 1024 * 1024) return null
  const v = await readBytes(blob, moovBox.start, moovBox.end)
  const moov: Box = { type: 'moov', start: 0, body: moovBox.body - moovBox.start, end: moovBox.end - moovBox.start }

  let duration: number | undefined
  const mvhd = child(v, moov, 'mvhd')
  if (mvhd) {
    const { timescale, duration: d } = readHeaderDuration(v, mvhd)
    if (timescale > 0) duration = d / timescale
  }

  for (const trak of children(v, moov.body, moov.end)) {
    if (trak.type !== 'trak') continue
    const mdia = child(v, trak, 'mdia')
    const hdlr = mdia && child(v, mdia, 'hdlr')
    if (!mdia || !hdlr || fourcc(v, hdlr.body + 8) !== 'soun') continue

    const info: AudioInfo = { hasAudio: true, duration }
    const mdhd = child(v, mdia, 'mdhd')
    if (mdhd) {
      const { timescale, duration: d } = readHeaderDuration(v, mdhd)
      if (timescale > 0) {
        info.sampleRate = timescale
        if (d > 0) info.duration = d / timescale
      }
    }
    const minf = child(v, mdia, 'minf')
    const stbl = minf && child(v, minf, 'stbl')
    const stsd = stbl && child(v, stbl, 'stsd')
    if (stsd && stsd.body + 8 + 36 <= stsd.end) {
      const e = stsd.body + 8 // version/flags + entry_count
      const type = fourcc(v, e + 4)
      info.codec = CODEC_NAMES[type] ?? type.trim().toUpperCase()
      const soundVersion = v.getUint16(e + 16)
      if (soundVersion === 2 && e + 52 <= stsd.end) {
        info.sampleRate = Math.round(v.getFloat64(e + 40))
        info.channels = v.getUint32(e + 48)
      } else {
        info.channels = v.getUint16(e + 24)
        const rate = v.getUint32(e + 32) >>> 16
        // The 16.16 field overflows above 65535 Hz; mdhd's timescale is the better source then.
        if (rate > 0 && !(info.sampleRate && info.sampleRate > 65535)) info.sampleRate = rate
      }
    }
    return info
  }
  return { hasAudio: false, duration }
}

// ── WAV ────────────────────────────────────────────────────────────────────

async function probeWav(blob: Blob): Promise<AudioInfo | null> {
  const v = await readBytes(blob, 0, 4096)
  for (let pos = 12; pos + 8 <= v.byteLength;) {
    const id = fourcc(v, pos)
    const size = v.getUint32(pos + 4, true)
    if (id === 'fmt ' && pos + 16 <= v.byteLength) {
      return { hasAudio: true, codec: 'PCM', channels: v.getUint16(pos + 10, true), sampleRate: v.getUint32(pos + 12, true) }
    }
    pos += 8 + size + (size & 1)
  }
  return null
}

// ── MP3 ────────────────────────────────────────────────────────────────────

const MP3_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], //  MPEG-2.5
}

async function probeMp3(blob: Blob): Promise<AudioInfo | null> {
  let offset = 0
  const id3 = await readBytes(blob, 0, 10)
  if (id3.byteLength === 10 && fourcc(id3, 0).startsWith('ID3')) {
    const size = ((id3.getUint8(6) & 0x7f) << 21) | ((id3.getUint8(7) & 0x7f) << 14) | ((id3.getUint8(8) & 0x7f) << 7) | (id3.getUint8(9) & 0x7f)
    offset = 10 + size + (id3.getUint8(5) & 0x10 ? 10 : 0)
  }
  const v = await readBytes(blob, offset, offset + 64 * 1024)
  for (let i = 0; i + 4 <= v.byteLength; i++) {
    if (v.getUint8(i) !== 0xff || (v.getUint8(i + 1) & 0xe0) !== 0xe0) continue
    const b1 = v.getUint8(i + 1)
    const b2 = v.getUint8(i + 2)
    const version = (b1 >> 3) & 3
    const layer = (b1 >> 1) & 3
    const bitrate = b2 >> 4
    const rateIndex = (b2 >> 2) & 3
    if (version === 1 || layer === 0 || bitrate === 0xf || bitrate === 0 || rateIndex === 3) continue
    const mono = (v.getUint8(i + 3) >> 6) === 3
    return { hasAudio: true, codec: layer === 1 ? 'MP3' : `MPEG Layer ${4 - layer}`, sampleRate: MP3_RATES[version][rateIndex], channels: mono ? 1 : 2 }
  }
  return null
}
