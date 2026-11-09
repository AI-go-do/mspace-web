import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { BackIcon } from '../components/ReserveSteps'
import { AdminPenalties, AdminStats } from './AdminInsights'
import { AdminNow } from './AdminNow'
import { AdminApprentice } from './AdminApprentice'
import { AdminBlocks } from './AdminBlocks'
import { AdminTodo, useTodoCounts } from './AdminTodo'
import { ForceCheckoutForm } from './AdminReports'
import { useApprenticeFeed } from '../api/apprentice'
import { envSource } from '../api/environment'
import { useMemberId } from '../lib/useMemberId'
import { seoulClockSec } from '../lib/time'
import './Admin.css'

/**
 * 관리자 화면 (FR-WEB-101, FR-RPT-103·104) 다섯 칸. 주소 ?tab=으로 남겨 새로고침해도 같은 칸.
 * 지금(방 상태) · 할 일(신고 판정 + AI 제안을 한 줄로) · AI 수습사원(레벨·아침 보고) · 방 관리(기간 막기·강제 퇴실) · 기록(통계·경고·정지)
 */
const SECTIONS = [
  {
    id: 'now', label: '지금', title: '지금 방 상태', sub: '방 5개의 공기와 예약을 한눈에. 이상한 방이 먼저 눈에 띄어요.',
    icon: <><circle cx="12" cy="12" r="3" /><path d="M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8M8.5 8.5a4.9 4.9 0 0 0 0 7M15.5 8.5a4.9 4.9 0 0 1 0 7" /></>,
  },
  {
    id: 'todo', label: '할 일', title: '할 일', sub: '사람이 정해야 하는 일만 모았어요. 신고 판정과 AI 제안이 한곳에 있어요.',
    icon: <><path d="M4 12.5 9 17.5 20 6.5" /></>,
  },
  {
    id: 'ai', label: 'AI 수습사원', title: 'AI 수습사원', sub: '일 종류마다 따로 채점해요. 믿을 만해진 일만 AI가 먼저 처리해요.',
    icon: <><rect x="4" y="7" width="16" height="12" rx="4" /><path d="M12 3v4M9 12h.01M15 12h.01M9.5 15.5h5" /></>,
  },
  {
    id: 'rooms', label: '방 관리', title: '방 관리', sub: '공사·점검·대관 기간을 막고, 사용 중인 예약을 끝낼 수 있어요.',
    icon: <><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M3 12h9V3M12 21v-5h9" /></>,
  },
  {
    id: 'records', label: '기록', title: '기록', sub: '이용 통계와 경고·정지 기록이에요.',
    icon: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  },
] as const
type Section = (typeof SECTIONS)[number]['id']

/** "지금" 방 상세 창의 [이 방 막기]에서 왔으면 방 번호(?block=3, 점검이면 &why=inspection) */
function blockRoomParam(params: URLSearchParams): { roomId: number; inspection: boolean } | null {
  const roomId = Number(params.get('block'))
  return Number.isInteger(roomId) && roomId > 0 ? { roomId, inspection: params.get('why') === 'inspection' } : null
}

/** 예전 탭 주소(?tab=reports 등)로 들어와도 맞는 칸을 연다 */
const LEGACY: Record<string, { tab: Section; sub?: string }> = {
  reports: { tab: 'todo' }, checkout: { tab: 'rooms', sub: 'checkout' }, blocks: { tab: 'rooms' },
  penalties: { tab: 'records', sub: 'penalties' }, stats: { tab: 'records', sub: 'stats' },
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

/** 1초마다 바뀌는 큰 시계 (머리 오른쪽). 초는 흐리게 */
function LiveClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const text = seoulClockSec(now)
  // 시·분과 초를 마지막 ':'에서 나눈다(글자 자리를 가정하지 않게)
  const cut = text.lastIndexOf(':')
  const hm = cut > 0 ? text.slice(0, cut) : text
  const sec = cut > 0 ? text.slice(cut) : ''
  return (
    <span className="adm-live" role="timer" aria-label={`지금 ${hm}`}>
      <i aria-hidden="true" />
      <b aria-hidden="true">{hm}<span>{sec}</span></b>
    </span>
  )
}

/**
 * 칸 이름 옆 숫자. 숫자가 바뀌면 톡 튀어 오른다(key가 바뀌어 애니메이션이 다시 돈다).
 * 신고 수 요청이 실패했으면 0이어도 숨기지 않고 "?"(AI 제안이 있으면 "N+")로 모른다는 걸 보여 준다
 */
function Badge({ n, unknown = false }: { n: number; unknown?: boolean }) {
  if (unknown) {
    const text = n > 0 ? `${n}+` : '?'
    return <span key={text} className="adm-badge" aria-label={`할 일 ${n > 0 ? `${n}건 이상, ` : ''}신고 수를 확인하지 못했어요`}>{text}</span>
  }
  if (n <= 0) return null
  return <span key={n} className="adm-badge" aria-label={`할 일 ${n}건`}>{n}</span>
}

