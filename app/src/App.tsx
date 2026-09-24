import { useCallback, useState } from 'react'
import { ExtractTab, type SentAudio } from './extract/ExtractTab.tsx'
import { Home, type Destination } from './Home.tsx'
import { MergeTab } from './merge/MergeTab.tsx'

type Tab = '提取音频' | '拼接音频'
const TAB_OF: Record<Destination, Tab> = { extract: '提取音频', merge: '拼接音频' }

type Handover = { seq: number; files: File[] } | null

export function App() {
  // The start page shows until the first file comes in (or a tab is picked).
  const [view, setView] = useState<Tab | 'home'>('home')
  // Clips sent from 提取 to 拼接; seq makes repeated sends of the same clip distinct.
  const [inbox, setInbox] = useState<{ seq: number; audio: SentAudio } | null>(null)
  const [incoming, setIncoming] = useState<Record<Destination, Handover>>({ extract: null, merge: null })
  const [progress, setProgress] = useState<Record<Destination, string | null>>({ extract: null, merge: null })
  const [editing, setEditing] = useState<Record<Destination, boolean>>({ extract: false, merge: false })

  const onExtractProgress = useCallback((label: string | null) => setProgress((p) => ({ ...p, extract: label })), [])
  const onMergeProgress = useCallback((label: string | null) => setProgress((p) => ({ ...p, merge: label })), [])
  const onExtractEditing = useCallback((v: boolean) => setEditing((p) => ({ ...p, extract: v })), [])
  const onMergeEditing = useCallback((v: boolean) => setEditing((p) => ({ ...p, merge: v })), [])

  function handOver(to: Destination, files: File[]) {
    setIncoming((prev) => ({ ...prev, [to]: { seq: (prev[to]?.seq ?? 0) + 1, files } }))
    setView(TAB_OF[to])
  }

  return (
    <div className="app">
      <div className="window">
        <header className="topbar">
          <button type="button" className="brand" onClick={() => setView('home')} title="回到首页，切换功能">
            Otoji
          </button>
          <span className="version mono">v{__APP_VERSION__}</span>
          {view !== 'home' && (
            <nav className="crumbs" aria-label="当前位置">
              <button type="button" onClick={() => setView('home')}>首页</button>
              <span aria-hidden>/</span>
              <span aria-current="page">{view}</span>
            </nav>
          )}
          <div className="spacer" />
          {view === '提取音频' && editing.extract && (
            <div className="shortcuts">
              <kbd>空格</kbd> 播放 / 暂停 · <kbd>I</kbd> / <kbd>O</kbd> 设为开始 / 结束 · <kbd>⌘S</kbd> 导出
            </div>
          )}
          {view === '拼接音频' && editing.merge && (
            <div className="shortcuts">
              <kbd>空格</kbd> 连续试听 · 双击行从该段播放 · <kbd>⌥↑</kbd> / <kbd>⌥↓</kbd> 移动 · <kbd>⌫</kbd> 移除 · <kbd>⌘S</kbd> 导出
            </div>
          )}
        </header>
        {view === 'home' && <Home onFiles={handOver} onOpen={(to) => setView(TAB_OF[to])} progress={progress} />}
        {/* Both modes stay mounted so going home and back never clears either one's progress. */}
        <ExtractTab
          active={view === '提取音频'}
          incoming={incoming.extract}
          onProgress={onExtractProgress}
          onEditing={onExtractEditing}
          onSendToMerge={(audio) => {
            setInbox((prev) => ({ seq: (prev?.seq ?? 0) + 1, audio }))
            setView('拼接音频')
          }}
        />
        <MergeTab active={view === '拼接音频'} inbox={inbox} incoming={incoming.merge} onProgress={onMergeProgress} onEditing={onMergeEditing} />
      </div>
    </div>
  )
}
