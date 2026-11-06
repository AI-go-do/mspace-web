import { ViewTransition, type ReactNode } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, RequireAuth } from './auth/AuthProvider'
import Confetti from './components/Confetti'
import NotificationToast from './components/NotificationToast'
import TabBar from './components/TabBar'
import AccessCode from './pages/AccessCode'
import Admin from './pages/Admin'
import Assistant from './pages/Assistant'
import Checkout from './pages/Checkout'
import Home from './pages/Home'
import Instant from './pages/Instant'
import Login from './pages/Login'
import MapPage from './pages/MapPage'
import MyReservations from './pages/MyReservations'
import Alerts from './pages/Alerts'
import Placeholder from './pages/Placeholder'
import ReservationDetail from './pages/ReservationDetail'
import Report from './pages/Report'
import Rules from './pages/Rules'
import Schedule from './pages/Schedule'
import Reserve from './pages/Reserve'

/** 로그인해야 쓰는 화면 */
const auth = (page: ReactNode) => <RequireAuth>{page}</RequireAuth>

// 화면 목록은 docs 요구사항 FR-WEB-*, 모양은 PWA 화면 시안을 따른다.
// 이용 규칙(FR-WEB-003)은 로그인 전에도 볼 수 있다.
export default function App() {
  const { pathname } = useLocation()
  // 로그인·예약·입실 번호 화면은 아래 탭 대신 화면 자체의 아래 버튼을 쓴다
  const fullScreen = pathname === '/login' || pathname === '/now' || pathname === '/report' || pathname === '/admin' || pathname.startsWith('/rooms/') || pathname.startsWith('/reservations/') || pathname.endsWith('/checkout')
  return (
    <AuthProvider>
      <div className={`app ${fullScreen ? 'app-full' : ''}`}>
        {/* 화면이 바뀔 때 앞 화면은 살짝 가라앉고 새 화면이 떠오른다(View Transitions, 지원 안 하는 브라우저는 그냥 바뀜).
            주소 변경은 라우터가 startTransition 안에서 하므로 그때만 움직이고, 1분마다 새로 받는 데이터에는 안 움직인다 */}
        <ViewTransition default="page">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={auth(<Home />)} />
          <Route path="/rooms/:roomId" element={auth(<Reserve />)} />
          <Route path="/reservations/:id" element={auth(<AccessCode />)} />
          <Route path="/map" element={auth(<MapPage />)} />
          <Route path="/me" element={auth(<MyReservations />)} />
          <Route path="/me/schedule" element={auth(<Schedule />)} />
          <Route path="/me/:id" element={auth(<ReservationDetail />)} />
          <Route path="/me/:id/checkout" element={auth(<Checkout />)} />
          <Route path="/assistant" element={auth(<Assistant />)} />
          <Route path="/rules" element={<Rules />} />
          <Route path="/report" element={auth(<Report />)} />
          <Route path="/admin" element={auth(<Admin />)} />
          <Route path="/now" element={auth(<Instant />)} />
          <Route path="/alerts" element={auth(<Alerts />)} />
          <Route path="*" element={<Placeholder title="없는 화면" message="주소가 바뀌었거나 없는 화면이에요." />} />
        </Routes>
        </ViewTransition>
        {!fullScreen && <TabBar />}
        {pathname !== '/login' && <NotificationToast />}
        <Confetti />
      </div>
    </AuthProvider>
  )
}
