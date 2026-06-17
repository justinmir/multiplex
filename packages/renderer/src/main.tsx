import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { DataProvider } from './lib/data/DataProvider.tsx'
import { AppShell } from './shell/AppShell.tsx'
import { IpcDataSource } from './lib/data/IpcDataSource.js'

// Toasts (top-right) are intentionally not rendered — inline status is shown
// where it matters (e.g. the note editor's saving indicator) instead.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider source={new IpcDataSource()}>
      <AppShell />
    </DataProvider>
  </StrictMode>,
)
