import { useNavigate, useSearchParams } from 'react-router-dom'
import { BackIcon } from '../components/ReserveSteps'
import { AdminPenalties, AdminStats } from './AdminInsights'
import { AdminNow } from './AdminNow'
import { AdminApprentice } from './AdminApprentice'
import { useApprentice, useApprenticeFeed } from '../api/apprentice'
import { AdminReports, ForceCheckoutForm } from './AdminReports'
import { useMemberId } from '../lib/useMemberId'
import './Admin.css'

/** 관리자 화면 탭. 주소 ?tab=으로 남겨 새로고침해도 같은 탭 */
const TABS = [
  { id: 'now', label: '지금' },
  { id: 'ai', label: 'AI 수습사원' },
  { id: 'reports', label: '신고' },
  { id: 'checkout', label: '강제 퇴실' },
  { id: 'penalties', label: '경고·정지' },
  { id: 'stats', label: '통계' },
] as const
type Tab = (typeof TABS)[number]['id']

/**
 * 관리자 화면 (FR-WEB-101, FR-RPT-103·104). 링크는 관리자에게만 보이지만, 권한은 core가 막는다(아니면 403 ADMIN_ONLY).
 * 지금: 방마다 CO2·온도·습도·재실 실시간 + 사람이 볼 일(결재함). AI 수습사원: 일 종류별 레벨·아침 보고·되돌리기.
 * 둘 다 지금은 가짜 값(api/environment, api/apprentice)이고 core API가 생기면 데이터 창구만 바꾼다.
 * 신고: 대기 신고를 증거 사진과 함께 보고 판정. 강제 퇴실: 예약 번호로 사용 중인 예약을 끝낸다.
 * 경고·정지: 최근 벌칙 목록. 통계: 이용률·노쇼율·시간대·센서
 */
export default function Admin() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // 회원이 바뀌면 탭 내용을 통째로 새로 그린다(앞 회원이 받은 목록·통계와 진행 중 요청을 버림)
  const member = useMemberId()
  // 어느 탭에 있든 새 처리안을 확인해 "지금" 탭 숫자를 맞춘다
  useApprenticeFeed()
  const waiting = useApprentice().state.inbox.length
  const tab: Tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'now'

  return (
    <main className="admin">
      <header className="admin-head">
        <div className="admin-title">
          <button type="button" className="back" aria-label="뒤로" onClick={() => navigate('/me')}><BackIcon /></button>
          <div>
            <span className="admin-badge">관리자</span>
            <h1>M-space 운영</h1>
          </div>
        </div>
        <div className="seg-tabs admin-tabs" role="group" aria-label="관리 메뉴">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-pressed={tab === t.id}
              onClick={() => setParams({ tab: t.id }, { replace: true })}>
              {t.label}
              {t.id === 'now' && waiting > 0 && <span className="admin-tab-badge" aria-label={`사람이 볼 일 ${waiting}건`}>{waiting}</span>}
            </button>
          ))}
        </div>
      </header>
      <div key={member ?? 'none'} className="admin-panel">
        {tab === 'now' && <AdminNow />}
        {tab === 'ai' && <AdminApprentice />}
        {tab === 'reports' && <AdminReports onForceCheckout={(id) => setParams({ tab: 'checkout', reservation: String(id) })} />}
        {tab === 'checkout' && <ForceCheckoutForm initialId={params.get('reservation') ?? ''} />}
        {tab === 'penalties' && <AdminPenalties />}
        {tab === 'stats' && <AdminStats />}
      </div>
    </main>
  )
}
