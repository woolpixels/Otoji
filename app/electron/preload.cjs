// Minimal bridge for the desktop app: where downloads landed, and revealing them in Finder.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('otojiDesktop', {
  onDownloaded: (cb) => {
    const listener = (_e, info) => cb(info)
    ipcRenderer.on('otoji:downloaded', listener)
    return () => ipcRenderer.removeListener('otoji:downloaded', listener)
  },
  reveal: (p) => ipcRenderer.invoke('otoji:reveal', p),
})
