// Otoji desktop shell: a single window around the built web app (dist/).
const { app, BrowserWindow, ipcMain, net, protocol, shell } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

app.setName('Otoji')

// The page is served over a private scheme instead of file://, so module workers
// (the MP3 encoder) and the ffmpeg.wasm fallback load the same way as in a browser.
const SCHEME = 'otoji'
const DIST = path.join(__dirname, '..', 'dist')
protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])
if (!app.requestSingleInstanceLock()) app.quit()

/** ~/Downloads/name, or name (2).ext … when it already exists. */
function uniquePath(dir, name) {
  const ext = path.extname(name)
  const base = name.slice(0, name.length - ext.length)
  let p = path.join(dir, name)
  for (let i = 2; fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`)
  return p
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 860,
    minHeight: 600,
    // No visible title bar: the page runs to the top edge, traffic lights float over it.
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 20 },
    backgroundColor: '#fbf9f4',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.once('ready-to-show', () => win.show())

  // Exports go straight to ~/Downloads (no dialog); the page is told the final path for 在访达中显示.
  win.webContents.session.on('will-download', (_e, item) => {
    const requested = item.getFilename()
    const target = uniquePath(app.getPath('downloads'), requested)
    item.setSavePath(target)
    item.once('done', (_ev, state) => {
      if (!win.isDestroyed()) {
        win.webContents.send('otoji:downloaded', { requested, name: path.basename(target), path: target, ok: state === 'completed' })
      }
    })
  })

  // Never navigate away from the app (e.g. a file dropped outside a drop zone).
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env.OTOJI_DEV_URL
  if (devUrl) win.loadURL(devUrl)
  else win.loadURL(`${SCHEME}://app/index.html`)
  return win
}

// Only files inside the downloads folder can be revealed from the page.
const inDownloads = (p) => typeof p === 'string' && path.resolve(p).startsWith(app.getPath('downloads') + path.sep) && fs.existsSync(p)
ipcMain.handle('otoji:reveal', (_e, p) => inDownloads(p) && (shell.showItemInFolder(p), true))

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows()
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(() => {
  protocol.handle(SCHEME, (request) => {
    const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    const file = path.join(DIST, rel)
    // Never serve anything outside dist/.
    if (!file.startsWith(DIST + path.sep)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(file).toString())
  })
  createWindow()
  app.on('activate', () => {
    if (!BrowserWindow.getAllWindows().length) createWindow()
  })
})

app.on('window-all-closed', () => app.quit())
