import type { ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import TabBar from './components/TabBar'
import AccessCode from './pages/AccessCode'
import Assistant from './pages/Assistant'
import Checkout from './pages/Checkout'
import Home from './pages/Home'
import Instant from './pages/Instant'
import Login from './pages/Login'
import MapPage from './pages/MapPage'
import MyReservations from './pages/MyReservations'
import Placeholder from './pages/Placeholder'
import ReservationDetail from './pages/ReservationDetail'
import Rules from './pages/Rules'
import Reserve from './pages/Reserve'

/** 로그인해야 쓰는 화면 */
const auth = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>

// 화면 목록은 docs 요구사항 FR-WEB-*, 모양은 PWA 화면 시안을 따른다.
// 이용 규칙(FR-WEB-003)은 로그인 전에도 볼 수 있다.
export default function App() {
  const { pathname } = useLocation()
  // 로그인·예약·입실 번호 화면은 아래 탭 대신 화면 자체의 아래 버튼을 쓴다
  const fullScreen = pathname === '/login' || pathname === '/now' || pathname.startsWith('/rooms/') || pathname.startsWith('/reservations/') || pathname.endsWith('/checkout')
  return (
    <AuthProvider>
      <div className={`app ${fullScreen ? 'app-full' : ''}`}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={auth(<Home />)} />
          <Route path="/rooms/:roomId" element={auth(<Reserve />)} />
          <Route path="/reservations/:id" element={auth(<AccessCode />)} />
          <Route path="/map" element={auth(<MapPage />)} />
          <Route path="/me" element={auth(<MyReservations />)} />
          <Route path="/me/:id" element={auth(<ReservationDetail />)} />
          <Route path="/me/:id/checkout" element={auth(<Checkout />)} />
          <Route path="/assistant" element={auth(<Assistant />)} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/now" element={auth(<Instant />)} />
          <Route path="/alerts" element={auth(<Placeholder title="알림" fr="FR-NTF-103" message="예약 시작·입실 마감·퇴실 알림이 곧 여기에 모여요. 지금은 메일로 보내 드려요." />)} />
          <Route path="*" element={<Placeholder title="없는 화면" message="주소가 바뀌었거나 없는 화면이에요." />} />
        </Routes>
        {!fullScreen && <TabBar />}
      </div>
    </AuthProvider>
  )
}
