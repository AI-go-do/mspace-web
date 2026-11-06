import { useNavigate, useSearchParams } from 'react-router-dom'
import { BackIcon } from '../components/ReserveSteps'
import { AdminReports, ForceCheckoutForm } from './AdminReports'
import './Admin.css'

/** 관리자 화면 탭. 주소 ?tab=으로 남겨 새로고침해도 같은 탭 */
const TABS = [
  { id: 'reports', label: '신고' },
  { id: 'checkout', label: '강제 퇴실' },
] as const
type Tab = (typeof TABS)[number]['id']

/**
 * 관리자 화면 (FR-WEB-101, FR-RPT-103·104). 링크는 관리자에게만 보이지만, 권한은 core가 막는다(아니면 403 ADMIN_ONLY).
 * 신고: 대기 신고를 증거 사진과 함께 보고 판정. 강제 퇴실: 예약 번호로 사용 중인 예약을 끝낸다
 */
export default function Admin() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab: Tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'reports'

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
              onClick={() => setParams({ tab: t.id }, { replace: true })}>{t.label}</button>
          ))}
        </div>
      </header>
      {tab === 'reports' && <AdminReports onForceCheckout={(id) => setParams({ tab: 'checkout', reservation: String(id) })} />}
      {tab === 'checkout' && <ForceCheckoutForm initialId={params.get('reservation') ?? ''} />}
    </main>
  )
}
