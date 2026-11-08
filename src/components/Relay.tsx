import { Link } from 'react-router-dom'
import { countdown, isDemoOffer, offerPick, type RelayOffer } from '../api/relay'
import { seoulClock, seoulDate } from '../lib/time'
import { useNow } from '../lib/useNow'
import { dayLabel } from '../lib/slots'
import './Relay.css'

/** 예약 화면에 넘기는 상태: 고를 칸 + 넘겨받은 칸 */
export const relayState = (o: RelayOffer) => ({ suggest: offerPick(o), relay: o })

/**
 * 홈 맨 위 "빈방 릴레이" 카드 (Q-18, 11/8 최종안). 기다리던 칸이 놓여 나에게 넘어왔을 때 남은 받을 시간과 함께 먼저 알린다.
 * [받을게요]는 그 칸이 골라진 예약 화면으로(함께 쓸 사람 확인 뒤 예약), [넘길게요]는 다음 사람에게
 */
export function RelayCard({ o, onDecline }: { o: RelayOffer; onDecline: (id: number) => void }) {
  // 남은 받을 시간은 1초마다 줄어든다. 다 지나면 카드를 내린다(다음 사람에게 넘어감)
  const now = useNow(1000)
  const left = Date.parse(o.expiresAt) - now.getTime()
  if (left <= 0) return null
  const day = offerPick(o).date
  const when = `${day === seoulDate(now) ? '오늘' : dayLabel(day)} ${seoulClock(new Date(o.startAt))}–${seoulClock(new Date(o.endAt))}`
  return (
    <section className="relay" aria-labelledby="relay-title">
      <div className="relay-top">
        <span className="relay-eyebrow">빈방 릴레이 · 기다린 순서 {o.order}번</span>
        {isDemoOffer(o.id) && <span className="sample">예시</span>}
      </div>
      <h2 id="relay-title" className="relay-title">창작실 {o.roomId} · {when}이 났어요</h2>
      <p className="relay-sub">
        <b className="relay-cd" aria-hidden="true">{countdown(left)}</b> 안에 받으면 내 차례예요. 안 받으면 다음 사람에게 넘어가요.
        <span className="sr-only">{Math.ceil(left / 60_000)}분 안에 받아야 해요</span>
      </p>
      <div className="relay-actions">
        <button type="button" className="btn-line relay-pass" onClick={() => onDecline(o.id)}>넘길게요</button>
        <Link to={`/rooms/${o.roomId}`} state={relayState(o)} className="btn-primary">받을게요</Link>
      </div>
    </section>
  )
}

/** 예약된 칸을 눌렀을 때 아래 시트: 이 칸 기다리기 */
export function WaitSheet(props: { clock: string; busy: boolean; error: string | null; onWait: () => void; onClose: () => void }) {
  const { clock, busy, error, onWait, onClose } = props
  return (
    <div className="sheet-wrap">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="wait-title">
        <h2 id="wait-title">{clock}은 이미 예약돼 있어요</h2>
        <p className="muted">누가 이 예약을 놓으면 기다린 순서대로 한 사람씩 알려 드려요. 알림을 받고 정해진 시간 안에 받으면 내 예약이 돼요.</p>
        {error && <p role="alert" className="relay-err">{error}</p>}
        <div className="sheet-actions">
          <button type="button" className="btn-line" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary" autoFocus disabled={busy} onClick={onWait}>{busy ? '거는 중…' : '이 칸 기다리기'}</button>
        </div>
      </div>
    </div>
  )
}
