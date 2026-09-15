import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './ui/App.tsx'
import { syncDocumentLang } from './i18n/index.ts'

// The stored language is read when the i18n module loads; this puts it on the
// document before the first paint, so a Tagalog session never flashes as English
// to a screen reader.
syncDocumentLang()

const container = document.getElementById('root')
if (!container) throw new Error('Root element not found')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
