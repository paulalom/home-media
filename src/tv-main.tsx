import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import TvApp from './TvApp'
import './TvApp.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TvApp />
  </StrictMode>,
)
