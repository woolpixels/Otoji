import { useEffect, useRef, useState } from 'react'
import { conform, decodeMedia } from '../lib/audio.ts'
import type { EncodePiece } from '../lib/encoder.ts'
import { AUDIO_ACCEPT, baseName, fileKey, isAudioFile, naturalCompare } from '../lib/names.ts'
import { layout, LONG_AUDIO_SECONDS, mergeTarget } from '../lib/pcm.ts'
import { SequencePlayer, type Clip, type PlayPosition } from '../lib/player.ts'
import { probe } from '../lib/probe.ts'
import { clamp, estimateMp3Bytes, formatBytes, formatSeconds, formatTime } from '../lib/time.ts'
import { ExportDone } from '../ExportDone.tsx'
import type { SentAudio } from '../extract/ExtractTab.tsx'
import { isTyping, openFilePicker, QUALITIES, useExport, useFileDrop, useFrame, useLatest, type Quality } from '../hooks.ts'
import { ExportStatus, PlayButton, Segmented } from '../ui.tsx'

const GAP_PRESETS = [0, 0.5, 1, 2, 'custom'] as const
type GapPreset = (typeof GAP_PRESETS)[number]
const MAX_GAP = 10

interface Item {
  id: string
  name: string
  /** Import identity, to refuse the same file twice; absent for clips sent from 提取. */
  key?: string
  fromExtract?: boolean
  /** null while decoding. */
  buffer: AudioBuffer | null
  /** Silence after this item when set; otherwise the default gap applies. */
  gapOverride: number | null
}

let nextId = 0
const newId = () => `i${++nextId}`

