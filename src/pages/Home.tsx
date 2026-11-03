import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAvailability, type DayAvailability } from '../api/rooms'
import { isFreeNow, nowPercent, seoulClock, seoulDate, takenSegments } from '../lib/time'
import './Home.css'

/** FR-WEB-004 홈: 현장 배치도 순서(창작실 5 → 1)로 오늘 하루를 한 화면에 */
export default function Home() {
  const [day, setDay] = useState<DayAvailability | null>(null)
  const [sample, setSample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let alive = true
    const load = () =>
      getAvailability(seoulDate())
        .then((r) => {
          if (!alive) return
          setDay(r.data)
          setSample(r.sample)
          setError(null)
          setNow(new Date())
        })
        .catch((e: Error) => alive && setError(e.message))
    load()
    const t = setInterval(load, 60_000) // 1분마다 새로고침
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const rooms = [...(day?.rooms ?? [])].sort((a, b) => b.roomId - a.roomId)
  const freeCount = rooms.filter((r) => isFreeNow(r.slots, now)).length

  return (
    <main>
      <header className="home-head">
        <div className="home-top">
          <span className="home-brand">M-space</span>
          <Link to="/alerts" className="icon-btn" aria-label="알림">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8M10 20a2 2 0 0 0 4 0" />
            </svg>
          </Link>
        </div>
        <p className="home-sub">지금 {seoulClock(now)} · 비어 있는 방</p>
        <p className="home-count">
          <span className="dot-sky" aria-hidden="true" />
          {day ? `${rooms.length}개 중 ${freeCount}개` : '불러오는 중'}
          {sample && <span className="sample">예시</span>}
        </p>
        <div className="chips">
          <Link to="/now" className="chip">지금 바로 쓰기</Link>
          <Link to="/rules" className="chip">이용 규칙</Link>
        </div>
      </header>

      <section className="card today" aria-labelledby="today-title">
        <div className="today-head">
          <h2 id="today-title">오늘 방 현황</h2>
          <span className="muted legend">
            <i className="lg lg-taken" />예약 <i className="lg lg-mine" />내 예약
          </span>
        </div>

        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}

        <div className="floor">
          <div className="rooms">
            <div className="workshop">3D프린터 공작실</div>
            {rooms.map((r) => {
              const free = isFreeNow(r.slots, now)
              const pct = nowPercent(r.slots, now)
              return (
                <Link key={r.roomId} to={`/rooms/${r.roomId}`} className="room-row"
                  aria-label={`창작실 ${r.roomId}, ${free ? '지금 비어 있음' : '사용 중'}, ${r.minPeople}–${r.maxPeople}명`}>
                  <span className={`room-no ${free ? 'free' : ''}`}>{r.roomId}</span>
                  <span className="room-body">
                    <span className="bar" aria-hidden="true">
                      {takenSegments(r.slots, now).map((s) => (
                        <i key={s.from} className="seg" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {pct !== null && <i className="now" style={{ left: `${pct}%` }} />}
                    </span>
                    <span className="room-meta">
                      <b>{free ? '지금 비어 있음' : '사용 중'}</b>
                      <span className="muted">{r.minPeople}–{r.maxPeople}명</span>
                    </span>
                  </span>
                </Link>
              )
            })}
            <div className="hours muted" aria-hidden="true"><span>0</span><span>6</span><span>12</span><span>18</span><span>24</span></div>
          </div>
          <div className="corridor" aria-hidden="true">
            <span>복도</span>
            <span className="entrance">▲ 입구</span>
          </div>
        </div>
      </section>
    </main>
  )
}
