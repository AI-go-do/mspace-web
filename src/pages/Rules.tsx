import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getMyPenalty, penaltySummary, type MyPenalty } from '../api/penalties'
import { useAuth } from '../auth/AuthProvider'
import { BOOKING_FACTS, ROOM_RULES } from '../content/rules'
import { useMemberId } from '../lib/useMemberId'
import './Rules.css'

/**
 * FR-WEB-003 이용 규칙 (시안 RulesPage). 로그인 전에도 볼 수 있다.
 * 로그인했으면 위쪽에 "내 경고 N회"(GET /api/penalties/me, core #92)를 보여 준다.
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

      <MyPenaltyCard />

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
        <span className="muted small">노쇼는 따로 세요. 30일 안에 노쇼 2번이면 바로 14일 정지예요.</span>
        <span className="muted small">정지되면 대표자·참여자 모두 예약할 수 없어요. 고장 배상은 관리자가 따로 연락해요.</span>
      </section>
    </main>
  )
}

/**
 * 내 경고 횟수 카드. 로그인 전에는 그리지 않는다(이 화면은 로그인 없이도 열리고, 부르면 로그인 화면으로 보내질 수 있어서).
 * 회원이 바뀌면(공용 폰) 앞 사람 숫자를 버리고 새로 받는다
 */
function MyPenaltyCard() {
  const { status } = useAuth()
  const member = useMemberId()
  if (status !== 'in' || member === null) return null
  return <PenaltyFor key={member} member={member} />
}

/** 한 회원의 경고 카드: 받는 중 → 결과, 실패하면 [다시 받기]. 화면을 떠나면 늦게 온 답은 버린다 */
function PenaltyFor({ member }: { member: number }) {
  const [data, setData] = useState<MyPenalty | null>(null)
  const [error, setError] = useState<string | null>(null)
  // [다시 받기]를 누르면 1 올려서 다시 받는다
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    getMyPenalty(member)
      .then((p) => { if (alive) { setData(p); setError(null) } })
      .catch((e) => {
        if (!alive) return
        // 화면을 떠났거나 다른 회원으로 바뀐 경우(SESSION_CHANGED)는 key가 바뀌며 새로 그려지므로 알리지 않는다
        if (e instanceof ApiError && e.code === 'SESSION_CHANGED') return
        setError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : '연결이 고르지 않아요.')
      })
    return () => { alive = false }
  }, [member, attempt])

  // 읽기 도우미가 "불러오는 중 → 실패/결과" 바뀜을 놓치지 않게 알림 영역(aria-live)은 처음부터 하나로 둔다
  const s = data ? penaltySummary(data) : null
  const failed = error != null && data == null
  return (
    <section
      className={`card rules-me ${s?.warn ? 'warn' : ''}`}
      aria-label="내 경고"
      aria-live="polite"
      aria-busy={!s && !failed}
    >
      {failed ? (
        <>
          <b>내 경고 횟수를 못 불러왔어요</b>
          <span className="muted small">{error}</span>
          <button type="button" className="rules-me-retry" onClick={() => { setError(null); setAttempt((n) => n + 1) }}>다시 받기</button>
        </>
      ) : s ? (
        <>
          <b>{s.title}</b>
          {s.lines.map((l) => <span key={l} className="small">{l}</span>)}
        </>
      ) : (
        <b className="rules-me-wait">내 경고 확인 중…</b>
      )}
    </section>
  )
}
