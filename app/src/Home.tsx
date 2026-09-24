import { useState } from 'react'
import { openFilePicker, useFileDrop } from './hooks.ts'
import { AUDIO_ACCEPT, isAudioFile, isVideoFile, VIDEO_ACCEPT } from './lib/names.ts'
import { WaveIcon } from './ui.tsx'

export type Destination = 'extract' | 'merge'

/**
 * Start page: one card per job. Files dropped anywhere are sorted by type —
 * a video goes to 提取, audio files go to 拼接.
 */
export function Home(props: {
  onFiles: (to: Destination, files: File[]) => void
  onOpen: (to: Destination) => void
  /** Work already in a tab, so the card offers to continue it. */
  progress: Record<Destination, string | null>
}) {
  const [error, setError] = useState<string | null>(null)

  function route(files: File[]) {
    const videos = files.filter(isVideoFile)
    const audios = files.filter((f) => !isVideoFile(f) && isAudioFile(f))
    if (!videos.length && !audios.length) {
      setError(`无法处理「${files[0].name}」：请拖入 MP4 / MOV 视频，或 MP3 等音频文件。`)
      return
    }
    setError(null)
    // Anything else rides along with the audio, so 拼接 can say what it skipped.
    const rest = files.filter((f) => !videos.includes(f) && !audios.includes(f))
    // Audio first so that, with a mixed drop, the video tab is where we end up.
    if (audios.length) props.onFiles('merge', [...audios, ...rest])
    if (videos.length) props.onFiles('extract', videos)
  }

  const page = useFileDrop(route)

  return (
    <div className={`home ${page.over ? 'over' : ''}`} {...page.handlers}>
      <div className="home-intro">
        <h1>从视频里取出声音，把几段声音接起来。</h1>
        <p className="note">文件只在本机处理，不会上传。断网也能用。</p>
      </div>

      <div className="home-cards">
        <Card
          title="提取音频"
          body="从一个视频里取出声音，可简单裁切，导出 MP3。"
          formats="MP4 · MOV · 一次一个"
          action="选择视频"
          progress={props.progress.extract}
          onPick={() => openFilePicker(VIDEO_ACCEPT, false, route)}
          onContinue={() => props.onOpen('extract')}
          icon={
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden>
              <rect x="2.5" y="4.5" width="11" height="11" rx="2" />
              <path d="M13.5 8.5l4-2.5v8l-4-2.5" />
            </svg>
          }
        />
        <Card
          title="拼接音频"
          body="把几段音频排好顺序，加上静音间隔，合并成一个 MP3。"
          formats="MP3 等音频 · 可多选"
          action="选择音频"
          progress={props.progress.merge}
          onPick={() => openFilePicker(AUDIO_ACCEPT, true, route)}
          onContinue={() => props.onOpen('merge')}
          icon={<WaveIcon />}
        />
      </div>

      <p className={`home-foot ${error ? 'status error' : 'note'}`} role={error ? 'alert' : undefined}>
        {error ?? '也可以把文件直接拖到这一页的任意位置：视频会去「提取音频」，音频会去「拼接音频」。'}
      </p>
    </div>
  )
}

function Card(props: {
  title: string
  body: string
  formats: string
  action: string
  icon: React.ReactNode
  progress: string | null
  onPick: () => void
  onContinue: () => void
}) {
  // Highlight only: the drop bubbles up to the page, which routes files by type.
  const drop = useFileDrop(() => {})
  return (
    <div className={`home-card ${drop.over ? 'over' : ''}`} {...drop.handlers}>
      <div className="file-icon">{props.icon}</div>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <div className="note">{props.formats}</div>
      <div className="home-card-actions">
        <button type="button" className="btn" onClick={props.onPick}>{props.action}</button>
        <span className="note">或拖入这里</span>
      </div>
      {props.progress && (
        <button type="button" className="home-continue" onClick={props.onContinue}>
          继续：{props.progress} →
        </button>
      )}
    </div>
  )
}
