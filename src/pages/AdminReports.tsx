import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { currentMemberId } from '../api/client'
import {
  adminErrorMessage, forceCheckout, getEvidence, getPhotoBlob, getReports, judgeConfirm, judgeReport, JUDGE_OPTIONS, MAX_FORCE_REASON,
  stillInRoom, type AdminReport, type Evidence, type EvidencePhoto,
} from '../api/admin'
import { agoLabel } from '../api/notifications'
import { CATEGORIES, VERDICT_LABEL, type ReportVerdict } from '../api/reports'
import { seoulClock } from '../lib/time'

const REQUEST_TIMEOUT_MS = 15_000
/** 신고 종류 코드를 화면 이름으로 */
const categoryLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c

/** 신고 목록 + 판정 (FR-RPT-103). 기본은 대기(OPEN)만, "전체"로 판정한 것까지 */
export function AdminReports({ onForceCheckout }: { onForceCheckout: (reservationId: number) => void }) {
  const [filter, setFilter] = useState<ReportVerdict | null>('OPEN')
  const [list, setList] = useState<AdminReport[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<number | null>(null)
  const active = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    active.current?.abort()
    const ctrl = new AbortController()
    active.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getReports(filter, ctrl.signal, memberId)
      .then((l) => { if (active.current === ctrl) { setList(l); setError(null) } })
      .catch((e) => { if (active.current === ctrl) setError(adminErrorMessage(e)) })
      .finally(() => { clearTimeout(timer); if (active.current === ctrl) active.current = null })
  }, [filter])

  useEffect(() => {
    setList(null)
    load()
    return () => { active.current?.abort(); active.current = null }
  }, [load])

  return (
    <section className="admin-body" aria-label="신고">
      <div className="admin-filter" role="group" aria-label="보기">
        <button type="button" className="admin-chip" aria-pressed={filter === 'OPEN'} onClick={() => setFilter('OPEN')}>판정 기다림</button>
        <button type="button" className="admin-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>전체</button>
        <button type="button" className="link-btn admin-refresh" onClick={load}>새로 받기</button>
      </div>
      {error && <p role="alert" className="admin-msg err">{error}</p>}
      {!list && !error && <p className="admin-msg muted" role="status">불러오는 중…</p>}
      {list?.length === 0 && (
        <div className="card admin-empty">
          <b>{filter === 'OPEN' ? '판정할 신고가 없어요' : '아직 신고가 없어요'}</b>
          <span className="muted">학생이 방 문제를 신고하면 여기에 올라와요.</span>
        </div>
      )}
      <ul className="admin-list">
        {list?.map((r) => (
          <ReportCard key={r.id} r={r} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}
            onJudged={load} onForceCheckout={onForceCheckout} />
        ))}
      </ul>
    </section>
  )
}

