import { useEffect, useRef, useState } from 'react'
import { channelData, conform, decodeMedia, describeChannels, describeRate, NoAudioError, sliceBuffer } from '../lib/audio.ts'
import { baseName, isVideoFile, VIDEO_ACCEPT } from '../lib/names.ts'
import { computePeaks, encodableRate, LONG_AUDIO_SECONDS } from '../lib/pcm.ts'
import { SequencePlayer, type Clip } from '../lib/player.ts'
import { probe, type AudioInfo } from '../lib/probe.ts'
import { estimateMp3Bytes, formatBytes, formatDuration, formatTime, rangeTag } from '../lib/time.ts'
import { isTyping, openFilePicker, QUALITIES, useExport, useFileDrop, useFrame, useLatest, type Quality } from '../hooks.ts'
import { ExportStatus, PlayButton, Segmented, TimeInput, WaveIcon } from '../ui.tsx'
import { ExportDone } from '../ExportDone.tsx'
import { Waveform } from './Waveform.tsx'

const PREROLL = 2
/**
 * Short-video platforms usually end with a few seconds of end card, so a new video's
 * selection stops 3 s before the end. Clips too short for that are left whole.
 */
const DEFAULT_TAIL_TRIM = 3
const defaultEnd = (duration: number) => (duration - DEFAULT_TAIL_TRIM >= 1 ? duration - DEFAULT_TAIL_TRIM : duration)

interface Loaded {
  file: File
  info: AudioInfo | null
  buffer: AudioBuffer
  peaks: Float32Array
  viaFfmpeg: boolean
}

export interface SentAudio {
  name: string
  buffer: AudioBuffer
}

