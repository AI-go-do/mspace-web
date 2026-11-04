import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { nowState, seoulClock, seoulDate } from '../lib/time'
import { useNow } from '../lib/useNow'
import './MapPage.css'

/**
 * 배치도 탭 (시안 Map): 실제 배치 순서(창작실 5 → 1, 위 공작실, 오른쪽 복도·입구)로 방을 크게 놓고
 * 지금 비었는지 보여 준다. 방을 고르면 그 방의 시간 고르기(FR-WEB-001)로 간다.
 */
export default function MapPage() {
  const navigate = useNavigate()
  const now = useNow()
  const [rooms, setRooms] = useState<RoomSlots[] | null>(null)
  const [sample, setSample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    // 날짜는 부를 때마다 다시 구한다: 자정이 지나면 새 날의 칸을 받는다
    const load = () =>
      getAvailability(seoulDate())
        .then((r) => {
          if (!alive) return
          setRooms(r.data.rooms)
          setSample(r.sample)
          setError(null)
        })
        .catch((e: Error) => alive && setError(e.message))
    load()
    // 화면을 켜 둔 동안 다른 사람의 예약·취소가 보이도록 1분마다 새로 받는다(홈과 같은 주기)
    const t = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const ordered = [...(rooms ?? [])].sort((a, b) => b.roomId - a.roomId)
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
          <span><i className="lg-on" />선택</span>
        </div>
        <div className="map-workshop">3D프린터 공작실 · 예약 대상 아님</div>
        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}
        {sample && <p role="status" className="muted small">서버에 닿지 않아 예시 현황을 보여 주고 있어요.</p>}
        <div className="map-floor">
          <div className="map-rooms">
            {ordered.map((r) => {
              const st = nowState(r.slots, now)
              const on = r.roomId === picked
              return (
                <button key={r.roomId} type="button" aria-pressed={on}
                  className={`map-room ${st.free ? 'free' : 'busy'} ${on ? 'on' : ''}`}
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
          <div className="map-bar-row">
            <b>창작실 {room.roomId}</b>
            <span className="muted">{room.minPeople}–{room.maxPeople}명 · {nowState(room.slots, now).text}</span>
          </div>
          <button type="button" className="btn-primary" onClick={() => navigate(`/rooms/${room.roomId}`)}>이 방으로 시간 정하기</button>
        </div>
      )}
    </main>
  )
}
