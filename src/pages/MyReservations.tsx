import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getMyReservations, isActive, STATUS_LABEL, type MyReservation } from '../api/reservations'
import { useAuth } from '../auth/AuthProvider'
import { minutesLabel, timeRange, whenLabel } from '../lib/format'
import { useNow } from '../lib/useNow'
import './Mine.css'

const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
)

/** 다른 화면에서도 쓰는 내 예약 목록 받기 */
export function useMyReservations() {
  const [list, setList] = useState<MyReservation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reload = useCallback(
    () => getMyReservations().then((l) => { setList(l); setError(null) }).catch((e: Error) => setError(e.message)),
    [],
  )
  useEffect(() => {
    reload()
  }, [reload])
  return { list, error, reload }
}

/**
 * FR-WEB-002 내 예약 (시안 Mine): 사용 중인 예약은 맨 위 카드(남은 시간 + 진행 막대 + 퇴실),
 * 다가오는 예약은 눌러서 상세(취소), 지난 예약은 따로.
 * 입실·퇴실 사진과 "방에 문제가 있나요?"는 v0.3(FR-RPT-101)이라 아직 없다.
 */
export default function MyReservations() {
  const { list, error } = useMyReservations()
  const { logout } = useAuth()
  const now = useNow()
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming')

  const active = (list ?? []).filter((r) => isActive(r.status))
  const past = (list ?? []).filter((r) => !isActive(r.status))
  const inUse = active.find((r) => r.status === 'IN_USE')
  const upcoming = active.filter((r) => r !== inUse)

  return (
    <main className="mine">
      <header className="mine-head">
        <h1>내 예약</h1>
        <div className="seg-tabs" role="group" aria-label="보기">
          <button type="button" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>다가오는</button>
          <button type="button" aria-pressed={tab === 'past'} onClick={() => setTab('past')}>지난</button>
        </div>
      </header>

      {error && <p role="alert" className="card mine-msg">내 예약을 못 불러왔어요. {error}</p>}
      {!list && !error && <p className="card mine-msg muted" role="status">불러오는 중…</p>}

      {list && tab === 'upcoming' && (
        <>
          {inUse && <InUseCard r={inUse} now={now} />}
          {upcoming.map((r) => (
            <Link key={r.id} to={`/me/${r.id}`} className="card mine-item">
              <span className="mine-item-text">
                <span className="muted">곧 쓸 예약 · {r.owner ? '대표자' : '참여자'}</span>
                <b>{whenLabel(r.startAt, now)} · 창작실 {r.room.id}</b>
                <span className="muted">{timeRange(r.startAt, r.endAt)}</span>
              </span>
              <Chevron />
            </Link>
          ))}
          {active.length === 0 && (
            <div className="card mine-empty">
              <b>다가오는 예약이 없어요</b>
              <span className="muted">홈에서 방을 누르면 바로 시간을 골라요.</span>
              <Link to="/" className="link">방 고르러 가기</Link>
            </div>
          )}
        </>
      )}

      {list && tab === 'past' && (
        <>
          {past.map((r) => (
            <Link key={r.id} to={`/me/${r.id}`} className="card mine-item">
              <span className="mine-item-text">
                <span className="muted">{STATUS_LABEL[r.status]} · {r.owner ? '대표자' : '참여자'}</span>
                <b>{whenLabel(r.startAt, now)} · 창작실 {r.room.id}</b>
                <span className="muted">{timeRange(r.startAt, r.endAt)}</span>
              </span>
              <Chevron />
            </Link>
          ))}
          {past.length === 0 && <p className="card mine-msg muted">지난 예약이 없어요.</p>}
        </>
      )}

      <div className="mine-foot">
        <Link to="/rules" className="link">이용 규칙</Link>
        <button type="button" className="link-btn" onClick={() => logout()}>로그아웃</button>
      </div>
    </main>
  )
}

/** 지금 사용 중 카드: 방·시간·인원·남은 시간(숫자 + 막대)·퇴실 */
function InUseCard({ r, now }: { r: MyReservation; now: Date }) {
  const start = Date.parse(r.startAt)
  const end = Date.parse(r.endAt)
  const left = (end - now.getTime()) / 60_000
  const done = Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100))
  const elapsed = minutesLabel((now.getTime() - start) / 60_000)
  const total = minutesLabel((end - start) / 60_000)
  return (
    <section className="inuse" aria-label="지금 사용 중인 예약">
      <div className="inuse-top">
        <div className="inuse-info">
          <span className="inuse-state"><i aria-hidden="true" />지금 사용 중</span>
          <b className="inuse-room">창작실 {r.room.id}</b>
          <span className="inuse-sub">{timeRange(r.startAt, r.endAt)} · {r.participants.length}명</span>
        </div>
        <div className="inuse-left">
          <span>남은 시간</span>
          <b>{minutesLabel(left)}</b>
        </div>
      </div>
      <div className="inuse-bar" role="img" aria-label={`${total} 중 ${elapsed} 지남`}>
        <i style={{ width: `${done}%` }} />
      </div>
      {r.owner ? (
        <Link to={`/me/${r.id}/checkout`} className="inuse-btn">다 썼어요, 퇴실</Link>
      ) : (
        <span className="inuse-note">퇴실은 대표자가 해요</span>
      )}
      {r.owner && <Link to={`/reservations/${r.id}`} className="inuse-link">입실 번호 다시 보기</Link>}
    </section>
  )
}
