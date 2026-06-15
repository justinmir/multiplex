import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import App from './app/App.tsx'
import { PingProbe } from './lib/dev/PingProbe.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PingProbe />
  </StrictMode>,
)
