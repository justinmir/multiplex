import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import './styles/index.css'
import { DataProvider } from './lib/data/DataProvider.tsx'
import { AppShell } from './shell/AppShell.tsx'
import { IpcDataSource } from './lib/data/IpcDataSource.js'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Toaster position="top-right" expand={false} closeButton theme="dark" />
    <DataProvider source={new IpcDataSource()}>
      <AppShell />
    </DataProvider>
  </StrictMode>,
)
