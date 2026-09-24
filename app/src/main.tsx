import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/noto-sans-sc/400.css'
import '@fontsource/noto-sans-sc/600.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/500.css'
import './app.css'
import { App } from './App.tsx'
import { desktop } from './desktop.ts'

// A file dropped outside a drop zone would otherwise make the browser open it.
for (const type of ['dragover', 'drop'] as const) {
  window.addEventListener(type, (e) => {
    if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
  })
}

// Mac app: no title bar, the page runs under the traffic lights.
if (desktop) document.documentElement.classList.add('is-desktop')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