export function MergeTab(props: {
  active: boolean
  /** A clip sent from 提取音频. */
  inbox: { seq: number; audio: SentAudio } | null
  /** Files handed over by the start page. */
  incoming: { seq: number; files: File[] } | null
  /** Reports a short summary of the list (or null) so the start page can offer to continue. */
  onProgress: (label: string | null) => void
  /** Whether the list is showing, so the top bar can show its shortcut hints. */
  onEditing: (editing: boolean) => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [gapPreset, setGapPreset] = useState<GapPreset>(0.5)
  const [customGap, setCustomGap] = useState(3)
  const [editingGap, setEditingGap] = useState<string | null>(null)
  const [quality, setQuality] = useState<Quality>(192)
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState<PlayPosition | null>(null)
  const [cursor, setCursor] = useState<PlayPosition | null>(null)
  const exp = useExport()

  const defaultGap = gapPreset === 'custom' ? customGap : gapPreset
  const gapOf = (item: Item) => item.gapOverride ?? defaultGap
  const ready = items.filter((i): i is Item & { buffer: AudioBuffer } => i.buffer !== null)
  const pending = items.length - ready.length
  const clips: Clip[] = ready.map((i) => ({ id: i.id, buffer: i.buffer, from: 0, to: i.buffer.duration, gapAfter: gapOf(i) }))
  const { starts, total, gapTotal } = layout(clips.map((c) => ({ duration: c.to, gapAfter: c.gapAfter })))

  // ── preview ──────────────────────────────────────────────────────────────

  const plan = useLatest(clips)
  const pausing = useRef(false)
  const [player] = useState(
    // The callbacks read the refs when a clip ends, never during render.
    // oxlint-disable-next-line react/refs
    () =>
      new SequencePlayer(
        () => plan.current,
        () => {
          setPlaying(false)
          if (!pausing.current) setCursor(null)
          pausing.current = false
        },
      ),
  )
  useEffect(() => () => player.stop(), [player])

  useFrame(playing, () => setPosition(player.position()))

  const shown = playing ? position : cursor
  const currentId = shown?.id ?? null
  const timelinePos = (() => {
    if (!shown) return 0
    const i = clips.findIndex((c) => c.id === shown.id)
    return i < 0 ? 0 : clamp(starts[i] + shown.time, 0, total)
  })()

  function play(id: string, at = 0) {
    player.play(id, at)
    setPlaying(true)
    setPosition({ id, time: at })
  }

  function pause() {
    if (!player.playing) return
    const p = player.position()
    pausing.current = true
    player.stop()
    setCursor(p && p.time >= 0 ? p : p ? { id: p.id, time: 0 } : null)
  }

  function togglePlay() {
    if (player.playing) return pause()
    if (!clips.length) return
    if (cursor && clips.some((c) => c.id === cursor.id)) play(cursor.id, cursor.time)
    else play(clips[0].id)
  }

  const actions = useLatest({ pause })
  useEffect(() => {
    if (!props.active) actions.current.pause()
  }, [props.active, actions])

  // ── import ───────────────────────────────────────────────────────────────

  const itemsRef = useLatest(items)

  async function addFiles(files: File[]) {
    setNotice(null)
    // Read through the ref: the picker's callback can outlive the render that opened it.
    const known = new Set(itemsRef.current.map((i) => i.key))
    const skippedType: string[] = []
    const skippedDup: string[] = []
    const accepted: File[] = []
    for (const f of files) {
      if (!isAudioFile(f)) skippedType.push(f.name)
      else if (known.has(fileKey(f))) skippedDup.push(f.name)
      else {
        known.add(fileKey(f))
        accepted.push(f)
      }
    }
    accepted.sort((a, b) => naturalCompare(a.name, b.name))
    const added = accepted.map((f) => ({ file: f, item: { id: newId(), name: f.name, key: fileKey(f), buffer: null, gapOverride: null } as Item }))
    setItems((prev) => [...prev, ...added.map((a) => a.item)])

    const notes: string[] = []
    if (skippedDup.length) notes.push(`已在列表中，跳过：${skippedDup.join('、')}`)
    if (skippedType.length) notes.push(`不是音频文件，跳过：${skippedType.join('、')}`)
    if (notes.length) setNotice({ text: notes.join('；') })

    const failed: string[] = []
    for (const { file, item } of added) {
      try {
        const buffer = await decodeMedia(file, await probe(file).catch(() => null))
        setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, buffer } : i)))
      } catch {
        failed.push(file.name)
        setItems((prev) => prev.filter((i) => i.id !== item.id))
      }
    }
    if (failed.length) setNotice({ text: `无法解码，已移除：${failed.join('、')}`, error: true })
  }

  const inboxSeq = useRef(0)
  useEffect(() => {
    const inbox = props.inbox
    if (!inbox || inbox.seq === inboxSeq.current) return
    inboxSeq.current = inbox.seq
    exp.reset()
    const item: Item = { id: newId(), name: inbox.audio.name, fromExtract: true, buffer: inbox.audio.buffer, gapOverride: null }
    setItems((prev) => [...prev, item])
    setSelectedId(item.id)
    setNotice({ text: `已从「提取音频」加入：${inbox.audio.name}` })
  }, [props.inbox, exp])

  const addRef = useLatest(addFiles)
  const incomingSeq = useRef(0)
  useEffect(() => {
    const inc = props.incoming
    if (!inc || inc.seq === incomingSeq.current) return
    incomingSeq.current = inc.seq
    exp.reset()
    void addRef.current(inc.files)
  }, [props.incoming, exp, addRef])

  const { onProgress } = props
  const summary = items.length ? `${items.length} 段音频` : null
  useEffect(() => onProgress(summary), [summary, onProgress])

  /** Empties the list for a new merge. */
  function reset() {
    player.stop()
    setCursor(null)
    setItems([])
    setSelectedId(null)
    setEditingGap(null)
    setNotice(null)
    exp.reset()
  }

  const finished = exp.state.kind === 'done' ? exp.state.result : null
  const editing = items.length > 0 && !finished
  const { onEditing } = props
  useEffect(() => onEditing(editing), [editing, onEditing])

  const drop = useFileDrop((files) => void addFiles(files))
  const pick = () => openFilePicker(AUDIO_ACCEPT, true, (files) => void addFiles(files))

  // ── editing ──────────────────────────────────────────────────────────────

  function remove(id: string) {
    if (position?.id === id || cursor?.id === id) {
      player.stop()
      setCursor(null)
    }
    setItems((prev) => prev.filter((i) => i.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  function move(id: string, to: number) {
    setItems((prev) => {
      const from = prev.findIndex((i) => i.id === id)
      if (from < 0) return prev
      const next = prev.slice()
      const [it] = next.splice(from, 1)
      next.splice(clamp(to, 0, next.length), 0, it)
      return next
    })
  }

  const setOverride = (id: string, v: number | null) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, gapOverride: v } : i)))

  // ── drag to reorder ──────────────────────────────────────────────────────

  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number; index: number; lineY: number } | null>(null)
  const dragRects = useRef<{ id: string; top: number; bottom: number }[]>([])

  function dragStart(id: string, e: React.PointerEvent) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    const base = listRef.current!.getBoundingClientRect().top
    dragRects.current = items.map((i) => {
      const r = rowRefs.current.get(i.id)!.getBoundingClientRect()
      return { id: i.id, top: r.top - base, bottom: r.bottom - base }
    })
    setSelectedId(id)
    setEditingGap(null)
    const index = items.findIndex((i) => i.id === id)
    setDrag({ id, startY: e.clientY, dy: 0, index, lineY: -1 })
  }

  function dragMove(e: React.PointerEvent) {
    if (!drag) return
    const y = e.clientY - listRef.current!.getBoundingClientRect().top
    const others = dragRects.current.filter((r) => r.id !== drag.id)
    const index = others.filter((r) => (r.top + r.bottom) / 2 < y).length
    const lineY =
      index === 0 ? (others[0]?.top ?? 0) - 3
      : index === others.length ? others[index - 1].bottom + 3
      : (others[index - 1].bottom + others[index].top) / 2
    setDrag({ ...drag, dy: e.clientY - drag.startY, index, lineY })
  }

  function dragEnd() {
    if (!drag) return
    if (Math.abs(drag.dy) > 3) move(drag.id, drag.index)
    setDrag(null)
  }

  // ── keyboard ─────────────────────────────────────────────────────────────

  const keys = useLatest({ togglePlay, selectedId, items, move, remove, doExport })
  useEffect(() => {
    if (!props.active || finished) return
    const onKey = (e: KeyboardEvent) => {
      const k = keys.current
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        k.doExport()
        return
      }
      if (isTyping(e)) return
      if (e.key === ' ' && !e.altKey && !e.metaKey && !e.ctrlKey) {
        e.preventDefault()
        k.togglePlay()
        return
      }
      if (!k.selectedId) return
      const index = k.items.findIndex((i) => i.id === k.selectedId)
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        k.move(k.selectedId, index + (e.key === 'ArrowUp' ? -1 : 1))
      } else if (!e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        const next = k.items[clamp(index + (e.key === 'ArrowUp' ? -1 : 1), 0, k.items.length - 1)]
        if (next) setSelectedId(next.id)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        k.remove(k.selectedId)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [props.active, keys, finished])

  // ── export ───────────────────────────────────────────────────────────────

  const canExport = ready.length > 0 && pending === 0

  function doExport() {
    if (!canExport || exp.busy) return
    pause()
    const snapshot = clips
    const name = `${baseName(items[0].name)}_合并${snapshot.length}段.mp3`
    void exp.run(name, total, async () => {
      const { sampleRate, channels } = mergeTarget(snapshot.map((c) => ({ sampleRate: c.buffer.sampleRate, channels: c.buffer.numberOfChannels })))
      // Everything is decoded to PCM first and re-encoded as a whole, so there are
      // no MP3 padding frames at the joins; mismatched rates / mono are converted here.
      const pieces: EncodePiece[] = []
      for (let i = 0; i < snapshot.length; i++) {
        pieces.push({ buffer: await conform(snapshot[i].buffer, sampleRate, channels) })
        if (i < snapshot.length - 1 && snapshot[i].gapAfter > 0) pieces.push({ silence: snapshot[i].gapAfter })
      }
      return { sampleRate, channels: channels as 1 | 2, kbps: quality, pieces }
    })
  }

  // ── render ───────────────────────────────────────────────────────────────

  const others = drag ? items.filter((i) => i.id !== drag.id) : items

  if (finished) {
    return (
      <div className="tab-panel" hidden={!props.active}>
        <ExportDone
          result={finished}
          active={props.active}
          nextLabel="开始新的拼接"
          onNext={() => {
            reset()
            pick()
          }}
          onBack={exp.reset}
        />
      </div>
    )
  }

  return (
    <div className="tab-panel" hidden={!props.active}>
      <div className="workspace">
        {notice && <div className={`banner ${notice.error ? 'error' : ''}`}>{notice.text}</div>}
        {total > LONG_AUDIO_SECONDS && (
          <div className="banner">总时长较长（{Math.round(total / 60)} 分钟），合并时会占用较多内存，请耐心等待。</div>
        )}
        <div className="merge">
          <div
            className={`merge-list ${drop.over ? 'over' : ''}`}
            ref={listRef}
            {...drop.handlers}
            onPointerMove={dragMove}
            onPointerUp={dragEnd}
            onPointerCancel={() => setDrag(null)}
          >
            {items.length === 0 ? (
              <div
                className={`dropzone ${drop.over ? 'over' : ''}`}
                role="button"
                tabIndex={0}
                onClick={pick}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    pick()
                  }
                }}
              >
                <div className="title">拖入几段 MP3，或点击选择</div>
                <div className="note">可多选 · 按文件名排序 · 仅在本地处理</div>
              </div>
            ) : (
              <>
                {items.map((item, index) => {
                  const isLast = index === items.length - 1
                  const dragging = drag?.id === item.id
                  const gap = gapOf(item)
                  return (
                    <div key={item.id}>
                      <div
                        ref={(el) => {
                          if (el) rowRefs.current.set(item.id, el)
                          else rowRefs.current.delete(item.id)
                        }}
                        className={[
                          'row',
                          selectedId === item.id && 'selected',
                          currentId === item.id && 'current',
                          dragging && 'dragging',
                          !item.buffer && 'pending',
                        ].filter(Boolean).join(' ')}
                        style={dragging ? ({ '--dy': `${drag.dy}px` } as React.CSSProperties) : undefined}
                        onClick={() => setSelectedId(item.id)}
                        onDoubleClick={() => item.buffer && play(item.id)}
                        aria-selected={selectedId === item.id}
                      >
                        <button
                          type="button"
                          className="grip"
                          aria-label={`拖动排序：${item.name}`}
                          title="拖动排序（或选中后 ⌥↑ / ⌥↓）"
                          onPointerDown={(e) => dragStart(item.id, e)}
                        >
                          ≡
                        </button>
                        <span className="row-index mono">{String(index + 1).padStart(2, '0')}</span>
                        <span className="row-name" title={item.name}>
                          {item.name}
                          {dragging && <span className="row-tag">拖动中</span>}
                          {!dragging && item.fromExtract && <span className="row-tag">来自提取</span>}
                        </span>
                        <span className="row-dur mono">{item.buffer ? formatTime(item.buffer.duration) : '解码中…'}</span>
                        <button type="button" className="row-remove" aria-label={`移除 ${item.name}`} title="移除" onClick={(e) => { e.stopPropagation(); remove(item.id) }}>
                          ×
                        </button>
                      </div>
                      {!isLast && (
                        <div className="gap">
                          <button
                            type="button"
                            className={`gap-chip ${item.gapOverride !== null ? 'custom' : ''}`}
                            aria-expanded={editingGap === item.id}
                            onClick={() => setEditingGap(editingGap === item.id ? null : item.id)}
                          >
                            间隔 {formatSeconds(gap)} s{item.gapOverride !== null ? ' · 单独设置' : ''}
                          </button>
                          {editingGap === item.id && (
                            <div className="gap-edit">
                              这一处
                              <input
                                className="num-input"
                                type="number"
                                min={0}
                                max={MAX_GAP}
                                step={0.1}
                                autoFocus
                                aria-label="这一处的间隔（秒）"
                                defaultValue={formatSeconds(gap)}
                                onChange={(e) => {
                                  const v = Number(e.target.value)
                                  if (e.target.value !== '' && Number.isFinite(v)) setOverride(item.id, clamp(Math.round(v * 10) / 10, 0, MAX_GAP))
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === 'Escape') setEditingGap(null)
                                }}
                              />
                              秒
                              {item.gapOverride !== null && (
                                <button type="button" className="btn link" onClick={() => { setOverride(item.id, null); setEditingGap(null) }}>
                                  恢复默认
                                </button>
                              )}
                              <button type="button" className="btn link" onClick={() => setEditingGap(null)}>完成</button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
                {drag && Math.abs(drag.dy) > 3 && drag.lineY >= 0 && others.length > 0 && (
                  <div className="insert-line" style={{ top: drag.lineY }} />
                )}
                <button type="button" className="add-files" onClick={pick}>+ 添加文件（可多选）</button>
              </>
            )}
          </div>

          <aside className="merge-side">
            <div>
              <div className="label">默认间隔（秒）</div>
              <Segmented
                label="默认间隔"
                mono
                options={GAP_PRESETS}
                value={gapPreset}
                onChange={setGapPreset}
                render={(v) => (v === 'custom' ? <span className="ui">自定义</span> : String(v))}
              />
              {gapPreset === 'custom' && (
                <div className="custom">
                  <input
                    className="num-input"
                    type="number"
                    min={0}
                    max={MAX_GAP}
                    step={0.1}
                    aria-label="自定义间隔（秒）"
                    defaultValue={customGap}
                    onChange={(e) => {
                      const v = Number(e.target.value)
                      if (e.target.value !== '' && Number.isFinite(v)) setCustomGap(clamp(Math.round(v * 10) / 10, 0, MAX_GAP))
                    }}
                  />
                  秒（0–10）
                </div>
              )}
            </div>
            <div>
              <div className="label">总时长</div>
              <div className="total mono">{formatTime(total)}</div>
              <div className="note">
                {clips.length} 段音频
                {clips.length > 1 ? ` + ${clips.length - 1} 处间隔共 ${formatSeconds(gapTotal)} s` : ''}
                {pending > 0 ? ` · ${pending} 段解码中` : ''}
              </div>
            </div>
            <div>
              <div className="label">音质（kbps）</div>
              <Segmented label="音质" mono options={QUALITIES} value={quality} onChange={setQuality} />
              {canExport && <div className="note" style={{ marginTop: 6 }}>预计 {formatBytes(estimateMp3Bytes(quality, total))}</div>}
            </div>
          </aside>
        </div>
      </div>

      <div className="bottombar">
        {exp.state.kind === 'idle' ? (
          <>
            <PlayButton playing={playing} onClick={togglePlay} disabled={!clips.length} />
            <div
              className="timeline"
              role="presentation"
              onClick={(e) => {
                const seg = (e.target as HTMLElement).closest<HTMLElement>('[data-id]')
                if (!seg) return
                const r = seg.getBoundingClientRect()
                const clip = clips.find((c) => c.id === seg.dataset.id)
                if (clip) play(clip.id, clamp((e.clientX - r.left) / r.width, 0, 1) * clip.to)
              }}
            >
              {clips.map((c, i) => {
                const played = clamp((timelinePos - starts[i]) / c.to, 0, 1)
                return (
                  <div key={c.id} data-id={c.id} className={currentId === c.id ? 'current' : ''} style={{ flexGrow: c.to }} title={items.find((it) => it.id === c.id)?.name}>
                    <span style={{ width: `${played * 100}%` }} />
                  </div>
                )
              })}
            </div>
            <span className="mono note">{formatTime(timelinePos)} / {formatTime(total)}</span>
          </>
        ) : (
          <>
            <ExportStatus exp={exp} />
            <div className="spacer" />
          </>
        )}
        <button type="button" className="btn primary" onClick={doExport} disabled={!canExport || exp.busy}>
          合并导出
        </button>
      </div>
    </div>
  )
}
