import type { ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import TabBar from './components/TabBar'
import Home from './pages/Home'
import Login from './pages/Login'
import Placeholder from './pages/Placeholder'

/** 로그인해야 쓰는 화면 */
const auth = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>

// 화면 목록은 docs 요구사항 FR-WEB-*, 모양은 PWA 화면 시안을 따른다.
// 이용 규칙(FR-WEB-003)은 로그인 전에도 볼 수 있다.
export default function App() {
  const { pathname } = useLocation()
  const fullScreen = pathname === '/login'
  return (
    <AuthProvider>
      <div className={`app ${fullScreen ? 'app-full' : ''}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={auth(<Home />)} />
          <Route path="/rooms/:roomId" element={auth(<Placeholder title="시간 고르기" fr="FR-WEB-001" />)} />
          <Route path="/map" element={auth(<Placeholder title="배치도" fr="FR-WEB-004" />)} />
          <Route path="/me" element={auth(<Placeholder title="내 예약" fr="FR-WEB-002" />)} />
          <Route path="/assistant" element={auth(<Placeholder title="비서 스페이시" fr="FR-AGT-101" />)} />
          <Route path="/rules" element={<Placeholder title="이용 규칙" fr="FR-WEB-003" />} />
          <Route path="/now" element={auth(<Placeholder title="지금 바로 쓰기" fr="FR-WEB-102" />)} />
          <Route path="/alerts" element={auth(<Placeholder title="알림" fr="FR-NTF-103" />)} />
          <Route path="*" element={<Placeholder title="없는 화면" />} />
        </Routes>
        {!fullScreen && <TabBar />}
      </div>
    </AuthProvider>
  )
}
