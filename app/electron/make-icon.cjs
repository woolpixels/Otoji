// Builds the app icon from ../design/icon.png: the logo filling a macOS-style rounded
// tile (824px on a 1024 grid), and writes build/icon.icns, build/icon.png and
// public/favicon.png. Run with: npm run icon
const { app, BrowserWindow } = require('electron')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const src = path.join(root, '..', 'design', 'icon.png')
const buildDir = path.join(root, 'build')
const iconset = path.join(buildDir, 'icon.iconset')

const draw = (dataUrl) => `(async () => {
  const img = new Image()
  img.src = ${JSON.stringify(dataUrl)}
  await img.decode()
  const c = document.createElement('canvas')
  c.width = c.height = 1024
  const g = c.getContext('2d')
  const x = 100, y = 100, s = 824, r = 185
  const tile = () => { g.beginPath(); g.roundRect(x, y, s, s, r) }
  g.save()
  g.shadowColor = 'rgba(0, 0, 0, 0.28)'
  g.shadowBlur = 28
  g.shadowOffsetY = 10
  // The logo has no transparency; the tile uses its background colour so the edges disappear.
  tile(); g.fillStyle = '#faf9f5'; g.fill()
  g.restore()
  g.save()
  tile(); g.clip()
  const inset = s * 0.9 // the drawing nearly touches the image edges; keep a margin inside the tile
  g.drawImage(img, x + (s - inset) / 2, y + (s - inset) / 2, inset, inset)
  g.restore()
  tile(); g.lineWidth = 2; g.strokeStyle = 'rgba(0, 0, 0, 0.12)'; g.stroke()
  const out = {}
  for (const size of [16, 32, 64, 128, 256, 512, 1024]) {
    const k = document.createElement('canvas')
    k.width = k.height = size
    const kg = k.getContext('2d')
    kg.imageSmoothingQuality = 'high'
    kg.drawImage(c, 0, 0, size, size)
    out[size] = k.toDataURL('image/png')
  }
  return out
})()`

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  await win.loadURL('data:text/html,<html></html>')
  const dataUrl = 'data:image/png;base64,' + fs.readFileSync(src).toString('base64')
  const pngs = await win.webContents.executeJavaScript(draw(dataUrl))
  const png = (size) => Buffer.from(pngs[size].split(',')[1], 'base64')
  fs.rmSync(iconset, { recursive: true, force: true })
  fs.mkdirSync(iconset, { recursive: true })
  for (const base of [16, 32, 128, 256, 512]) {
    fs.writeFileSync(path.join(iconset, `icon_${base}x${base}.png`), png(base))
    fs.writeFileSync(path.join(iconset, `icon_${base}x${base}@2x.png`), png(base * 2))
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png(1024))
  fs.mkdirSync(path.join(root, 'public'), { recursive: true })
  fs.writeFileSync(path.join(root, 'public', 'favicon.png'), png(128))
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(buildDir, 'icon.icns')])
  fs.rmSync(iconset, { recursive: true, force: true })
  console.log('wrote build/icon.icns, build/icon.png, public/favicon.png')
  app.quit()
})
