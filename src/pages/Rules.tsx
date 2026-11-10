import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getMyPenalty, penaltySummary, type MyPenalty } from '../api/penalties'
import { useAuth } from '../auth/AuthProvider'
import { PenaltyHistory } from '../components/PenaltyHistory'
import { ROOM_RULES, type SignIcon } from '../content/rules'
import { BookingRules } from '../components/BookingRules'
import { demoOn } from '../lib/demo'
import { useMemberId } from '../lib/useMemberId'
import './Rules.css'

/**
 * FR-WEB-003 이용 규칙 (시안 RulesPage). 로그인 전에도 볼 수 있다.
 * 로그인했으면 위쪽에 "내 경고 N회"(GET /api/penalties/me, core #92)를 보여 준다.
 * ?demo=1이면 그 아래에 경고마다 왜 받았는지·근거 기록·경고 철회 요청(FR-RPT-105, 웹 화면만)을 예시로 보여 준다.
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

      <MyWarnings />
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

/** 경고 목록·철회 요청: core #111 API가 없어 예시 화면(?demo=1)에서 로그인했을 때만 */
function MyWarnings() {
  const { status } = useAuth()
  if (status !== 'in' || !demoOn()) return null
  return <PenaltyHistory />
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