export function ExtractTab(props: {
  active: boolean
  /** Files handed over by the start page; seq distinguishes repeated hand-overs. */
  incoming: { seq: number; files: File[] } | null
  onSendToMerge: (audio: SentAudio) => void
  /** Reports the loaded file's name (or null) so the start page can offer to continue. */
  onProgress: (label: string | null) => void
  /** Whether the editor is showing, so the top bar can show its shortcut hints. */
  onEditing: (editing: boolean) => void
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [loading, setLoading] = useState<{ name: string; fallback: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [cursor, setCursor] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [quality, setQuality] = useState<Quality>(192)
  const exp = useExport()
  const loadToken = useRef(0)

  const duration = loaded?.buffer.duration ?? 0
  const invalid = start >= end
  const plan = useLatest<Clip[]>(loaded ? [{ id: 'sel', buffer: loaded.buffer, from: start, to: end, gapAfter: 0 }] : [])
  const pausing = useRef(false)
  const startRef = useLatest(start)

  const [player] = useState(
    // The callbacks read the refs when a clip ends, never during render.
    // oxlint-disable-next-line react/refs
    () =>
      new SequencePlayer(
        () => plan.current,
        () => {
          setPlaying(false)
          // Played through to the end: the next play starts over from the selection start.
          if (!pausing.current) setCursor(startRef.current)
          pausing.current = false
        },
      ),
  )

  useEffect(() => () => player.stop(), [player])
  const actions = useLatest({ play: (at: number) => play(at), pause: () => pause() })
  useEffect(() => {
    if (!props.active) actions.current.pause()
  }, [props.active, actions])

  useFrame(playing, () => {
    const p = player.position()
    if (p) setPosition(Math.max(start, p.time))
  })

  const playhead = playing ? position : cursor

  function play(at: number) {
    if (!loaded || invalid) return
    const from = at >= start && at < end - 0.05 ? at : start
    setPosition(from)
    player.play('sel', from)
    setPlaying(true)
  }

  function pause() {
    if (!player.playing) return
    const p = player.position()
    pausing.current = true
    player.stop()
    if (p) setCursor(Math.max(start, Math.min(end, p.time)))
  }

  const togglePlay = () => (player.playing ? pause() : play(cursor))

  async function load(files: File[]) {
    const file = files[0]
    setError(null)
    setNotice(files.length > 1 ? '一次处理一个视频，已打开第一个。' : null)
    if (!isVideoFile(file)) {
      setError(`「${file.name}」不是 MP4 / MOV 视频。`)
      return
    }
    player.stop()
    const token = ++loadToken.current
    setLoading({ name: file.name, fallback: false })
    try {
      const info = await probe(file).catch(() => null)
      let viaFfmpeg = false
      const buffer = await decodeMedia(file, info, () => {
        viaFfmpeg = true
        if (token === loadToken.current) setLoading({ name: file.name, fallback: true })
      })
      if (token !== loadToken.current) return
      const peaks = computePeaks(channelData(buffer), 4000)
      setLoaded({ file, info, buffer, peaks, viaFfmpeg })
      setStart(0)
      setEnd(defaultEnd(buffer.duration))
      setCursor(0)
      setPosition(0)
    } catch (err) {
      if (token !== loadToken.current) return
      setError(
        err instanceof NoAudioError
          ? `「${file.name}」没有音轨，无法提取声音。`
          : `无法读取「${file.name}」的音轨。文件可能已损坏，或使用了不支持的编码。`,
      )
    } finally {
      if (token === loadToken.current) setLoading(null)
    }
  }

  const drop = useFileDrop(load)
  const pick = () => openFilePicker(VIDEO_ACCEPT, false, load)

  const trimmed = loaded ? start > 0.05 || end < duration - 0.05 : false
  const isDefaultRange = start <= 0.05 && Math.abs(end - defaultEnd(duration)) <= 0.05
  // The default tail cut still counts as "the whole video" for naming.
  const outputName = loaded ? `${baseName(loaded.file.name)}${trimmed && !isDefaultRange ? `_${rangeTag(start, end)}` : ''}` : ''

  function doExport() {
    if (!loaded || invalid || exp.busy) return
    pause()
    const { buffer } = loaded
    const rate = encodableRate(buffer.sampleRate)
    const channels = Math.min(2, buffer.numberOfChannels) as 1 | 2
    void exp.run(`${outputName}.mp3`, end - start, async () => {
      if (rate === buffer.sampleRate && channels === buffer.numberOfChannels) {
        return { sampleRate: rate, channels, kbps: quality, pieces: [{ buffer, from: start, to: end }] }
      }
      // 5.1 → stereo or > 48 kHz: only the selection is converted.
      const part = await conform(sliceBuffer(buffer, start, end), rate, channels)
      return { sampleRate: rate, channels, kbps: quality, pieces: [{ buffer: part }] }
    })
  }

  function sendToMerge() {
    if (!loaded || invalid) return
    pause()
    props.onSendToMerge({ name: outputName, buffer: trimmed ? sliceBuffer(loaded.buffer, start, end) : loaded.buffer })
  }

  const loadRef = useLatest(load)
  const incomingSeq = useRef(0)
  useEffect(() => {
    const inc = props.incoming
    if (!inc || inc.seq === incomingSeq.current) return
    incomingSeq.current = inc.seq
    exp.reset()
    void loadRef.current(inc.files)
  }, [props.incoming, exp, loadRef])

  const { onProgress } = props
  const loadedName = loaded?.file.name ?? null
  useEffect(() => onProgress(loadedName), [loadedName, onProgress])

  /** Back to the empty drop zone, for the next video. */
  function reset() {
    player.stop()
    loadToken.current++
    setLoaded(null)
    setLoading(null)
    setError(null)
    setNotice(null)
    exp.reset()
  }

  const finished = exp.state.kind === 'done' ? exp.state.result : null
  const editing = !!loaded && !loading && !finished
  const { onEditing } = props
  useEffect(() => onEditing(editing), [editing, onEditing])

  // Shortcuts: space, I / O, ⌘S — only while the editor of this tab is showing.
  const keys = useLatest({ togglePlay, doExport, playhead, loaded, start, end, duration, invalid })
  useEffect(() => {
    if (!props.active || finished) return
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        k.doExport()
        return
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || !k.loaded) return
      if (e.key === ' ') {
        e.preventDefault()
        k.togglePlay()
      } else if (e.key === 'i' || e.key === 'I') {
        setStart(Math.min(k.playhead, k.duration))
      } else if (e.key === 'o' || e.key === 'O') {
        setEnd(Math.min(k.playhead, k.duration))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, keys, finished])

  const info = loaded?.info
  const meta = loaded
    ? [
        formatDuration(duration),
        [info?.codec, describeRate(info?.sampleRate ?? loaded.buffer.sampleRate), describeChannels(info?.channels ?? loaded.buffer.numberOfChannels)]
          .filter(Boolean)
          .join(' '),
        loaded.viaFfmpeg ? '音轨已提取（备用解码器）' : '音轨已提取',
      ].join(' · ')
    : ''

  const selection = Math.max(0, end - start)
  /** How much is cut off the original ending. */
  const tailCut = Math.max(0, duration - end)

  if (finished) {
    return (
      <div className="tab-panel" hidden={!props.active}>
        <ExportDone
          result={finished}
          active={props.active}
          nextLabel="处理下一个视频"
          onNext={() => {
            reset()
            pick()
          }}
          onBack={exp.reset}
          extra={
            <button type="button" className="btn" onClick={sendToMerge} title="把这段声音加到「拼接音频」列表末尾">
              送入拼接
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="tab-panel" hidden={!props.active} {...drop.handlers}>
      <div className="workspace">
        {!loaded || loading ? (
          <div
            className={`dropzone ${drop.over ? 'over' : ''} ${loading ? 'busy' : ''}`}
            role="button"
            tabIndex={0}
            onClick={loading ? undefined : pick}
            onKeyDown={(e) => {
              if (!loading && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault()
                pick()
              }
            }}
          >
            {loading ? (
              <>
                <div className="title">正在提取音轨…</div>
                <div className="note">
                  {loading.fallback ? '浏览器无法直接解码这个音轨，正在使用备用解码器，可能需要一会儿。' : loading.name}
                </div>
              </>
            ) : (
              <>
                <div className="title">拖入视频文件，或点击选择</div>
                <div className="note">MP4 · MOV · 仅在本地处理</div>
                {error && <div className="error">{error}</div>}
              </>
            )}
          </div>
        ) : (
          <>
            <div className="file-head">
              <div className="file-icon"><WaveIcon /></div>
              <div>
                <div className="file-name" title={loaded.file.name}>{loaded.file.name}</div>
                <div className="file-meta">{meta}</div>
              </div>
              <div className="spacer" />
              <button type="button" className="btn small" onClick={pick}>更换文件</button>
            </div>
            {error && <div className="banner error">{error}</div>}
            {notice && <div className="banner">{notice}</div>}
            {duration > LONG_AUDIO_SECONDS && (
              <div className="banner">音频较长（{Math.round(duration / 60)} 分钟），导出时会占用较多内存，请耐心等待。</div>
            )}
            <Waveform
              peaks={loaded.peaks}
              duration={duration}
              start={start}
              end={end}
              playhead={playhead}
              onRange={(s, e) => {
                setStart(s)
                setEnd(e)
                if (!player.playing) setCursor(s)
              }}
              onHandleRelease={(handle, t) => {
                // Play the selection from 2 s before where the handle was dropped.
                const at = handle === 'end' ? Math.max(start, t - PREROLL) : start
                if (handle === 'end') setEnd(t)
                else setStart(t)
                requestAnimationFrame(() => actions.current.play(at))
              }}
              onSeek={(t) => {
                setCursor(t)
                if (player.playing) play(t)
              }}
            />
            <div className="transport">
              <PlayButton playing={playing} onClick={togglePlay} disabled={invalid} />
              <span className="clock mono">
                {formatTime(Math.max(0, Math.min(selection, playhead - start)))} / {formatTime(selection)}
              </span>
              <div className="spacer" />
              <label>
                开始
                <TimeInput label="开始时间" value={start} max={duration} invalid={invalid} onCommit={(v) => { setStart(v); if (!playing) setCursor(v) }} />
              </label>
              <label>
                结束
                <span className="time-field">
                  <TimeInput label="结束时间" value={end} max={duration} invalid={invalid} cut={tailCut > 0.05} onCommit={setEnd} />
                  {tailCut > 0.05 && (
                    <span className="time-cut mono" title="相较原视频结尾裁掉的时长">−{formatTime(tailCut)}</span>
                  )}
                </span>
              </label>
            </div>
            {invalid && <div className="status error">开始时间需早于结束时间</div>}
          </>
        )}
      </div>

      <div className="bottombar">
        {exp.state.kind === 'idle' ? (
          <>
            <span className="note">音质</span>
            <Segmented label="音质" mono options={QUALITIES} value={quality} onChange={setQuality} disabled={!loaded} />
            <span className="note">
              kbps{loaded && !invalid ? ` · 预计 ${formatBytes(estimateMp3Bytes(quality, selection))}` : ''}
            </span>
          </>
        ) : (
          <ExportStatus exp={exp} />
        )}
        <div className="spacer" />
        {loaded && (
          <button type="button" className="btn" onClick={sendToMerge} disabled={invalid || exp.busy} title="把当前选区加到「拼接音频」列表末尾">
            送入拼接
          </button>
        )}
        <button type="button" className="btn primary" onClick={doExport} disabled={!loaded || invalid || exp.busy || !!loading}>
          导出 MP3
        </button>
      </div>
    </div>
  )
}
