import { NavLink } from 'react-router-dom'
import './TabBar.css'

const TABS = [
  { to: '/', label: '홈', d: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z' },
  { to: '/map', label: '배치도', d: 'M3 3h18v18H3zM3 12h9V3M12 21v-5h9' },
  { to: '/me', label: '내 예약', d: 'M4 4h16v17H4zM8 2v4M16 2v4M4 10h16' },
  { to: '/assistant', label: '비서', d: 'M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z' },
]

export default function TabBar() {
  return (
    <nav className="tabbar" aria-label="아래 메뉴">
      {TABS.map((t) => (
        <NavLink key={t.to} to={t.to} end className="tab">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d={t.d} />
          </svg>
          {t.label}
        </NavLink>
      ))}
    </nav>
  )
}
