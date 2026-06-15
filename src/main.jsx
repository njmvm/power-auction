import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import PowerAuctionLive from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <PowerAuctionLive />
  </StrictMode>,
)
