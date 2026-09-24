const collator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' })

/** Natural order: "2.mp3" before "10.mp3". */
export const naturalCompare = (a: string, b: string) => collator.compare(a, b)

export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(0, dot) : fileName
}

export function extension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : ''
}

/** Identity used to refuse importing the same file twice. */
export const fileKey = (f: File) => `${f.name}\u0000${f.size}\u0000${f.lastModified}`

export const VIDEO_EXTENSIONS = ['mp4', 'mov', 'm4v']
export const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac']
export const VIDEO_ACCEPT = '.mp4,.mov,.m4v,video/mp4,video/quicktime'
export const AUDIO_ACCEPT = '.mp3,audio/mpeg,.m4a,.aac,.wav,.ogg,.opus,.flac,audio/*'

export const isVideoFile = (f: File) => VIDEO_EXTENSIONS.includes(extension(f.name)) || /^video\/(mp4|quicktime)$/.test(f.type)
export const isAudioFile = (f: File) => AUDIO_EXTENSIONS.includes(extension(f.name)) || f.type.startsWith('audio/')
