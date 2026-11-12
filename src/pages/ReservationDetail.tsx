import { useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, currentMemberId } from '../api/client'
import PhotoUpload from '../components/PhotoUpload'
import { cancelDeadline, cancelReservation, canCancel as canCancelAt, isActive, STATUS_LABEL, type ReservationStatus } from '../api/reservations'
import { timeRange, whenLabel } from '../lib/format'
import { seoulClock, seoulClockSec } from '../lib/time'
import { useNow } from '../lib/useNow'
import { deadlineOf } from './AccessCode'
import { useMyReservations } from './MyReservations'
import './Mine.css'

/** 예약 상세 (시안 Detail): 참여자 목록, 입실 번호 보기, 시작 전 취소(대표자만, 확인 창) */
export default function ReservationDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  // 앱 안에서 들어왔으면(첫 화면이 아니면) 온 곳으로, 바로 열었으면 내 예약 목록으로. history.length는 앞으로 가기 기록까지 세서 쓰지 않는다
  const cameInApp = useLocation().key !== 'default'
  const { list, error, stale, reload } = useMyReservations()
  // 취소할 수 있는 동안(누른 뒤 5분 등)은 1초마다 다시 그려 마감에 맞춰 취소 버튼이 사라지게 한다
  const target = list?.find((x) => x.id === id)
  const now = useNow(target && canCancelAt(target, Date.now()) ? 1_000 : 30_000)
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  // 입실 사진을 올리는 동안 퇴실 화면으로 넘어가면 결과를 못 보니 막는다
  const [photoBusy, setPhotoBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  // 취소 응답의 상태. 다시 받기에 실패해도 화면이 취소된 상태를 보여 주게 한다(목록이 바뀌면 서버 값을 따른다)
  const [cancelled, setCancelled] = useState<{ status: ReservationStatus } | null>(null)

  const found = list?.find((x) => x.id === id)
  const r = found && cancelled && found.status === 'BOOKED' ? { ...found, status: cancelled.status } : found

  async function cancel() {
    if (busy) return
    setBusy(true)
    setFail(null)
    try {
      const res = await cancelReservation(id)
      setCancelled({ status: res.status })
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
      <button type="button" className="back" aria-label="뒤로" onClick={() => (cameInApp ? navigate(-1) : navigate('/me/reservations'))}>
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
  const canCancel = canCancelAt(r, now.getTime())
  // 지금 바로 쓰기는 시작 후에도 몇 분 동안 취소된다(core #84). 그때는 '시작 전까지'가 아니라 취소 마감 시각을 알린다
  const cancelAfterStart = cancelDeadline(r).getTime() > Date.parse(r.startAt)
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
          {r.status === 'BOOKED' && (<><dt>입실 마감</dt><dd>{seoulClock(deadlineOf(r))}</dd></>)}
          {/* core #134 전에는 칸이 없어 줄을 안 보인다 */}
          {r.checkedInAt && (<><dt>입실</dt><dd>{seoulClock(new Date(r.checkedInAt))}</dd></>)}
          {r.checkedOutAt && (<><dt>퇴실</dt><dd>{seoulClock(new Date(r.checkedOutAt))}</dd></>)}
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
      {stale && <p className="card mine-msg muted" role="status">최신 정보를 못 받았어요. 잠시 후 다시 받아요.</p>}

      {r.status === 'IN_USE' && <PhotoUpload key={`${r.id}-${currentMemberId()}-in`} reservationId={r.id} kind="CHECK_IN" onBusyChange={setPhotoBusy} />}
      {/* 대표자는 퇴실 화면에서 올린다. 참여자는 퇴실 화면에 못 들어가므로 여기서 */}
      {r.status === 'IN_USE' && !r.owner && <PhotoUpload key={`${r.id}-${currentMemberId()}-out`} reservationId={r.id} kind="CHECK_OUT" />}

      {r.owner && active && (
        <Link to={`/reservations/${r.id}`} className="btn-primary detail-key">입실 QR 보기</Link>
      )}
      {r.owner && r.status === 'IN_USE' && (
        photoBusy
          ? <button type="button" className="btn-line detail-key" disabled>사진 올리는 중…</button>
          : <Link to={`/me/${r.id}/checkout`} className="btn-line detail-key">다 썼어요, 퇴실</Link>
      )}
      {canCancel && (
        <div className="detail-cancel">
          <span className="muted small">{cancelAfterStart
            ? `잘못 눌렀다면 ${seoulClockSec(cancelDeadline(r))} 전까지 취소할 수 있어요`
            : `시작(${seoulClock(new Date(r.startAt))}) 전까지 대표자만 취소할 수 있어요`}</span>
          <button type="button" className="btn-line" onClick={() => setAsking(true)}>예약 취소</button>
        </div>
      )}
      {/* 취소 마감이 지난 BOOKED는 취소 버튼이 없다. 왜 없는지와 노쇼 마감을 알린다 */}
      {r.owner && r.status === 'BOOKED' && !canCancel && (
        <p className="muted small detail-note">취소할 수 있는 시간이 지났어요. {seoulClock(deadlineOf(r))}까지 QR로 입실하지 않으면 예약이 풀리고 노쇼로 기록돼요.</p>
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
