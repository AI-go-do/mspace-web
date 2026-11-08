import type { CSSProperties, ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import './TabBar.css'

// 아이콘은 PWA 화면 시안(Main.dc.html 아래 탭)과 똑같은 SVG
const TABS: { to: string; label: string; icon: ReactNode }[] = [
  { to: '/', label: '홈', icon: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" /> },
  {
    to: '/map', label: '배치도',
    icon: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 12h9V3" /><path d="M12 21v-5h9" /></>,
  },
  {
    // 마이: 내 예약·시간표·친구·이용 규칙·로그아웃을 한 곳에(11/6 재웅)
    to: '/me', label: '마이',
    icon: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  },
  { to: '/assistant', label: '비서', icon: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" /> },
]

/** 지금 주소가 몇 번째 탭인지(NavLink의 active 판단과 같게: 홈은 정확히 '/', 나머지는 그 경로와 하위). 없으면 -1 */
export function activeTabIndex(pathname: string): number {
  return TABS.findIndex((t) => (t.to === '/' ? pathname === '/' : pathname === t.to || pathname.startsWith(`${t.to}/`)))
}

export default function TabBar() {
  const at = activeTabIndex(useLocation().pathname)
  const { status } = useAuth()
  // 자동 로그인을 확인하는 로딩 화면에는 아래 탭을 띄우지 않는다(index.html 첫 로딩 화면과 같은 모양으로 이어지게)
  if (status === 'checking') return null
  return (
    <nav className="tabbar" aria-label="아래 메뉴">
      {/* 고른 탭 뒤 둥근 바탕. 탭을 바꾸면 미끄러져 옮겨 간다 */}
      <span className="tab-glow" aria-hidden="true" data-on={at >= 0} style={{ '--i': Math.max(at, 0) } as CSSProperties} />
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {t.icon}
          </svg>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
