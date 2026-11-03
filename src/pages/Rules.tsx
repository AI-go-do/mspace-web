import { useNavigate } from 'react-router-dom'
import { BOOKING_FACTS, ROOM_RULES } from '../content/rules'
import './Rules.css'

/**
 * FR-WEB-003 이용 규칙 (시안 RulesPage). 로그인 전에도 볼 수 있다.
 * "내 경고 N회"는 경고 API(FR-RPT-104)가 생기면 제목 옆에 붙인다.
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

      <section className="card rules-sec" aria-labelledby="booking-title">
        <h2 id="booking-title">예약 규칙</h2>
        <div className="facts">
          {BOOKING_FACTS.map((f) => (
            <div key={f.big} className={`fact ${f.strong ? 'hl' : ''}`}><b>{f.big}</b><span>{f.small}</span></div>
          ))}
        </div>
      </section>

      <section className="card rules-sec" aria-labelledby="room-title">
        <h2 id="room-title">방에서 지킬 것</h2>
        <dl className="room-rules">
          {ROOM_RULES.map((r) => (
            <div key={r.tag}>
              <dt>{r.tag}</dt>
              <dd>{r.lead && <b>{r.lead} </b>}{r.text}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="card rules-sec" aria-labelledby="sanction-title">
        <h2 id="sanction-title">어기면</h2>
        <ol className="steps-line">
          <li>경고 1회</li>
          <li>30일 안 3회</li>
          <li className="last">14일 정지</li>
        </ol>
        <span className="muted small">정지되면 대표자·참여자 모두 예약할 수 없어요. 고장 배상은 관리자가 따로 연락해요.</span>
      </section>
    </main>
  )
}
