import { useEffect, useState, type CSSProperties } from 'react'
import { getReports, type AdminReport } from '../api/admin'
import { createBlock, mockReservations, useRoomBlocks } from '../api/roomBlocks'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { demoOn } from '../lib/demo'
import { timeRange } from '../lib/format'
import { demoBrokenReports as demoReports, proposeRests, REST_RULES, type RestProposal } from '../lib/roomRest'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import { useMemberId } from '../lib/useMemberId'
import './AdminRest.css'

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`
const SKIP_KEY = 'mspace:admin:restSkipped'
const REST_MEMO = '고장 신고가 쌓여 점검해요'

function readSkipped(): string[] {
  try { const v: unknown = JSON.parse(sessionStorage.getItem(SKIP_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [] } catch { return [] }
}

/** "3시간 전" / "25분 전" */
function ago(iso: string, now: Date): string {
  const m = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 60_000))
  return m < 60 ? `${m}분 전` : `${Math.floor(m / 60)}시간 전`
}

function when(p: Pick<RestProposal, 'startAt' | 'endAt'>): string {
  const s = new Date(p.startAt); const e = new Date(p.endAt)
  return `${dayLabel(seoulDate(s))} ${seoulClock(s)} → ${dayLabel(seoulDate(e))} ${seoulClock(e)}`
}

/**
 * 할 일 맨 위 "아픈 방 휴업안" (웹 화면만). 판정 안 된 비품 고장 신고(GET /api/reports?verdict=OPEN)가 한 방에 쌓이면
 * 그 방을 쉬게 하자는 카드를 띄운다. [쉬게 하기]는 기간 막기(점검)로 막고, [아직 괜찮아요]는 이 신고 묶음을 다시 묻지 않는다.
 * ?demo=1이면 3번 방 예시 신고 3건을 섞는다. 막기는 아직 가짜 저장소라 학생에게 알림이 가지 않는다
 */
export function RestProposals({ onOpenRooms }: { onOpenRooms: () => void }) {
  const member = useMemberId()
  const [reports, setReports] = useState<AdminReport[]>([])
  const [skipped, setSkipped] = useState<string[]>(readSkipped)
  const [rested, setRested] = useState<{ p: RestProposal; error: string | null }[]>([])
  const { blocks, canceled } = useRoomBlocks()

  useEffect(() => {
    if (member === null) return
    const ctrl = new AbortController()
    getReports('OPEN', ctrl.signal, member).then(setReports).catch(() => { /* 신고 판정 칸이 오류를 보여 준다. 여기서는 제안만 안 함 */ })
    return () => ctrl.abort()
  }, [member])

  const now = new Date()
  const source = demoOn() ? [...reports, ...demoBrokenReportsCached(now)] : reports
  const reservations = mockReservations(now).filter((r) => !canceled.includes(r.reservationId))
  const doneKeys = new Set(rested.map((r) => r.p.key))
  const list = proposeRests(source, blocks, reservations, now).filter((p) => !skipped.includes(p.key) && !doneKeys.has(p.key))

  function skip(p: RestProposal) {
    const next = [...skipped, p.key]
    setSkipped(next)
    try { sessionStorage.setItem(SKIP_KEY, JSON.stringify(next)) } catch { /* 이 화면에서만 기억 */ }
  }

  function rest(p: RestProposal) {
    const r = createBlock({ roomId: p.roomId, startAt: new Date(p.startAt), endAt: new Date(p.endAt), reason: 'INSPECTION', memo: REST_MEMO })
    setRested((x) => [...x, { p, error: 'error' in r ? r.error : null }])
  }

  if (list.length === 0 && rested.length === 0) return null
  return (
    <section className="rest" aria-label="아픈 방 휴업안">
      {rested.map(({ p, error }) => (
        <div key={p.key} className={`card rest-card done ${error ? 'err' : ''}`} role="status">
          {error ? (
            <p className="rest-done-text"><b>{roomName(p.roomId)}을 쉬게 하지 못했어요</b><span>{error}</span></p>
          ) : (
            <>
              <span className="rest-zzz" aria-hidden="true">z<i>z</i><i>z</i></span>
              <p className="rest-done-text">
                <b>{roomName(p.roomId)}이 쉬는 중이에요</b>
                <span>{when(p)} · 학생 화면에 "점검 중"으로 보여요{p.moves.length > 0 && `. 겹친 예약 ${p.moves.length}건은 방 관리에서 확인해 주세요`}</span>
              </p>
              <button type="button" className="adm-btn line rest-go" onClick={onOpenRooms}>방 관리에서 보기</button>
            </>
          )}
        </div>
      ))}
      {list.map((p, i) => <RestCard key={p.key} p={p} i={i} now={now} onRest={() => rest(p)} onSkip={() => skip(p)} />)}
    </section>
  )
}

/** 예시 신고는 화면을 다시 그려도 시각이 흔들리지 않게 처음 만든 것을 쓴다 */
let demoCache: AdminReport[] | null = null
function demoBrokenReportsCached(now: Date): AdminReport[] {
  if (!demoCache) demoCache = demoReports(now)
  return demoCache
}
function RestCard({ p, i, now, onRest, onSkip }: { p: RestProposal; i: number; now: Date; onRest: () => void; onSkip: () => void }) {
  const hours = Math.round((Date.parse(p.endAt) - Date.parse(p.startAt)) / 3_600_000)
  return (
    <article className="card rest-card" style={{ '--d': `${i * 80}ms` } as CSSProperties} aria-labelledby={`rest-h-${p.roomId}`}>
      <div className="rest-top">
        <span className="rest-room" aria-hidden="true">
          {p.roomId}
          <span className="rest-pulse" />
        </span>
        <div className="rest-title">
          <span className="rest-eyebrow">아픈 방 휴업안{p.reports.some((r) => r.id < 0) && <span className="rest-sample">예시</span>}</span>
          <h3 id={`rest-h-${p.roomId}`}>{roomName(p.roomId)}을 {hours}시간 쉬게 할까요?</h3>
        </div>
      </div>
      <p className="rest-why">최근 {REST_RULES.windowHours}시간 안에 비품 고장 신고가 <b>{p.reports.length}건</b> 쌓였어요.</p>
      <ol className="rest-reports">
        {p.reports.map((r, j) => (
          <li key={r.id} style={{ '--d': `${120 + j * 90}ms` } as CSSProperties}>
            <span className="rest-ago">{ago(r.createdAt, now)}</span>
            <span>"{r.content || '내용 없음'}"</span>
          </li>
        ))}
      </ol>
      <dl className="rest-plan">
        <div><dt>쉬는 시간</dt><dd>{when(p)} <small>고치면 [막기 풀기]</small></dd></div>
        <div>
          <dt>겹친 예약</dt>
          <dd>
            {p.moves.length === 0 ? '없어요' : (
              <ul className="rest-moves">
                {p.moves.map((m) => (
                  <li key={m.reservation.reservationId}>
                    #{m.reservation.reservationId} · {dayLabel(seoulDate(new Date(m.reservation.startAt)))} {timeRange(m.reservation.startAt, m.reservation.endAt)} · {m.reservation.people}명
                    <span className={`rest-alt ${m.rooms.length ? '' : 'none'}`}>
                      {m.rooms.length ? `옮길 수 있는 방: ${m.rooms.map((id) => `${id}번`).join('·')}` : '옮길 방 없음'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      </dl>
      <div className="rest-actions">
        <button type="button" className="adm-btn" onClick={onRest}>쉬게 하기</button>
        <button type="button" className="adm-btn line" onClick={onSkip}>아직 괜찮아요</button>
      </div>
      <p className="adm-foot">기간 막기(점검)로 막아요. 경고·벌과는 상관없어요. 가짜 값 단계라 학생에게 알림은 가지 않아요.</p>
    </article>
  )
}
