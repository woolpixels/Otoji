// Saving. Exports go straight to the browser's downloads (normally the 下载 folder),
// with no dialog. 「另存一份…」 uses the File System Access save dialog where available
// (Chromium); it needs a fresh user gesture, so it is only called from a click.

export interface SaveTarget {
  name: string
  /** 'picker': written where the user chose; 'download': handed to the browser's downloads. */
  method: 'picker' | 'download'
  write(blob: Blob): Promise<void>
}

interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    suggestedName?: string
    types?: { description: string; accept: Record<string, string[]> }[]
  }) => Promise<FileSystemFileHandle>
}

export const canPickSaveLocation = () => typeof (window as SavePickerWindow).showSaveFilePicker === 'function'

/** Default export target: a regular download into the 下载 folder. */
export function downloadTarget(name: string): SaveTarget {
  return { name, method: 'download', write: async (blob) => download(blob, name) }
}

/** Save-as dialog. Returns null when the user cancels it. */
export async function pickSaveTarget(suggestedName: string): Promise<SaveTarget | null> {
  const picker = (window as SavePickerWindow).showSaveFilePicker
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description: 'MP3 音频', accept: { 'audio/mpeg': ['.mp3'] } }] })
      return {
        name: handle.name,
        method: 'picker',
        async write(blob) {
          const stream = await handle.createWritable()
          await stream.write(blob)
          await stream.close()
        },
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null
      // SecurityError (e.g. inside an iframe) and the like: fall back to downloading.
    }
  }
  return downloadTarget(suggestedName)
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
