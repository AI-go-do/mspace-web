import { useEffect, useState, type CSSProperties } from 'react'
import { ApiError } from '../api/client'
import { getMyReservations, type MyReservation } from '../api/reservations'
import { timeRange } from '../lib/format'
import { myNoShows, NO_SHOW_RULES } from '../lib/noShows'
import { dayLabel } from '../lib/slots'
import { seoulDate } from '../lib/time'
import './PenaltyHistory.css'

/**
 * 내 경고 화면의 노쇼 기록 (11/12 지영). 위반 경고와 따로 센다(30일 2회면 14일 정지).
 * core에 노쇼 목록 API가 없어 내 예약에서 대표자 노쇼만 골라 보여 준다(lib/noShows)
 */
export function NoShowHistory({ member }: { member: number }) {
  const [list, setList] = useState<MyReservation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    getMyReservations(ctl.signal, member)
      .then((all) => { setList(myNoShows(all, new Date())); setError(null) })
      .catch((e) => {
        if (ctl.signal.aborted || (e instanceof ApiError && e.code === 'SESSION_CHANGED')) return
        setError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : '연결이 고르지 않아요.')
      })
    return () => ctl.abort()
  }, [member, attempt])

  const { windowDays, limit, suspendDays } = NO_SHOW_RULES
  const n = list?.length ?? 0
  return (
    <section className="card ph" aria-labelledby="ns-title" aria-live="polite" aria-busy={list === null && error === null}>
      <div className="ph-head">
        <h2 id="ns-title">노쇼 기록</h2>
        {list && <span className={`ph-pill ${n >= limit - 1 ? 'p-open' : ''}`}>최근 {windowDays}일 {n}회</span>}
      </div>
      <p className="ph-lead">최근 {windowDays}일 안에 노쇼가 {limit}회가 되면 {suspendDays}일 동안 예약·참여가 정지돼요. 노쇼는 대표자에게만 세요.</p>
      {error && list === null ? (
        <>
          <p className="ph-lead">노쇼 기록을 못 불러왔어요. {error}</p>
          <button type="button" className="rules-me-retry" onClick={() => { setError(null); setAttempt((x) => x + 1) }}>다시 받기</button>
        </>
      ) : list === null ? (
        <p className="ph-lead">노쇼 기록 확인 중…</p>
      ) : n === 0 ? (
        <p className="ph-lead"><b>최근 {windowDays}일 동안 노쇼가 없어요.</b></p>
      ) : (
        <ul className="ph-list">
          {list.map((r, i) => (
            <li key={r.id} className="ph-item" style={{ '--d': `${i * 70}ms` } as CSSProperties}>
              <div className="ph-top"><span className="ph-kind k-NO_SHOW">노쇼</span></div>
              <b className="ph-when">{r.room.name} · {dayLabel(seoulDate(new Date(r.startAt)))} {timeRange(r.startAt, r.endAt)}</b>
              <p className="ph-why">입실 시간 안에 들어오지 않아 예약이 풀렸어요.</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