export default function Admin() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // 회원이 바뀌면 칸 내용을 통째로 새로 그린다(앞 회원이 받은 목록·통계와 진행 중 요청을 버림)
  const member = useMemberId()
  // 어느 칸에 있든 새 AI 처리안을 확인해 "할 일" 숫자를 맞춘다
  useApprenticeFeed()
  const counts = useTodoCounts()

  const raw = params.get('tab') ?? 'now'
  const legacy = LEGACY[raw]
  const tab: Section = legacy?.tab ?? (SECTIONS.some((s) => s.id === raw) ? (raw as Section) : 'now')
  const sub = params.get('sub') ?? legacy?.sub ?? null
  const index = SECTIONS.findIndex((s) => s.id === tab)
  const section = SECTIONS[index]

  const go = (id: Section, extra: Record<string, string> = {}) => setParams({ tab: id, ...extra }, { replace: true })
  const badge = (id: Section) => (id === 'todo' ? counts.total : 0)

  return (
    <div className={`adm ${tab === 'now' ? 'on-now' : ''}`} style={{ '--i': index } as CSSProperties}>
      {/* 관제실 머리: 왼쪽 이름, 가운데 메뉴(넓은 화면), 오른쪽 큰 시계 */}
      <header className="adm-top">
        <div className="adm-brand">
          <button type="button" className="adm-back" aria-label="학생 화면으로" onClick={() => navigate('/me')}><BackIcon /></button>
          <span className="adm-mark" aria-hidden="true">M</span>
          <div>
            <b>M-space 관제실</b>
            <span>조선대 IT융합대학 · 방 5개</span>
          </div>
        </div>
        <nav className="adm-nav" aria-label="관리 메뉴">
          <span className="adm-nav-glow" aria-hidden="true" />
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className="adm-nav-item" aria-current={tab === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
              <Icon>{s.icon}</Icon>
              <span>{s.label}</span>
              <Badge n={badge(s.id)} unknown={s.id === 'todo' && counts.reportsFailed} />
            </button>
          ))}
        </nav>
        <div className="adm-top-end">
          {envSource() === 'mock' && <span className="adm-mock">가짜 값 · 시연용</span>}
          <LiveClock />
        </div>
      </header>

      <main className="adm-main">
        {tab === 'now'
          ? <h1 className="sr-only">{section.title}</h1>
          : (
            <header className="adm-head" key={tab}>
              <div className="adm-head-text">
                <h1>{section.title}</h1>
                <p>{section.sub}</p>
              </div>
            </header>
          )}
        <div key={`${member ?? 'none'}-${tab}`} className={`adm-panel ${tab === 'now' ? 'is-dark' : 'is-sheet'}`}>
          {tab === 'now' && (
            <AdminNow todo={counts} onOpenTodo={() => go('todo')}
              onForceCheckout={(id) => go('rooms', { sub: 'checkout', reservation: String(id) })}
              onBlockRoom={(id, inspection) => go('rooms', { block: String(id), ...(inspection ? { why: 'inspection' } : {}) })} />
          )}
          {tab === 'todo' && <AdminTodo counts={counts} onForceCheckout={(id) => go('rooms', { sub: 'checkout', reservation: String(id) })} onOpenRooms={() => go('rooms')} />}
          {tab === 'ai' && <AdminApprentice />}
          {tab === 'rooms' && (
            <div className="adm-rooms">
              <AdminBlocks fromRoom={blockRoomParam(params)} />
              <ForceCheckoutForm initialId={params.get('reservation') ?? ''} focus={sub === 'checkout'} />
            </div>
          )}
          {tab === 'records' && <Records sub={sub === 'penalties' ? 'penalties' : 'stats'} onSub={(s) => go('records', { sub: s })} />}
        </div>
      </main>

      {/* 폰: 아래 떠 있는 메뉴. 고른 칸 뒤 바탕이 미끄러져 옮겨 간다 */}
      <nav className="adm-bar" aria-label="관리 메뉴">
        <span className="adm-bar-glow" aria-hidden="true" />
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" className="adm-bar-item" aria-current={tab === s.id ? 'page' : undefined} onClick={() => go(s.id)}>
            <span className="adm-bar-icon"><Icon>{s.icon}</Icon><Badge n={badge(s.id)} unknown={s.id === 'todo' && counts.reportsFailed} /></span>
            {s.id === 'ai' ? 'AI' : s.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

/** 기록: 통계 · 경고·정지 두 쪽 */
function Records({ sub, onSub }: { sub: 'stats' | 'penalties'; onSub: (s: 'stats' | 'penalties') => void }) {
  return (
    <div className="adm-records">
      <div className="adm-seg" role="group" aria-label="기록 종류" style={{ '--i': sub === 'stats' ? 0 : 1 } as CSSProperties}>
        <span className="adm-seg-glow" aria-hidden="true" />
        <button type="button" aria-pressed={sub === 'stats'} onClick={() => onSub('stats')}>이용 통계</button>
        <button type="button" aria-pressed={sub === 'penalties'} onClick={() => onSub('penalties')}>경고·정지</button>
      </div>
      {sub === 'stats' ? <AdminStats /> : <AdminPenalties />}
    </div>
  )
}
