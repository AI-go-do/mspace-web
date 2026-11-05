import { useEffect, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { getMyReservations, isActive, type MyReservation } from '../api/reservations'
import { getAvailability, type DayAvailability } from '../api/rooms'
import { isFreeNow, nowPercent, seoulClock, seoulDate, takenSegments } from '../lib/time'
import './Home.css'

/**
 * 하루 막대 배경 위치. 지금 위치를 모르면 아무 값도 주지 않아 전체가 회색(알 수 없음)이 된다.
 * 지금 칸이 사용 중이면 그 30분 칸 끝까지는 예약 색으로 칠한다(그 칸은 takenSegments에서 빠지므로).
 * 서버가 지금 사용 여부(occupiedNow)를 안 주면 지금 칸 끝까지는 회색(알 수 없음)으로 둔다
 */
function barStyle(pct: number | null, occupiedNow: boolean | undefined): CSSProperties | undefined {
  if (pct === null) return undefined
  const slotEnd = Math.min(100, (Math.floor((pct / 100) * 48) + 1) * (100 / 48))
  const style: Record<string, string> = { '--now': `${pct}%`, '--free-from': `${occupiedNow === false ? pct : slotEnd}%` }
  if (occupiedNow === undefined) style['--cur'] = 'var(--gray)'
  return style as CSSProperties
}

/** 하루 중 몇 시간째(14.5) → "14:30" */
const hm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${h % 1 ? '30' : '00'}`

/** FR-WEB-004 홈: 현장 배치도 순서(창작실 5 → 1)로 오늘 하루를 한 화면에 */
export default function Home() {
  const [day, setDay] = useState<DayAvailability | null>(null)
  const [sample, setSample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())
  const [mine, setMine] = useState<MyReservation[]>([])

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
    const loadMine = () =>
      getMyReservations()
        .then((list) => alive && setMine(list))
        .catch(() => { /* 내 예약을 못 받아도 홈 현황은 보여 준다 */ })
    load()
    loadMine()
    // 1분마다 시계를 넘기고 현황을 새로 받는다. 요청이 실패해도 시계는 계속 간다
    const t = setInterval(() => {
      setNow(new Date())
      load()
      loadMine()
    }, 60_000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [])

  const rooms = [...(day?.rooms ?? [])].sort((a, b) => b.roomId - a.roomId)
  const freeCount = rooms.filter((r) => isFreeNow(r.slots, now, r.occupiedNow)).length
  // 오늘 끝나지 않은 내 예약 → 막대를 노랑으로, 아래 카드로
  const today = seoulDate(now)
  const mineToday = mine.filter((m) => isActive(m.status) && seoulDate(new Date(m.startAt)) === today)
  const card = mineToday[0]

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
            {/* 지금 비어 있는 방이 있을 때만 바로 쓰기를 연다 (FR-WEB-102) */}
            {day && freeCount > 0
              ? <Link to="/now" className="chip chip-solid">지금 바로 쓰기</Link>
              : <span className="chip chip-off" aria-disabled="true">{day ? '지금 빈 방 없음' : '지금 바로 쓰기'}</span>}
            <Link to="/rules" className="chip chip-line">이용 규칙</Link>
          </div>
        </div>
      </header>

      <section className="card today" aria-labelledby="today-title">
        <div className="today-head">
          <h2 id="today-title">오늘 방 현황</h2>
          <span className="legend">
            <span><i className="lg lg-free" />빈 시간</span>
            <span><i className="lg lg-taken" />예약됨</span>
            <span><i className="lg lg-mine" />내 예약</span>
          </span>
        </div>
        <span className="guide">실제 배치 순서예요. 방을 누르면 바로 시간을 골라요.</span>

        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}

        <div className="workshop">3D프린터 공작실</div>
        <div className="floor">
          <div className="rooms">
            {rooms.map((r) => {
              const free = isFreeNow(r.slots, now, r.occupiedNow)
              const pct = nowPercent(r.slots, now)
              // 지금 시각이 시간표 밖이면(날이 바뀌었는데 새 시간표가 아직 없음) 옛 날의 비어 있음·사용 중을 보이지 않는다
              const status = pct === null ? '상태 확인 중' : free ? '지금 비어 있음' : '사용 중'
              const segs = takenSegments(r.slots, now)
              const day0 = r.slots.length ? Date.parse(r.slots[0].startAt) : 0
              const mySegs = mineToday.filter((m) => m.room.id === r.roomId)
                .map((m) => ({ from: (Date.parse(m.startAt) - day0) / 3_600_000, to: (Date.parse(m.endAt) - day0) / 3_600_000 }))
              // 막대는 aria-hidden이라, 예약 구간을 링크 이름에 글로 넣는다
              const schedule = (mySegs.length ? `내 예약 ${mySegs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}, ` : '') + (segs.length ? `남은 예약 ${segs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}` : '남은 예약 없음')
              return (
                <Link key={r.roomId} to={`/rooms/${r.roomId}`} className="room-row"
                  aria-label={`창작실 ${r.roomId}, ${status}, ${r.minPeople}–${r.maxPeople}명, ${schedule}`}>
                  <span className={`room-no ${free && pct !== null ? 'free' : ''}`}>{r.roomId}</span>
                  <span className="room-body">
                    <span className="bar" aria-hidden="true" style={barStyle(pct, r.occupiedNow)}>
                      {segs.map((s) => (
                        <i key={s.from} className="seg" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {mySegs.map((s) => (
                        <i key={`m${s.from}`} className="seg mine" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {pct !== null && <i className="now" style={{ left: `${pct}%` }} />}
                    </span>
                    <span className="room-meta"><b>{status}</b> · {r.minPeople}–{r.maxPeople}명</span>
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

      {card && (
        <Link to={`/reservations/${card.id}`} className="mine-card">
          <span className="mine-card-text">
            <span>내 예약 · 오늘 {seoulClock(new Date(card.startAt))}–{seoulClock(new Date(card.endAt))} · 창작실 {card.room.id}</span>
            <b>{card.owner ? '입실 번호 보기' : '예약 보기'}</b>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15233D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </Link>
      )}
    </main>
  )
}
