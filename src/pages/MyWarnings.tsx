import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import { getMyPenalty, penaltySummary, type MyPenalty } from '../api/penalties'
import { useAuth } from '../auth/AuthProvider'
import { PenaltyHistory } from '../components/PenaltyHistory'
import { demoOn } from '../lib/demo'
import { useMemberId } from '../lib/useMemberId'
import './Rules.css'

/**
 * 내 경고 (FR-WEB-003·FR-RPT-105). 11/10 재웅: 이용 규칙 맨 위에 두면 규칙 보러 온 학생이 기분 상할 수 있어 마이 맨 아래로 옮겼다.
 * 경고를 받으면 알림(WARNING)으로 먼저 알고, 여기서 횟수와(예시 화면에서) 경고마다 근거·철회 요청을 본다.
 */
export default function MyWarningsPage() {
  const navigate = useNavigate()
  return (
    <main className="rules-page">
      <header className="sub-head">
        <button type="button" className="back" aria-label="뒤로"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/me'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <h1>내 경고</h1>
      </header>
      <MyPenaltyCard />
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

