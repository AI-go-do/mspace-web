import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { nowState, seoulClock, seoulDate } from '../lib/time'
import { roomLink } from '../lib/slots'
import { useNow } from '../lib/useNow'
import { applyBlocksAll, blockLabel } from '../lib/studentBlocks'
import { useStudentBlocks } from '../lib/useStudentBlocks'
import { REQUEST_TIMEOUT_MS } from './MyReservations'
import './MapPage.css'

/**
 * 배치도 탭 (시안 Map): 실제 배치 순서(창작실 5 → 1, 위 공작실, 오른쪽 복도·입구)로 방을 크게 놓고
 * 지금 비었는지 보여 준다. 방을 고르면 비어 있을 땐 지금 바로 쓰기(FR-WEB-102), 아니면 시간 고르기(FR-WEB-001)로 간다.
 */
export default function MapPage() {
  const navigate = useNavigate()
  const now = useNow()
  const [rooms, setRooms] = useState<RoomSlots[] | null>(null)
  const [sample, setSample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [picked, setPicked] = useState<number | null>(null)
  // 관리자가 막은 기간(Q-23): 지금 막힌 방은 "점검 중 · 12:00까지"처럼 사유로 보인다
  const blocks = useStudentBlocks()

  useEffect(() => {
    let alive = true
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    let active: AbortController | undefined
    // 날짜는 부를 때마다 다시 구한다: 자정이 지나면 새 날의 칸을 받는다.
    // 다음 요청은 앞 요청이 끝난 뒤(또는 시간 초과 뒤) 1분 있다가 보낸다. 요청이 겹치지 않는다.
    // 시간 초과로 버린 요청이 늦게 와도 마지막 요청의 결과만 쓴다.
    const load = () => {
      const mine = ++seq
      const abort = new AbortController()
      active = abort
      let limit: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<never>((_, reject) => {
        limit = setTimeout(() => {
          abort.abort()
          reject(new Error('응답이 늦어요.'))
        }, REQUEST_TIMEOUT_MS)
      })
      Promise.race([getAvailability(seoulDate(), abort.signal), timeout])
        .then((r) => {
          if (!alive || mine !== seq) return
          setRooms(r.data.rooms)
          setSample(r.sample)
          setUpdatedAt(new Date())
          setError(null)
        })
        .catch((e: Error) => {
          if (alive && mine === seq) setError(e.message)
        })
        .finally(() => {
          clearTimeout(limit)
          if (alive) timer = setTimeout(load, 60_000)
        })
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
      active?.abort()
    }
  }, [])

  const ordered = applyBlocksAll([...(rooms ?? [])], blocks, now).sort((a, b) => b.roomId - a.roomId)
  // 지금 상태 한 줄. 막힌 방은 사유와 풀리는 시각, 아니면 비어 있음·사용 중
  const stateOf = (r: RoomSlots) => {
    const st = nowState(r.slots, now, r.occupiedNow)
    return r.blockedNow ? { free: false, blocked: true, text: blockLabel(r.blockedNow, now) } : { ...st, blocked: false }
  }
  const room = ordered.find((r) => r.roomId === picked)

  return (
    <main className="map-page">
      <header className="sub-head">
        <div>
          <h1>방 고르기{sample && <span className="sample">예시</span>}</h1>
          <span className="muted small">지금 {seoulClock(now)} 기준 · 방을 누르고 시간을 정해요</span>
        </div>
      </header>

      <section className="card map-card" aria-label="M-space 배치도">
        <div className="map-legend">
          <span><i className="lg-free" />비어 있음</span>
          <span><i className="lg-busy" />사용 중</span>
          {ordered.some((r) => r.blockedNow) && <span><i className="lg-blocked" />막힘</span>}
          <span><i className="lg-on" />선택</span>
        </div>
        <div className="map-workshop">3D프린터 공작실 · 예약 대상 아님</div>
        {error && (
          <p role="alert" className="muted">
            방 현황을 못 불러왔어요. {error}
            {updatedAt && ` 아래 현황은 ${seoulClock(updatedAt)} 기준이라 지금과 다를 수 있어요.`}
          </p>
        )}
        {sample && <p role="status" className="muted small">서버에 닿지 않아 예시 현황을 보여 주고 있어요.</p>}
        <div className="map-floor">
          <div className="map-rooms">
            {ordered.map((r) => {
              const st = stateOf(r)
              const on = r.roomId === picked
              return (
                <button key={r.roomId} type="button" aria-pressed={on}
                  className={`map-room ${st.free ? 'free' : 'busy'} ${st.blocked ? 'blocked' : ''} ${on ? 'on' : ''}`}
                  aria-label={`창작실 ${r.roomId}, ${r.minPeople}–${r.maxPeople}명, ${st.text}`}
                  onClick={() => setPicked(r.roomId)}>
                  <span className="map-no">{r.roomId}</span>
                  <span className="map-text"><b>창작실 {r.roomId}</b><span>{r.minPeople}–{r.maxPeople}명 · {st.text}</span></span>
                </button>
              )
            })}
          </div>
          <div className="map-corridor" aria-hidden="true">
            <span className="map-corridor-label">복도</span>
            <span className="map-entrance">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#15233D"><path d="M12 5 21 19H3z" /></svg>입구
            </span>
          </div>
        </div>
      </section>

      {room && (
        <div className="map-bar">
          <div className="map-bar-row" key={room.roomId}>
            <b>창작실 {room.roomId}</b>
            <span className="muted">{room.minPeople}–{room.maxPeople}명 · {stateOf(room).text}{room.blockedNow?.memo ? ` (${room.blockedNow.memo})` : ''}</span>
          </div>
          {/* 지금 비어 있으면 지금 바로 쓰기가 기본(11/6 스크럼), 아니면 시간 고르기 */}
          {roomLink(room, now).startsWith('/now')
            ? <button type="button" className="btn-primary" onClick={() => navigate(roomLink(room, now))}>이 방 지금 바로 쓰기</button>
            : <button type="button" className="btn-primary" onClick={() => navigate(`/rooms/${room.roomId}`)}>이 방으로 시간 정하기</button>}
        </div>
      )}
    </main>
  )
}
