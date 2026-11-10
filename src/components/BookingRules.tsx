import { BOOKING } from '../content/rules'
import './BookingRules.css'

const WEEK = ['일', '월', '화', '수', '목', '금', '토']

/** 서울 시각 기준 오늘부터 n일의 날짜와 요일 */
function seoulDays(now: Date, n: number): { date: number; day: string }[] {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
  const base = new Date(`${ymd}T12:00:00+09:00`).getTime()
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(base + i * 86_400_000)
    const date = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', day: 'numeric' }).format(d))
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short' }).format(d)
    return { date, day: WEEK[['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd)] }
  })
}

/**
 * 이용 규칙의 예약 부분 (FR-WEB-003). 숫자만 늘어놓지 않고 예약 한 번의 흐름(언제 → 얼마나 → 입실 → 몇 명 → 몇 건)을 그림으로 보여 준다.
 * 숫자는 content/rules.ts의 BOOKING 한 곳에서 읽는다. 그림은 장식이라 읽기 도우미에는 각 줄의 문장만 읽힌다.
 */
export function BookingRules({ now = new Date() }: { now?: Date }) {
  const days = seoulDays(now, BOOKING.advanceDays)
  const slots = BOOKING.maxMinutes / BOOKING.slotMinutes
  return (
    <section className="bk" aria-labelledby="booking-title">
      <h2 id="booking-title" className="sec-title">예약</h2>
      <ol className="bk-rows">
        <li className="bk-row" style={{ '--i': 0 } as React.CSSProperties}>
          <div className="bk-num"><b>{BOOKING.advanceDays}일</b><span>오늘부터</span></div>
          <div className="bk-art bk-days" aria-hidden="true">
            {days.map((d, i) => <span key={i} className={i === 0 ? 'bk-today' : ''}><b>{d.date}</b><small>{i === 0 ? '오늘' : d.day}</small></span>)}
          </div>
          <p className="sr-only">시작 시각이 오늘부터 {BOOKING.advanceDays}일 안이면 미리 예약할 수 있어요.</p>
        </li>

        <li className="bk-row" style={{ '--i': 1 } as React.CSSProperties}>
          <div className="bk-num"><b>{BOOKING.maxMinutes / 60}시간</b><span>{BOOKING.slotMinutes}분씩</span></div>
          <div className="bk-art bk-time" aria-hidden="true">
            <div className="bk-slots">{Array.from({ length: slots }, (_, i) => <i key={i} style={{ '--k': i } as React.CSSProperties} />)}</div>
            <div className="bk-ticks"><span>14:00</span><span>16:00</span></div>
          </div>
          <p className="sr-only">{BOOKING.slotMinutes}분 단위로, 한 번에 최대 {BOOKING.maxMinutes / 60}시간까지 잡을 수 있어요.</p>
        </li>

        <li className="bk-row warn" style={{ '--i': 2 } as React.CSSProperties}>
          <div className="bk-num"><b>{BOOKING.noShowMinutes}분</b><span>안에 입실</span></div>
          <div className="bk-art bk-entry" aria-hidden="true">
            <div className="bk-line">
              <span className="bk-ok"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2v2h-2zM18 14h2v2h-2z" fill="currentColor" /></svg>QR</span>
              <span className="bk-late">노쇼</span>
            </div>
            <div className="bk-ticks"><span>시작</span><span>+{BOOKING.noShowMinutes}분</span></div>
          </div>
          <p className="sr-only">시작하고 {BOOKING.noShowMinutes}분 안에 QR로 입실하지 않으면 노쇼로 예약이 취소돼요. 지금 바로 쓰기는 {BOOKING.instantNoShowMinutes}분이에요.</p>
        </li>

        <li className="bk-row" style={{ '--i': 3 } as React.CSSProperties}>
          <div className="bk-num"><b>{BOOKING.smallRoom}명</b><span>함께</span></div>
          <div className="bk-art bk-rooms" aria-hidden="true">
            <span className="bk-room"><em>1–4</em><People n={5} min={3} /></span>
            <span className="bk-room"><em>5</em><People n={8} min={5} /></span>
          </div>
          <p className="sr-only">창작실 1–4번은 {BOOKING.smallRoom}명, 5번은 {BOOKING.bigRoom}명이 함께 써요.</p>
        </li>

        <li className="bk-row" style={{ '--i': 4 } as React.CSSProperties}>
          <div className="bk-num"><b>1건</b><span>진행 중</span></div>
          <div className="bk-art bk-one" aria-hidden="true">
            <span className="bk-tk on">내 예약</span>
            <span className="bk-tk off">+1</span>
          </div>
          <p className="sr-only">대표자·참여자 모두 끝나지 않은 예약은 한 번에 1건이에요. 끝나면 바로 다음 예약을 할 수 있어요.</p>
        </li>
      </ol>
      <p className="bk-foot">{BOOKING.instantNote}</p>
    </section>
  )
}

/** 사람 점 n개 중 min개부터 진하게(그 수부터 예약 가능) */
function People({ n, min }: { n: number; min: number }) {
  return <span className="bk-ppl">{Array.from({ length: n }, (_, i) => <i key={i} className={i < min ? 'need' : 'can'} />)}</span>
}
