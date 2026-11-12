import { useEffect, useState, type CSSProperties } from 'react'
import { ApiError } from '../api/client'
import { getMyNoShows, type MyNoShow } from '../api/penalties'
import { getMyReservations } from '../api/reservations'
import { timeRange } from '../lib/format'
import { countedTotals, fromReservations, NO_SHOW_RULES } from '../lib/noShows'
import { dayLabel } from '../lib/slots'
import { seoulDate } from '../lib/time'
import './PenaltyHistory.css'

/** core #128이 아직 없으면(404) 내 예약의 노쇼로 대신 */
async function load(member: number, signal: AbortSignal): Promise<MyNoShow[]> {
  try {
    return await getMyNoShows(member, NO_SHOW_RULES.windowDays, signal)
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e
    return fromReservations(await getMyReservations(signal, member), new Date())
  }
}

const KIND = { NO_SHOW: '노쇼', AWAY_RELEASED: '자리 비움' } as const
const WHY = { NO_SHOW: '입실 시간 안에 들어오지 않아 예약이 풀렸어요.', AWAY_RELEASED: '자리를 오래 비워 자동으로 퇴실됐어요.' } as const

/**
 * 내 경고 화면의 노쇼 기록 (11/12 지영). 위반 경고와 따로 센다(30일 2회면 14일 정지, 자리 비움 3번 = 노쇼 1번).
 * 본인이 대표자인 것만(벌칙은 대표자에게). 무른 노쇼는 줄을 긋고 "셈에서 빠짐"
 */
export function NoShowHistory({ member }: { member: number }) {
  const [list, setList] = useState<MyNoShow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    const ctl = new AbortController()
    load(member, ctl.signal)
      .then((items) => { setList(items); setError(null) })
      .catch((e) => {
        if (ctl.signal.aborted || (e instanceof ApiError && e.code === 'SESSION_CHANGED')) return
        setError(e instanceof ApiError && e.status !== 0 && e.status < 500 ? e.message : '연결이 고르지 않아요.')
      })
    return () => ctl.abort()
  }, [member, attempt])

  const { windowDays, limit, suspendDays } = NO_SHOW_RULES
  const t = list ? countedTotals(list) : null
  return (
    <section className="card ph" aria-labelledby="ns-title" aria-live="polite" aria-busy={list === null && error === null}>
      <div className="ph-head">
        <h2 id="ns-title">노쇼 기록</h2>
        {t && <span className={`ph-pill ${t.noShows >= limit - 1 ? 'p-open' : ''}`}>노쇼 {t.noShows}회{t.awayReleases > 0 ? ` · 자리 비움 ${t.awayReleases}회` : ''}</span>}
      </div>
      <p className="ph-lead">최근 {windowDays}일 안에 노쇼가 {limit}회가 되면 {suspendDays}일 동안 예약·참여가 정지돼요. 자리 비움 자동 퇴실 3번은 노쇼 1번으로 세요. 대표자에게만 세요.</p>
      {error && list === null ? (
        <>
          <p className="ph-lead">노쇼 기록을 못 불러왔어요. {error}</p>
          <button type="button" className="rules-me-retry" onClick={() => { setError(null); setAttempt((x) => x + 1) }}>다시 받기</button>
        </>
      ) : list === null ? (
        <p className="ph-lead">노쇼 기록 확인 중…</p>
      ) : list.length === 0 ? (
        <p className="ph-lead"><b>최근 {windowDays}일 동안 노쇼가 없어요.</b></p>
      ) : (
        <ul className="ph-list">
          {list.map((r, i) => (
            <li key={`${r.kind}-${r.reservationId}`} className={`ph-item ${r.counted ? '' : 't-done'}`} style={{ '--d': `${i * 70}ms` } as CSSProperties}>
              <div className="ph-top">
                <span className="ph-kind k-NO_SHOW">{KIND[r.kind]}</span>
                {!r.counted && <span className="ph-pill p-done">{r.excusedAt ? '무름 · 셈에서 빠짐' : '셈에서 빠짐'}</span>}
              </div>
              <b className={`ph-when ${r.counted ? '' : 'struck'}`}>{r.roomName} · {dayLabel(seoulDate(new Date(r.startAt)))} {timeRange(r.startAt, r.endAt)}</b>
              <p className="ph-why">{r.excusedAt ? '장치 오류가 확인돼 노쇼를 물렀어요.' : WHY[r.kind]}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