/** 신고 한 건. 펼치면 증거와 판정 버튼을 보여 준다 */
function ReportCard({ r, open, onToggle, onJudged, onForceCheckout }: {
  r: AdminReport
  open: boolean
  onToggle: () => void
  onJudged: () => void
  onForceCheckout: (reservationId: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const judgeable = r.verdict === 'OPEN' && r.category !== 'NOISE'

  async function judge(opt: (typeof JUDGE_OPTIONS)[number]) {
    const memberId = currentMemberId()
    if (busy || memberId === null || !window.confirm(judgeConfirm(opt, r.reporterReservationId === null))) return
    setBusy(true)
    setMsg(null)
    try {
      await judgeReport(r.id, opt.verdict, memberId)
      onJudged()
    } catch (e) {
      setMsg(adminErrorMessage(e))
      onJudged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`card admin-report v-${r.verdict.toLowerCase()}`}>
      <button type="button" className="admin-report-top" aria-expanded={open} onClick={onToggle}>
        <span className="admin-room" aria-hidden="true">{r.roomId}</span>
        <span className="admin-report-text">
          <b>창작실 {r.roomId} · {categoryLabel(r.category)}</b>
          <span className="muted">{agoLabel(r.createdAt)} · 신고 #{r.id}</span>
        </span>
        <span className={`verdict v-${r.verdict.toLowerCase()}`}>{VERDICT_LABEL[r.verdict]}</span>
      </button>
      {r.content && <p className="admin-report-body">{r.content}</p>}
      {open && <EvidencePanel reportId={r.id} onForceCheckout={onForceCheckout} />}
      {judgeable && (
        <div className="admin-judge" role="group" aria-label="판정">
          {JUDGE_OPTIONS.map((o) => (
            <button key={o.verdict} type="button" className={`judge-btn j-${o.verdict.toLowerCase()}`} disabled={busy}
              onClick={() => void judge(o)}>{o.label}</button>
          ))}
        </div>
      )}
      {r.category === 'NOISE' && r.verdict === 'OPEN' && <span className="muted admin-small">소음은 증명할 수 없어 판정하지 않아요. 필요하면 강제 퇴실을 써요.</span>}
      {!open && <button type="button" className="link-btn admin-small" onClick={onToggle}>증거 사진 보기</button>}
      {msg && <p role="alert" className="admin-msg err">{msg}</p>}
    </li>
  )
}

/** 증거 사진 둘 (core #76): 직전 예약의 퇴실 사진 ↔ 신고자의 입실 사진. 같은 방 상태를 앞뒤로 비교한다 */
function EvidencePanel({ reportId, onForceCheckout }: { reportId: number; onForceCheckout: (reservationId: number) => void }) {
  const [ev, setEv] = useState<Evidence | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    const ctrl = new AbortController()
    // 정리(cleanup)에서만 켠다. 시간 초과로 끊긴 건 오류로 보여 줘야 해서 signal.aborted로 가리지 않는다
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getEvidence(reportId, ctrl.signal, memberId)
      .then((v) => { if (!stale) setEv(v) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [reportId])

  if (error) return <p role="alert" className="admin-msg err">증거를 못 불러왔어요. {error}</p>
  if (!ev) return <p className="admin-msg muted" role="status">증거 불러오는 중…</p>
  return (
    <div className="evidence">
      <div className="evidence-grid">
        <figure className="evidence-cell">
          <Photo photo={ev.previous?.photo ?? null} empty={ev.previous ? '퇴실 사진 없음' : '직전 예약 없음'} />
          <figcaption>
            <b>앞 사람 퇴실</b>
            <span className="muted">{ev.previous ? `예약 #${ev.previous.reservationId}${ev.previous.checkedOutAt ? ` · ${seoulClock(new Date(ev.previous.checkedOutAt))} 퇴실` : ' · 아직 사용 중'}` : '—'}</span>
          </figcaption>
        </figure>
        {ev.reporter ? (
          <figure className="evidence-cell">
            <Photo photo={ev.reporter.photo} empty="입실 사진 없음" />
            <figcaption>
              <b>신고자 입실</b>
              <span className="muted">예약 #{ev.reporter.reservationId}</span>
            </figcaption>
          </figure>
        ) : (
          <figure className="evidence-cell">
            <span className="evidence-photo empty">방 카메라 자동 신고</span>
            <figcaption>
              <b>신고자 없음</b>
              <span className="muted">카메라가 본 내용은 신고 글에 있어요</span>
            </figcaption>
          </figure>
        )}
      </div>
      {ev.note && <p className="muted admin-small">{ev.note}</p>}
      {ev.previous && stillInRoom(ev.previous) && (
        <button type="button" className="btn-line admin-force" onClick={() => onForceCheckout(ev.previous!.reservationId)}>
          예약 #{ev.previous.reservationId} 강제 퇴실로
        </button>
      )}
    </div>
  )
}

/** Bearer가 필요한 사진을 받아 object URL로 띄운다. 화면을 떠나면 URL을 버린다 */
function Photo({ photo, empty }: { photo: EvidencePhoto | null; empty: string }) {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const url = photo?.exists ? photo.url : null

  useEffect(() => {
    if (!url) return
    const memberId = currentMemberId()
    if (memberId === null) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 30_000)
    let objectUrl: string | null = null
    let stale = false
    setFailed(false)
    getPhotoBlob(url, ctrl.signal, memberId)
      .then((b) => { if (stale) return; objectUrl = URL.createObjectURL(b); setSrc(objectUrl) })
      .catch(() => { if (!stale) setFailed(true) })
      .finally(() => clearTimeout(timer))
    return () => {
      stale = true
      clearTimeout(timer)
      ctrl.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setSrc(null)
    }
  }, [url])

  if (!url) return <span className="evidence-photo empty">{empty}</span>
  if (failed) return <span className="evidence-photo empty">사진을 못 받았어요</span>
  if (!src) return <span className="evidence-photo loading" aria-label="사진 불러오는 중" />
  return <a href={src} target="_blank" rel="noreferrer" className="evidence-photo"><img src={src} alt={photo?.kind === 'CHECK_IN' ? '신고자 입실 사진' : '앞 사람 퇴실 사진'} /></a>
}

/** 강제 퇴실 (FR-RPT-104 퇴출, core #73). 예약 번호 + 사유(선택, 200자). 사유는 학생 알림에 그대로 보인다 */
export function ForceCheckoutForm({ initialId }: { initialId: string }) {
  const [id, setId] = useState(initialId)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const tooLong = reason.trim().length > MAX_FORCE_REASON

  async function submit(e: FormEvent) {
    e.preventDefault()
    const memberId = currentMemberId()
    const n = Number(id)
    if (busy || tooLong || !Number.isInteger(n) || n <= 0 || memberId === null) return
    if (!window.confirm(`예약 #${n}을 지금 퇴실 처리할까요? 대표자와 참여자에게 알림이 가요.`)) return
    setBusy(true)
    setMsg(null)
    try {
      await forceCheckout(n, reason, memberId)
      setMsg({ text: `예약 #${n}을 퇴실 처리했어요. 방이 바로 비어요.`, error: false })
      setReason('')
    } catch (err) {
      setMsg({ text: adminErrorMessage(err), error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-body" aria-label="강제 퇴실">
      <form className="card admin-form" onSubmit={submit}>
        <p className="muted admin-small">사용 중인 예약을 지금 끝내요. 경고·정지는 따로 걸리지 않아요(벌칙은 신고 판정이 맡아요).</p>
        <label htmlFor="force-id"><b>예약 번호</b></label>
        <input id="force-id" className="admin-input" inputMode="numeric" value={id} disabled={busy}
          onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} placeholder="예: 12" />
        <label htmlFor="force-reason"><b>사유 (선택)</b></label>
        <textarea id="force-reason" className="admin-input" rows={3} value={reason} disabled={busy}
          onChange={(e) => setReason(e.target.value)} placeholder="학생 알림에 그대로 보여요. 이름·학번은 적지 마세요." />
        <span className={`admin-count ${tooLong ? 'over' : ''}`}>{reason.trim().length}/{MAX_FORCE_REASON}</span>
        <button className="btn-primary" disabled={busy || !id || tooLong}>{busy ? '처리하는 중…' : '강제 퇴실'}</button>
        {msg && <p role={msg.error ? 'alert' : 'status'} className={`admin-msg ${msg.error ? 'err' : ''}`}>{msg.text}</p>}
      </form>
    </section>
  )
}
