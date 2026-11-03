import { Route, Routes } from 'react-router-dom'
import TabBar from './components/TabBar'
import Home from './pages/Home'
import Placeholder from './pages/Placeholder'

// 화면 목록은 docs 요구사항 FR-WEB-*, 모양은 PWA 화면 시안을 따른다.
export default function App() {
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rooms/:roomId" element={<Placeholder title="시간 고르기" fr="FR-WEB-001" />} />
        <Route path="/map" element={<Placeholder title="배치도" fr="FR-WEB-004" />} />
        <Route path="/me" element={<Placeholder title="내 예약" fr="FR-WEB-002" />} />
        <Route path="/assistant" element={<Placeholder title="비서 스페이시" fr="FR-AGT-101" />} />
        <Route path="/rules" element={<Placeholder title="이용 규칙" fr="FR-WEB-003" />} />
        <Route path="/now" element={<Placeholder title="지금 바로 쓰기" fr="FR-WEB-102" />} />
        <Route path="/alerts" element={<Placeholder title="알림" fr="FR-NTF-103" />} />
        <Route path="*" element={<Placeholder title="없는 화면" />} />
      </Routes>
      <TabBar />
    </div>
  )
}
