import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import SiteGate from './components/SiteGate.tsx'

// SiteGate는 비공개 테스트 배포용 관문입니다. VITE_SITE_PASSWORD 가 비어 있으면
// 아무 일도 하지 않으므로 로컬 개발과 정식 오픈에는 영향이 없습니다.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SiteGate>
      <App />
    </SiteGate>
  </StrictMode>,
)
