import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { DataProvider } from './lib/data/DataProvider.tsx'
import { AppShell } from './shell/AppShell.tsx'
import { IpcDataSource } from './lib/data/IpcDataSource.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <DataProvider source={new IpcDataSource()}>
      <AppShell />
    </DataProvider>
  </StrictMode>,
)
