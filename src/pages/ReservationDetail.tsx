import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { cancelReservation, isActive, STATUS_LABEL } from '../api/reservations'
import { timeRange, whenLabel } from '../lib/format'
import { seoulClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import { checkInDeadline } from './AccessCode'
import { useMyReservations } from './MyReservations'
import './Mine.css'

/** 예약 상세 (시안 Detail): 참여자 목록, 입실 번호 보기, 시작 전 취소(대표자만, 확인 창) */
export default function ReservationDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { list, error, reload } = useMyReservations()
  const now = useNow()
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [fail, setFail] = useState<string | null>(null)

  const r = list?.find((x) => x.id === id)

  async function cancel() {
    if (busy) return
    setBusy(true)
    setFail(null)
    try {
      await cancelReservation(id)
      setDone(true)
    } catch (e) {
      // 409: 그새 시작했거나 이미 취소됨 → 지금 상태를 다시 받아 보여 준다
      setFail(e instanceof ApiError ? e.message : '잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
      setAsking(false)
      reload()
    }
  }

  const head = (
    <header className="sub-head">
      <button type="button" className="back" aria-label="뒤로" onClick={() => navigate('/me')}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <h1>예약 상세</h1>
    </header>
  )

  if (error || (list && !r)) {
    return <main className="mine">{head}<p role="alert" className="card mine-msg">{error ?? '찾을 수 없는 예약이에요'}</p></main>
  }
  if (!r) return <main className="mine" aria-busy="true">{head}<p className="card mine-msg muted" role="status">불러오는 중…</p></main>

  const active = isActive(r.status)
  const canCancel = r.owner && r.status === 'BOOKED' && Date.parse(r.startAt) > now.getTime()
  const others = r.participants.length - 1
  const host = r.participants.find((p) => p.owner)

  return (
    <main className="mine detail">
      {head}
      <section className="card detail-card">
        <div className="detail-top">
          <div className="detail-when">
            <span className="muted">{whenLabel(r.startAt, now)}</span>
            <b>창작실 {r.room.id} · {timeRange(r.startAt, r.endAt)}</b>
          </div>
          <span className={`badge ${active ? 'on' : ''}`}>{STATUS_LABEL[r.status]}</span>
        </div>
        <dl className="detail-facts">
          {r.status === 'BOOKED' && (<><dt>입실 마감</dt><dd>{seoulClock(checkInDeadline(r.startAt))}</dd></>)}
          <dt>만든 사람</dt><dd>{r.owner ? '나 (대표자)' : `${host?.name ?? '대표자'} (대표자)`}</dd>
        </dl>
        <div className="detail-people">
          <span className="strong">함께 쓰는 사람 {r.participants.length}명</span>
          <div className="chips-row">
            {r.participants.map((p, i) => (
              <span key={i} className={`pchip ${p.owner ? 'host' : ''}`}>{p.owner && r.owner ? '나' : p.name}</span>
            ))}
          </div>
          <span className="muted small">참여자 휴대폰의 내 예약에도 똑같이 보여요</span>
        </div>
      </section>

      {done && <p className="card mine-msg" role="status">예약을 취소했어요. 이 시간은 이제 다른 팀이 예약할 수 있어요.</p>}
      {fail && <p className="card mine-msg" role="alert">{fail}</p>}

      {r.owner && active && (
        <Link to={`/reservations/${r.id}`} className="btn-primary detail-key">입실 번호 보기</Link>
      )}
      {r.owner && r.status === 'IN_USE' && (
        <Link to={`/me/${r.id}/checkout`} className="btn-line detail-key">다 썼어요, 퇴실</Link>
      )}
      {canCancel && (
        <div className="detail-cancel">
          <span className="muted small">시작({seoulClock(new Date(r.startAt))}) 전까지 대표자만 취소할 수 있어요</span>
          <button type="button" className="btn-line" onClick={() => setAsking(true)}>예약 취소</button>
        </div>
      )}
      {!r.owner && active && <p className="muted small detail-note">참여자는 보기만 할 수 있어요. 취소·퇴실은 대표자가 해요.</p>}

      {asking && (
        <div className="sheet-wrap">
          <div className="sheet-dim" onClick={() => setAsking(false)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cancel-title">
            <h2 id="cancel-title">예약을 취소할까요?</h2>
            <p className="muted">
              창작실 {r.room.id} · {whenLabel(r.startAt, now)} {timeRange(r.startAt, r.endAt)} 예약이 없어져요
              {others > 0 ? `. 함께 쓰는 ${others}명의 내 예약에서도 사라져요` : ''}. 되돌릴 수 없어요.
            </p>
            <div className="sheet-actions">
              <button type="button" className="btn-line" autoFocus onClick={() => setAsking(false)}>그대로 둘게요</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={cancel}>{busy ? '취소하는 중…' : '취소할게요'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
