import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import Spacey from '../components/Spacey'
import { getMyReservations, isActive, type MyReservation } from '../api/reservations'
import { getAvailability, type DayAvailability, type RoomSlots } from '../api/rooms'
import { getSchedule, type Schedule } from '../api/schedule'
import ApologyCard from '../components/ApologyCard'
import ButlerCard from '../components/ButlerCard'
import { RelayCard } from '../components/Relay'
import { butlerSuggestion } from '../lib/butler'
import { isFreeNow, nowPercent, seoulClock, seoulDate, takenSegments } from '../lib/time'
import { roomLink } from '../lib/slots'
import { useCountUp } from '../lib/useCountUp'
import { useMemberId } from '../lib/useMemberId'
import { useWatched } from '../lib/watch'
import { useUnreadCount } from '../lib/useUnreadCount'
import { useApology } from '../lib/useApology'
import { useRelayOffer } from '../lib/useRelay'
import { applyBlocksAll, blockedSegments, blockLabel } from '../lib/studentBlocks'
import { useStudentBlocks } from '../lib/useStudentBlocks'
import { ClimateCard } from '../components/Climate'
import { mockEnvironment } from '../api/environmentMock'
import { noteCo2Demo } from '../api/co2Alert'
import { announceUnreadChanged } from '../api/notifications'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView } from '../lib/roomHealth'
import { demoOn } from '../lib/demo'
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
  // 내 예약을 한 번이라도 받았는지. 받기 전에는 비서 카드를 내지 않는다(급한 연장·입실 대신 낮은 제안이 먼저 보이지 않게)
  const [mineLoaded, setMineLoaded] = useState(false)
  // 내 시간표(비서 서버). undefined = 아직 못 받음(비서가 꺼져 있어도 홈은 그대로), null = 아직 안 넣음
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined)
  const unread = useUnreadCount()
  // 방의 사과(Q-19): 장치 오류로 붙은 노쇼 경고를 방이 물렀으면 맨 위에서 먼저 사과한다
  const { apology, close: closeApology } = useApology()
  // 빈방 지켜보기: 사용 중인 방 줄의 눈 표시. 켜 두면 그 방이 비는 순간 비서 카드가 먼저 말을 건다
  const member = useMemberId()
  const { watched, toggle, unwatch } = useWatched(member, now)
  // 빈방 릴레이(Q-18): 기다리던 칸이 나에게 넘어오면 받을 시간이 짧아서 맨 위에 먼저 보인다
  const { offer, decline } = useRelayOffer(now)
  // 관리자가 막은 기간(Q-23): 막힌 칸은 예약으로, 지금 막힌 방은 "점검 중"처럼 사유로 보인다
  const blocks = useStudentBlocks()

  useEffect(() => {
    let alive = true
    // 시간표는 자주 바뀌지 않아 화면을 열 때 한 번만 받는다. 못 받으면 수업 끝 제안만 빠진다
    getSchedule().then((s) => alive && setSchedule(s)).catch(() => {})
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
        .then((list) => {
          if (!alive) return
          setMine(list)
          setMineLoaded(true)
        })
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

  const rooms = applyBlocksAll([...(day?.rooms ?? [])], blocks, now).sort((a, b) => b.roomId - a.roomId)
  /**
   * 지금 상태를 아는 방만 비어 있음·사용 중으로 본다. 서버가 occupiedNow를 안 줬거나(예전 core)
   * 지금 시각이 시간표 밖이면(날이 바뀌고 새 시간표가 아직 없음) 알 수 없음으로 둔다
   */
  const known = (r: RoomSlots) => r.occupiedNow !== undefined && nowPercent(r.slots, now) !== null
  const freeCount = rooms.filter((r) => known(r) && isFreeNow(r.slots, now, r.occupiedNow)).length
  const freeShown = useCountUp(day ? freeCount : null)
  // 오늘 끝나지 않은 내 예약 → 막대를 노랑으로, 아래 카드로
  const today = seoulDate(now)
  // 어제 시작해 자정을 넘겨 오늘까지 쓰는 예약(23:00–01:00)도 오늘 것으로 본다. 막대에서는 0시부터 그린다
  const dayStart = Date.parse(`${today}T00:00:00+09:00`)
  const mineToday = mine.filter((m) => isActive(m.status)
    && (seoulDate(new Date(m.startAt)) === today || (Date.parse(m.startAt) < dayStart && Date.parse(m.endAt) > dayStart)))
  const card = mineToday[0]
  // 비서가 먼저 말을 거는 한 가지(연장 → 입실 → 지켜보던 방이 빔 → 수업 끝 제안 → 시간표 권유). 현황과 내 예약을 받기 전에는 없다
  const butler = day && mineLoaded ? butlerSuggestion({ mine, rooms, schedule, watched }, now) : null
  // 지켜보던 방이 처음 비는 순간 한 번 진동(앱을 열어 둔 채 기다리는 사람에게). 같은 방은 다시 울리지 않는다
  const buzzed = useRef<Set<number>>(new Set())
  useEffect(() => {
    if (!butler || butler.kind !== 'roomFree' || buzzed.current.has(butler.roomId)) return
    buzzed.current.add(butler.roomId)
    try { navigator.vibrate?.([60, 80, 60]) } catch { /* 진동 없는 기기 */ }
  }, [butler])

  // 내 방 공기(예시 화면 ?demo=1만): 입실한(IN_USE) 내 예약 방에만 나온다. 예약만 하고 입실 전이거나 끝난 방은 켜고 끌 수 없어서 안 보인다.
  // 센서 값은 아직 가짜(학생용 센서 API가 생기면 바꾼다)
  const inUse = mine.find((m) => m.status === 'IN_USE')
  const inRoom = inUse?.room.id ?? null
  const inUseId = inUse?.id ?? null
  const climate = useMemo(() => {
    if (!demoOn() || inRoom === null) return null
    const env = mockEnvironment(now, ENV_RULES.historyMinutes).rooms.find((r) => r.roomId === inRoom)
    // 내가 입실해 있으니 이 방은 "사람 있음". 가짜 값이 빈 방이라고 해도 "빈 방이라 끄기"를 권하지 않게 맞춘다
    return env ? toRoomView({ ...env, presence: 'OCCUPIED' }, ADMIN_ROOMS.find((c) => c.roomId === inRoom), now) : null
  }, [now, inRoom])
  const climateUrgent = !!climate && (climate.flags.co2Soon || climate.flags.co2Over)
  // "숨 막히기 N분 전"이 처음 뜨면 알림함에 한 번 넣는다(예약당 최대 2번, api/co2Alert.ts). 창문은 자동으로 못 열어서 알림으로 알린다
  useEffect(() => {
    if (!climate || inUseId === null || !demoOn()) return
    if (noteCo2Demo(inUseId, climate, now)) announceUnreadChanged()
  }, [climate, inUseId, now])

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
          <Link to="/alerts" className="icon-btn" aria-label={unread ? `알림, 안 읽은 알림 ${unread}개` : '알림'}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            {!!unread && <span className="bell-badge" aria-hidden="true">{unread > 9 ? '9+' : unread}</span>}
          </Link>
        </div>
        <div className="home-now">
          <span className="home-sub">지금 {seoulClock(now)} · 비어 있는 방</span>
          <span className="home-count">
            <span className="dot-sky" aria-hidden="true" />
            {day
              ? <span><span aria-hidden="true">{rooms.length}개 중 <b className="count-num">{freeShown}</b>개</span><span className="sr-only">{rooms.length}개 중 {freeCount}개</span></span>
              : '불러오는 중'}
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

      {/* 말 몇 마디로 예약 (FR-AGT-105, 11/9 회의). 비서 화면이 "언제, 몇 명이서?"로 시작한다 */}
      <Link to="/assistant?quick=1" className="card quick-ai">
        <Spacey size={36} />
        <span className="quick-ai-text">
          <strong>AI로 간단히 예약하기</strong>
          <span className="muted">"내일 3시, 4명" 한마디면 돼요</span>
        </span>
        <span className="quick-ai-go" aria-hidden="true">›</span>
      </Link>

      {offer && <RelayCard key={offer.id} o={offer} onDecline={decline} />}
      {butler && <ButlerCard key={butler.kind} s={butler} now={now} onGo={butler.kind === 'roomFree' ? () => unwatch(butler.roomId) : undefined} />}
      {apology && <ApologyCard key={apology.id} n={apology} now={now} onClose={closeApology} />}
      {/* 숨 막히기 직전·넘음이면 방 현황보다 먼저 */}
      {climate && climateUrgent && <ClimateCard view={climate} now={now} top />}

      <section className="card today" aria-labelledby="today-title">
        <div className="today-head">
          <h2 id="today-title">오늘 방 현황</h2>
          <span className="legend">
            <span><i className="lg lg-free" />빈 시간</span>
            <span><i className="lg lg-taken" />예약됨</span>
            <span><i className="lg lg-mine" />내 예약</span>
          </span>
        </div>
        <span className="guide">실제 배치 순서예요. 빈 방을 누르면 지금 바로 쓰고, 사용 중인 방은 시간을 골라 예약해요.</span>

        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}

        <div className="workshop">3D프린터 공작실</div>
        <div className="floor">
          <div className="rooms">
            {/* 처음 받는 동안 방 다섯 줄 자리를 미리 그려 둔다(화면이 튀지 않게) */}
            {!day && !error && Array.from({ length: 5 }, (_, i) => (
              <span key={i} className="room-row skeleton" aria-hidden="true">
                <span className="room-no" /><span className="room-body"><span className="bar" /><span className="sk-line" /></span>
              </span>
            ))}
            {rooms.map((r) => {
              const pct = nowPercent(r.slots, now)
              const free = known(r) && isFreeNow(r.slots, now, r.occupiedNow)
              const status = r.blockedNow ? blockLabel(r.blockedNow, now) : !known(r) ? '상태 확인 중' : free ? '지금 비어 있음' : '사용 중'
              const segs = takenSegments(r.slots, now)
              const blockSegs = blockedSegments(r.slots, now)
              const day0 = r.slots.length ? Date.parse(r.slots[0].startAt) : 0
              const mySegs = mineToday.filter((m) => m.room.id === r.roomId)
                .map((m) => ({ from: Math.max(0, (Date.parse(m.startAt) - day0) / 3_600_000), to: Math.min(24, (Date.parse(m.endAt) - day0) / 3_600_000) }))
              // 막대는 aria-hidden이라, 예약 구간을 링크 이름에 글로 넣는다
              const schedule = (mySegs.length ? `내 예약 ${mySegs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}, ` : '') + (segs.length ? `남은 예약 ${segs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}` : '남은 예약 없음')
                + (blockSegs.length ? `, 예약 막힘 ${blockSegs.map((s) => `${hm(s.from)}–${hm(s.to)}`).join(', ')}` : '')
              const watching = watched.includes(r.roomId)
              return (
                <span key={r.roomId} className="room-line">
                <Link to={roomLink(r, now)} className="room-row"
                  aria-label={`창작실 ${r.roomId}, ${status}, ${r.minPeople}–${r.maxPeople}명, ${schedule}`}>
                  <span className={`room-no ${free ? 'free' : ''}`}>{r.roomId}</span>
                  <span className="room-body">
                    <span className="bar" aria-hidden="true" style={barStyle(pct, r.occupiedNow)}>
                      {segs.map((s) => (
                        <i key={s.from} className="seg" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {blockSegs.map((s) => (
                        <i key={`b${s.from}`} className="seg blocked" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {mySegs.map((s) => (
                        <i key={`m${s.from}`} className="seg mine" style={{ left: `${(s.from / 24) * 100}%`, width: `${((s.to - s.from) / 24) * 100}%` }} />
                      ))}
                      {pct !== null && <i className="now" style={{ left: `${pct}%` }} />}
                    </span>
                    <span className="room-meta"><b>{status}</b> · {r.minPeople}–{r.maxPeople}명{watching && <> · <span className="watching">비면 알려 줘요</span></>}</span>
                  </span>
                </Link>
                {/* 사용 중인 방만: 눈 표시를 켜 두면 비는 순간 비서 카드가 먼저 말을 건다 (링크 안에 버튼을 넣을 수 없어 옆에 둔다) */}
                {known(r) && !free && !r.blockedNow && (
                  <button type="button" className={`watch-btn ${watching ? 'on' : ''}`} aria-pressed={watching}
                    aria-label={`창작실 ${r.roomId} 비면 알려 주기`} onClick={() => toggle(r.roomId)}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  </button>
                )}
                </span>
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

      {climate && !climateUrgent && <ClimateCard view={climate} now={now} />}

      {card && (
        <Link to={`/reservations/${card.id}`} className="mine-card">
          <span className="mine-card-text">
            <span>내 예약 · {Date.parse(card.startAt) < dayStart ? '어제' : '오늘'} {seoulClock(new Date(card.startAt))}–{seoulClock(new Date(card.endAt))} · 창작실 {card.room.id}</span>
            <b>{card.owner ? '입실 번호 보기' : '예약 보기'}</b>
          </span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#15233D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
        </Link>
      )}
    </main>
  )
}
