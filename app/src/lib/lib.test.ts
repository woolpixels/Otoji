import assert from 'node:assert/strict'
import { test } from 'node:test'
import { naturalCompare } from './names.ts'
import { computePeaks, encodableRate, floatToInt16, layout, mergeTarget } from './pcm.ts'
import { probe } from './probe.ts'
import { estimateMp3Bytes, formatDuration, formatTime, parseTime, rangeTag } from './time.ts'

test('formatTime / formatDuration', () => {
  assert.equal(formatTime(72), '01:12.0')
  assert.equal(formatTime(267.46), '04:27.5')
  assert.equal(formatTime(59.96), '01:00.0')
  assert.equal(formatTime(3725.5), '1:02:05.5')
  assert.equal(formatDuration(375.2), '06:15')
})

test('parseTime accepts mm:ss.s, seconds and IME punctuation', () => {
  assert.equal(parseTime('01:12.0'), 72)
  assert.equal(parseTime('72.5'), 72.5)
  assert.equal(parseTime('1:02:05.5'), 3725.5)
  assert.equal(parseTime('01：12。5'), 72.5)
  assert.equal(parseTime(' 4:27.5 '), 267.5)
  assert.equal(parseTime('abc'), null)
  assert.equal(parseTime('1:2:3:4'), null)
  assert.equal(parseTime(''), null)
})

test('rangeTag matches the design example', () => {
  assert.equal(rangeTag(72, 267.5), '0112-0427')
})

test('natural sort puts 2 before 10', () => {
  const names = ['track10.mp3', 'track2.mp3', 'track1.mp3']
  assert.deepEqual(names.sort(naturalCompare), ['track1.mp3', 'track2.mp3', 'track10.mp3'])
})

test('layout: no silence at the ends', () => {
  const r = layout([
    { duration: 12.5, gapAfter: 0.5 },
    { duration: 271, gapAfter: 1 },
    { duration: 302, gapAfter: 0.5 },
    { duration: 19.5, gapAfter: 0.5 },
  ])
  assert.deepEqual(r.starts, [0, 13, 285, 587.5])
  assert.equal(r.total, 607)
  assert.equal(r.gapTotal, 2)
})

test('merge target: highest rate MP3 allows, at most stereo', () => {
  assert.deepEqual(mergeTarget([{ sampleRate: 44100, channels: 1 }, { sampleRate: 48000, channels: 2 }]), { sampleRate: 48000, channels: 2 })
  assert.deepEqual(mergeTarget([{ sampleRate: 96000, channels: 6 }]), { sampleRate: 48000, channels: 2 })
  assert.equal(encodableRate(44100), 44100)
  assert.equal(encodableRate(88200), 48000)
})

test('floatToInt16 clips and scales', () => {
  assert.deepEqual(Array.from(floatToInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))), [0, 32767, -32768, 32767, -32768, 16383])
})

test('computePeaks gives min/max per bucket', () => {
  const peaks = computePeaks([new Float32Array([0.1, -0.5, 0.9, -0.2])], 2)
  assert.deepEqual(Array.from(peaks).map((v) => Math.round(v * 10) / 10), [-0.5, 0.1, -0.2, 0.9])
  assert.equal(estimateMp3Bytes(192, 10), 240000)
})

// ── probe ──────────────────────────────────────────────────────────────────

function box(type: string, ...parts: Uint8Array[]): Uint8Array {
  const size = 8 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(size)
  new DataView(out.buffer).setUint32(0, size)
  out.set(new TextEncoder().encode(type), 4)
  let o = 8
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

function bytes(fn: (v: DataView) => void, length: number) {
  const out = new Uint8Array(length)
  fn(new DataView(out.buffer))
  return out
}

function mp4(withAudio: boolean) {
  const mvhd = box('mvhd', bytes((v) => { v.setUint32(12, 1000); v.setUint32(16, 375_000) }, 100))
  const hdlr = (kind: string) => box('hdlr', bytes((v) => new TextEncoder().encode(kind).forEach((c, i) => v.setUint8(8 + i, c)), 24))
  const mdhd = box('mdhd', bytes((v) => { v.setUint32(12, 48000); v.setUint32(16, 48000 * 375) }, 24))
  const entry = box('mp4a', bytes((v) => { v.setUint16(16 - 8, 0); v.setUint16(24 - 8, 2); v.setUint32(32 - 8, 48000 << 16 >>> 0) }, 28))
  const stsd = box('stsd', bytes((v) => v.setUint32(4, 1), 8), entry)
  const soundTrak = box('trak', box('mdia', mdhd, hdlr('soun'), box('minf', box('stbl', stsd))))
  const videoTrak = box('trak', box('mdia', hdlr('vide')))
  const moov = box('moov', mvhd, videoTrak, ...(withAudio ? [soundTrak] : []))
  return new Blob([box('ftyp', new TextEncoder().encode('isom')), box('mdat', new Uint8Array(64)), moov])
}

test('probe reads the audio track of an MP4 even when moov comes last', async () => {
  const info = await probe(mp4(true))
  assert.deepEqual(info, { hasAudio: true, duration: 375, codec: 'AAC', sampleRate: 48000, channels: 2 })
})

test('probe reports a video without a sound track', async () => {
  assert.deepEqual(await probe(mp4(false)), { hasAudio: false, duration: 375 })
})

test('probe reads an MP3 frame header after ID3', async () => {
  const id3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 5, 0, 0, 0, 0, 0])
  const frame = new Uint8Array([0xff, 0xfb, 0x90, 0xc0]) // MPEG-1 L3, 128 kbps, 44.1 kHz, mono
  const info = await probe(new Blob([id3, frame, new Uint8Array(100)]))
  assert.deepEqual(info, { hasAudio: true, codec: 'MP3', sampleRate: 44100, channels: 1 })
})
