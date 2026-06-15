import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { DataProvider } from './lib/data/DataProvider.tsx'
import { AppShell } from './shell/AppShell.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider>
      <AppShell />
    </DataProvider>
  </StrictMode>,
)
