import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ApiError, currentMemberId } from '../api/client'
import PhotoUpload from '../components/PhotoUpload'
import { checkoutReservation, getMyReservations } from '../api/reservations'
import { timeRange } from '../lib/format'
import { seoulClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import { REQUEST_TIMEOUT_MS, useMyReservations } from './MyReservations'
import './Mine.css'

const CHECKS = ['쓰레기를 버렸어요', '책상·의자를 정리했어요', '창문을 닫고 불을 껐어요']

/**
 * 퇴실 (FR-RSV-008, 시안 Checkout): 정리 체크 → 퇴실하기 → (끝나기 전이면) "조기 퇴실할까요?" 확인 → 완료.
 * 퇴실은 번호를 끄는 것이고 문은 도어락이 잠근다(요구사항 3.2).
 * 퇴실 사진(FR-RPT-102)은 선택: 정리한 방을 찍어 두는 증거. 안 올려도 퇴실된다.
 */
export default function Checkout() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const { list, error } = useMyReservations()
  const now = useNow()
  const [checked, setChecked] = useState<boolean[]>(CHECKS.map(() => false))
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  // 사진을 올리는 중에 퇴실하면 완료 화면으로 바뀌어 결과를 못 보므로 끝날 때까지 기다린다
  const [photoBusy, setPhotoBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [fail, setFail] = useState<string | null>(null)
  // 409 뒤 서버에서 다시 보니 다른 상태(자동 반납 등)면 폼을 닫는다
  const [blocked, setBlocked] = useState(false)

  const r = list?.find((x) => x.id === id)

  async function leave() {
    if (busy) return
    setBusy(true)
    setFail(null)
    try {
      await checkoutReservation(id)
      setDone(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'RESERVATION_NOT_IN_USE') {
        // 409는 이미 끝난 예약 전부(자동 반납 등)를 뜻하므로, 서버에서 다시 확인해 내가 퇴실한 경우만 완료로 본다
        // 다시 확인도 멈추면 버튼이 계속 잠기므로 목록과 같은 시간에 끊는다
        const abort = new AbortController()
        const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
        const latest = await getMyReservations(abort.signal)
          .then((rs) => rs.find((x) => x.id === id))
          .catch(() => undefined)
          .finally(() => clearTimeout(timer))
        if (latest?.status === 'CHECKED_OUT') setDone(true)
        else {
          setFail('이미 끝난 예약이에요. 내 예약에서 상태를 확인해 주세요')
          if (latest) setBlocked(true)
        }
      } else {
        setFail(e instanceof Error ? e.message : '잠시 후 다시 시도해 주세요')
      }
    } finally {
      setBusy(false)
      setAsking(false)
    }
  }

  function press() {
    if (!r) return
    // 끝나기 전이면 한 번 확인한다(FR-RSV-008)
    if (Date.parse(r.endAt) > now.getTime()) setAsking(true)
    else leave()
  }

  if (done) {
    return (
      <main className="checkout-done">
        <span className="done-mark" aria-hidden="true">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#15233D" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
        </span>
        <h1>퇴실했어요</h1>
        <p>{r ? `창작실 ${r.room.id}은` : '방은'} 바로 다른 사람이 예약할 수 있어요. 나갈 때 문이 닫혔는지 한 번 봐 주세요.</p>
        <Link to="/" className="btn-white">홈으로</Link>
      </main>
    )
  }

  const head = (
    <header className="sub-head">
      <button type="button" className="back" aria-label="뒤로" onClick={() => navigate(-1)}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <div>
        <h1>나가기 전에</h1>
        {r && <span className="muted small">창작실 {r.room.id} · {timeRange(r.startAt, r.endAt)} · 지금 {seoulClock(now)}</span>}
      </div>
    </header>
  )

  if (error || (list && !r)) return <main className="mine">{head}<p role="alert" className="card mine-msg">{error ?? '찾을 수 없는 예약이에요'}</p></main>
  if (!r) return <main className="mine" aria-busy="true">{head}<p className="card mine-msg muted" role="status">불러오는 중…</p></main>
  if (blocked) {
    return (
      <main className="mine">
        {head}
        <div className="card mine-msg" role="alert">
          <p>{fail}</p>
          <Link to="/me" className="link">내 예약으로</Link>
        </div>
      </main>
    )
  }
  if (!r.owner || r.status !== 'IN_USE') {
    return (
      <main className="mine">
        {head}
        <p className="card mine-msg">{!r.owner ? '퇴실은 대표자가 해요.' : '입실한(사용 중) 예약만 퇴실할 수 있어요.'}</p>
      </main>
    )
  }

  return (
    <main className="mine checkout">
      {head}
      <section className="card checks" aria-labelledby="checks-title">
        <h2 id="checks-title">정리했나요?</h2>
        {CHECKS.map((label, i) => (
          <label key={label} className="check-row">
            <input type="checkbox" checked={checked[i]}
              onChange={(e) => setChecked(checked.map((c, j) => (j === i ? e.target.checked : c)))} />
            {label}
          </label>
        ))}
        <span className="muted small">다음 사람이 "어질러졌다"고 신고하면 경고가 남을 수 있어요.</span>
      </section>
      <PhotoUpload key={`${r.id}-${currentMemberId()}`} reservationId={r.id} kind="CHECK_OUT" onBusyChange={setPhotoBusy} />

      {fail && <p className="card mine-msg" role="alert">{fail}</p>}

      <div className="rs-bar">
        <button type="button" className="btn-primary" disabled={busy || photoBusy} onClick={press}>
          {busy ? '퇴실하는 중…' : photoBusy ? '사진 올리는 중…' : '퇴실하기'}
        </button>
      </div>

      {asking && (
        <div className="sheet-wrap">
          <div className="sheet-dim" onClick={() => setAsking(false)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="early-title">
            <h2 id="early-title">조기 퇴실할까요?</h2>
            <p className="muted">
              끝나는 시각({seoulClock(new Date(r.endAt))}) 전이에요. 퇴실하면 번호가 바로 꺼지고 방이 다른 사람에게 열려요.
            </p>
            <p className="tidy">자리 정리하셨나요?</p>
            <div className="sheet-actions">
              <button type="button" className="btn-line" autoFocus onClick={() => setAsking(false)}>더 쓸게요</button>
              <button type="button" className="btn-primary" disabled={busy} onClick={leave}>{busy ? '퇴실하는 중…' : '퇴실할게요'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
