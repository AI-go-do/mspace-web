import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getAvailability, type DayAvailability } from '../api/rooms'
import { isFreeNow, nowPercent, seoulClock, seoulDate, takenSegments } from '../lib/time'
import './Home.css'

/** 하루 중 몇 시간째(14.5) → "14:30" */
const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`

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
        })
        .catch((e: Error) => alive && setError(e.message))
    load()
    // 1분마다 시계를 넘기고 현황을 새로 받는다. 요청이 실패해도 시계는 계속 간다
    const t = setInterval(() => {
      setNow(new Date())
      load()
    }, 60_000)
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
        {/* 캠퍼스 선 그림(시안과 같음) */}
        <svg className="campus" viewBox="0 0 390 120" width="390" height="120" aria-hidden="true">
          <g fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M60 110 V70 L77 52 L94 70 L111 52 L128 70 L145 52 L162 70 V40 L190 6 L218 40 V70 L235 52 L252 70 L269 52 L286 70 L303 52 L320 70 V110 Z" />
            <path d="M60 70 H320" /><circle cx="190" cy="52" r="6" /><path d="M182 110 V96 a8 8 0 0 1 16 0 V110" />
          </g>
        </svg>
        <div className="home-top">
          <span className="home-brand">M-space</span>
          <Link to="/alerts" className="icon-btn" aria-label="알림">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </Link>
        </div>
        <div className="home-now">
          <span className="home-sub">지금 {seoulClock(now)} · 비어 있는 방</span>
          <span className="home-count">
            <span className="dot-sky" aria-hidden="true" />
            {day ? `${rooms.length}개 중 ${freeCount}개` : '불러오는 중'}
            {sample && <span className="sample">예시</span>}
          </span>
          <div className="chips">
            <Link to="/now" className="chip chip-solid">지금 바로 쓰기</Link>
            <Link to="/rules" className="chip chip-line">이용 규칙</Link>
          </div>
        </div>
      </header>

      <section className="card today" aria-labelledby="today-title">
        <div className="today-head">
          <h2 id="today-title">오늘 방 현황</h2>
          <span className="legend">
            <span><i className="lg lg-taken" />예약</span>
            <span><i className="lg lg-mine" />내 예약</span>
          </span>
        </div>
        <span className="guide">실제 배치 순서예요. 방을 누르면 바로 시간을 골라요.</span>

        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}

        <div className="workshop">3D프린터 공작실</div>
        <div className="floor">
          <div className="rooms">
            {rooms.map((r) => {
              const free = isFreeNow(r.slots, now)
              const pct = nowPercent(r.slots, now)
              const segs = takenSegments(r.slots, now)
              // 막대는 aria-hidden이라, 예약 구간을 링크 이름에 글로 넣는다
              const schedule = segs.length ? `남은 예약 ${segs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}` : '남은 예약 없음'
              return (
                <Link key={r.roomId} to={`/rooms/${r.roomId}`} className="room-row"
                  aria-label={`창작실 ${r.roomId}, ${free ? '지금 비어 있음' : '사용 중'}, ${r.minPeople}–${r.maxPeople}명, ${schedule}`}>
                  <span className={`room-no ${free ? 'free' : ''}`}>{r.roomId}</span>
                  <span className="room-body">
                    <span className="bar" aria-hidden="true">
                      {segs.map((s) => (
                        <i key={s.from} className="seg" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {pct !== null && <i className="now" style={{ left: `${pct}%` }} />}
                    </span>
                    <span className="room-meta"><b>{free ? '지금 비어 있음' : '사용 중'}</b> · {r.minPeople}–{r.maxPeople}명</span>
                  </span>
                </Link>
              )
            })}
          </div>
          <div className="corridor" aria-hidden="true">
            <span className="corridor-label">복도</span>
            <span className="entrance">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="#15233D"><path d="M12 5 21 19H3z" /></svg>입구
            </span>
          </div>
        </div>
        <div className="hours" aria-hidden="true"><span>0시</span><span>12시</span><span>24시</span></div>
      </section>
    </main>
  )
}
