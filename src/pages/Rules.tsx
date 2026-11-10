import { useNavigate } from 'react-router-dom'
import { ROOM_RULES, type SignIcon } from '../content/rules'
import { BookingRules } from '../components/BookingRules'
import './Rules.css'

/**
 * FR-WEB-003 이용 규칙 (시안 RulesPage). 로그인 전에도 볼 수 있다.
 * 내 경고는 여기서 보이지 않는다(11/10 재웅: 규칙 보러 왔다가 기분 상하지 않게). 경고를 받으면 알림으로 오고, 기록은 마이 맨 아래 "내 경고"(/me/warnings).
 */
export default function Rules() {
  const navigate = useNavigate()
  return (
    <main className="rules-page">
      <header className="sub-head">
        <button type="button" className="back" aria-label="뒤로"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <h1>이용 규칙</h1>
      </header>

      <BookingRules />

      <section className="rules-signs-sec" aria-labelledby="room-title">
        <h2 id="room-title" className="sec-title">방에서</h2>
        <ul className="signs">
          {ROOM_RULES.map((r) => (
            <li key={r.tag} className={`sign ${r.ban ? 'ban' : 'do'}`}>
              <SignMark icon={r.icon} ban={!!r.ban} />
              <div className="sign-txt">
                <b>{r.sign}{r.ban && <span className="sr-only"> 금지</span>}</b>
                <span>{r.text}</span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rules-caution" aria-labelledby="sanction-title">
        <h2 id="sanction-title" className="sec-title">어기면</h2>
        <ol className="caution-steps">
          <li><b>경고</b><span>1회</span></li>
          <li><b>30일 안</b><span>3회</span></li>
          <li className="last"><b>정지</b><span>14일</span></li>
        </ol>
        <span className="muted small">노쇼는 30일 안 2번이면 바로 14일 정지. 정지되면 대표자·참여자 모두 예약할 수 없어요.</span>
      </section>

    </main>
  )
}

/** 표지판 그림. ban이면 원·사선을 겹친 금지 표지, 아니면 파란 안내 표지 */
const SIGN_PATHS: Record<SignIcon, string> = {
  food: 'M8 3v7a2 2 0 0 0 2 2v9M6 3v5M10 3v5M16 3c-1.7 0-3 2-3 5s1.3 4 3 4v9',
  noise: 'M4 9v6h4l5 4V5L8 9H4zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12',
  seat: 'M7 4h10v8H7zM5 12h14v3H5zM7 15v6M17 15v6',
  door: 'M6 21V4h10v17M4 21h16M13 12h.01M16 6l3 2v13',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  bag: 'M5 8h14l-1 13H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  camera: 'M4 8h4l2-3h4l2 3h4v12H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
}

function SignMark({ icon, ban }: { icon: SignIcon; ban: boolean }) {
  return (
    <svg className="sign-mark" viewBox="0 0 48 48" aria-hidden="true">
      {ban ? <circle cx="24" cy="24" r="21" className="sm-ring" /> : <rect x="3" y="3" width="42" height="42" rx="10" className="sm-plate" />}
      <g transform="translate(12 12)"><path d={SIGN_PATHS[icon]} className="sm-icon" /></g>
      {ban && <path d="M9.2 9.2 38.8 38.8" className="sm-slash" />}
    </svg>
  )
}
