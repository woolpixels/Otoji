// Bridge to the Mac app (electron/preload.cjs); absent in the browser.

export interface DownloadInfo {
  /** Name the page asked for. */
  requested: string
  /** Final name in ~/Downloads (may carry " (2)" when the name was taken). */
  name: string
  path: string
  ok: boolean
}

interface OtojiDesktop {
  onDownloaded: (cb: (info: DownloadInfo) => void) => () => void
  reveal: (path: string) => Promise<boolean>
}

declare global {
  interface Window {
    otojiDesktop?: OtojiDesktop
  }
}

export const desktop = window.otojiDesktop ?? null

// Downloads can finish before the page that wants to know about them has mounted,
// so the latest result per requested name is kept here from startup on.
const finished = new Map<string, DownloadInfo>()
const listeners = new Set<() => void>()
desktop?.onDownloaded((info) => {
  finished.set(info.requested, info)
  listeners.forEach((l) => l())
})

export const downloadFor = (requested: string) => finished.get(requested) ?? null

export function onDownloadsChange(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
