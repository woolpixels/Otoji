import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { desktop, downloadFor, onDownloadsChange } from './desktop.ts'
import { useFrame, type ExportResult } from './hooks.ts'
import { describeChannels, describeRate } from './lib/audio.ts'
import { pickSaveTarget } from './lib/save.ts'
import { clamp, formatBytes, formatTime } from './lib/time.ts'
import { PlayButton } from './ui.tsx'

/**
 * Shown in place of the editor once an MP3 is written: what was made, where it went,
 * a listen to the actual encoded file, and the likely next steps.
 */
export function ExportDone(props: {
  result: ExportResult
  active: boolean
  /** The one vermilion button: start over with the next file(s). */
  nextLabel: string
  onNext: () => void
  onBack: () => void
  /** Tab-specific secondary actions (e.g. 送入拼接). */
  extra?: ReactNode
}) {
  const { result } = props
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [savedAgain, setSavedAgain] = useState<string | null>(null)
  // Mac app: where the download actually landed, for 在访达中显示.
  const landed = useSyncExternalStore(onDownloadsChange, () => (result.method === 'download' ? downloadFor(result.name) : null))

  useEffect(() => {
    const a = audio.current!
    const url = URL.createObjectURL(result.blob)
    a.src = url
    return () => {
      a.pause()
      a.removeAttribute('src')
      URL.revokeObjectURL(url)
    }
  }, [result.blob])

  useEffect(() => {
    if (!props.active) audio.current?.pause()
  }, [props.active])

  useFrame(playing, () => setTime(audio.current?.currentTime ?? 0))

  const toggle = () => {
    const a = audio.current
    if (!a) return
    if (a.paused) void a.play()
    else a.pause()
  }

  async function saveAgain() {
    const target = await pickSaveTarget(result.name)
    if (!target) return
    await target.write(result.blob)
    setSavedAgain(target.method === 'picker' ? `已另存为「${target.name}」` : `已再次下载「${target.name}」`)
  }

  const where =
    result.method === 'picker'
      ? '已保存到你选择的位置。'
      : landed?.ok && landed.name !== result.name
        ? `已存入「下载」文件夹，因重名保存为「${landed.name}」。`
        : '已存入「下载」文件夹。'

  return (
    <>
      <div className="workspace">
        <div className="done">
          <div className="done-mark" aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          </div>
          <h2 className="done-title">导出完成</h2>
          <div className="done-name" title={result.name}>{result.name}</div>
          <div className="done-meta mono">
            {formatTime(result.duration)} · {result.kbps} kbps · {formatBytes(result.blob.size)} · {describeRate(result.sampleRate)} {describeChannels(result.channels)}
          </div>
          <p className="note">{where}{savedAgain ? ` ${savedAgain}。` : ''}</p>

          <div className="done-player">
            <PlayButton playing={playing} onClick={toggle} />
            <div
              className="progress seek"
              role="slider"
              aria-label="试听导出结果"
              aria-valuemin={0}
              aria-valuemax={result.duration}
              aria-valuenow={time}
              onClick={(e) => {
                const a = audio.current
                if (!a || !a.duration) return
                const r = e.currentTarget.getBoundingClientRect()
                a.currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * a.duration
                setTime(a.currentTime)
              }}
            >
              <div style={{ width: `${result.duration ? clamp(time / result.duration, 0, 1) * 100 : 0}%` }} />
            </div>
            <span className="mono note">{formatTime(time)} / {formatTime(result.duration)}</span>
          </div>
          <div className="note">试听的就是刚刚写入的 MP3 文件。</div>
          {/* src is set from the blob in an effect */}
          <audio
            ref={audio}
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false)
              setTime(audio.current?.currentTime ?? 0)
            }}
            onEnded={() => {
              setPlaying(false)
              setTime(0)
            }}
          />
        </div>
      </div>

      <div className="bottombar">
        <button type="button" className="btn" onClick={props.onBack}>← 返回调整</button>
        {desktop && landed?.ok && (
          <button type="button" className="btn" onClick={() => void desktop?.reveal(landed.path)}>在访达中显示</button>
        )}
        <button type="button" className="btn" onClick={() => void saveAgain()}>另存一份…</button>
        {props.extra}
        <div className="spacer" />
        <button type="button" className="btn primary" onClick={props.onNext}>{props.nextLabel}</button>
      </div>
    </>
  )
}
