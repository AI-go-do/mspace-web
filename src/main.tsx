import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { syncDemoFromUrl } from './lib/demo'
import './styles/tokens.css'
import './styles/motion.css'

registerSW({ immediate: true })
// ?demo=1로 열면 core API가 아직 없는 화면(방의 사과·빈방 릴레이)을 예시 데이터로 보여 준다
syncDemoFromUrl(window.location.search)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
