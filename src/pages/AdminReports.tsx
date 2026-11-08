import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
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

/** 불러오는 동안 카드 모양 자리 (반짝이는 회색) */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="adm-skel" role="status" aria-label="불러오는 중">
      {Array.from({ length: rows }, (_, i) => <span key={i} style={{ animationDelay: `${i * 0.08}s` }} />)}
    </div>
  )
}

/** 신고 목록 + 판정 (FR-RPT-103). 기본은 판정 기다림(OPEN)만, "전체"로 판정한 것까지 */
export function ReportList({ onForceCheckout, onJudged }: { onForceCheckout: (reservationId: number) => void; onJudged?: () => void }) {
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

  const judged = () => { load(); onJudged?.() }

  return (
    <div className="rep-wrap">
      <div className="rep-filter" role="group" aria-label="신고 보기">
        <button type="button" className="adm-mini" aria-pressed={filter === 'OPEN'} onClick={() => setFilter('OPEN')}>판정 기다림</button>
        <button type="button" className="adm-mini" aria-pressed={filter === null} onClick={() => setFilter(null)}>전체</button>
        <button type="button" className="adm-link rep-refresh" onClick={load}>새로 받기</button>
      </div>
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!list && !error && <Skeleton />}
      {list?.length === 0 && (
        <div className="adm-empty">
          <span className="adm-empty-mark" aria-hidden="true">✓</span>
          <b>{filter === 'OPEN' ? '판정할 신고가 없어요' : '아직 신고가 없어요'}</b>
          <span>학생이나 방 카메라가 방 문제를 신고하면 여기에 올라와요.</span>
        </div>
      )}
      <ul className="todo-list">
        {list?.map((r, i) => (
          <ReportCard key={`${r.id}-${r.verdict}`} r={r} i={i} open={open === r.id} onToggle={() => setOpen(open === r.id ? null : r.id)}
            onJudged={judged} onForceCheckout={onForceCheckout} />
        ))}
      </ul>
    </div>
  )
}

/** 신고 한 건. 펼치면 증거 사진과 판정 버튼. 판정하면 도장이 찍히고 목록에서 빠진다 */
function ReportCard({ r, i, open, onToggle, onJudged, onForceCheckout }: {
  r: AdminReport
  i: number
  open: boolean
  onToggle: () => void
  onJudged: () => void
  onForceCheckout: (reservationId: number) => void
}) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [stamp, setStamp] = useState<string | null>(null)
  // 도장이 찍히는 동안 카드가 사라지면(필터·칸 바꿈) 늦게 목록을 다시 부르지 않게 지운다
  const stampTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(stampTimer.current), [])
  const judgeable = r.verdict === 'OPEN' && r.category !== 'NOISE'
  const camera = r.reporterReservationId === null

  async function judge(opt: (typeof JUDGE_OPTIONS)[number]) {
    const memberId = currentMemberId()
    if (busy || memberId === null || !window.confirm(judgeConfirm(opt, r.reporterReservationId === null))) return
    setBusy(true)
    setMsg(null)
    try {
      await judgeReport(r.id, opt.verdict, memberId)
      // 도장이 찍히는 모습을 잠깐 보여 주고 목록을 새로 받는다
      setStamp(opt.label)
      stampTimer.current = setTimeout(onJudged, STAMP_MS)
    } catch (e) {
      setMsg(adminErrorMessage(e))
      onJudged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`card rep v-${r.verdict.toLowerCase()} ${stamp ? 'leaving' : ''}`} style={{ '--k': i } as CSSProperties}>
      <button type="button" className="rep-top" aria-expanded={open} onClick={onToggle}>
        <span className="adm-room" aria-hidden="true">{r.roomId}</span>
        <span className="rep-text">
          <b>창작실 {r.roomId} · {categoryLabel(r.category)}</b>
          <span className="adm-meta">
            <span className={`rep-src ${camera ? 'cam' : ''}`}>{camera ? '방 카메라' : '학생 신고'}</span>
            {agoLabel(r.createdAt)} · #{r.id}
          </span>
        </span>
        <span className={`verdict v-${r.verdict.toLowerCase()}`}>{VERDICT_LABEL[r.verdict]}</span>
        <span className="rep-chev" aria-hidden="true" />
      </button>
      {r.content && <p className="rep-body">{r.content}</p>}
      {open && <EvidencePanel reportId={r.id} onForceCheckout={onForceCheckout} />}
      {!open && <button type="button" className="adm-link rep-open" onClick={onToggle}>증거 사진 보기</button>}
      {judgeable && (
        <div className="rep-judge" role="group" aria-label="판정">
          {JUDGE_OPTIONS.map((o) => (
            <button key={o.verdict} type="button" className={`judge-btn j-${o.verdict.toLowerCase()}`} disabled={busy}
              onClick={() => void judge(o)}>{o.label}</button>
          ))}
        </div>
      )}
      {r.category === 'NOISE' && r.verdict === 'OPEN' && <span className="adm-small">소음은 증명할 수 없어 판정하지 않아요. 필요하면 강제 퇴실을 써요.</span>}
      {msg && <p role="alert" className="adm-msg err">{msg}</p>}
      {stamp && <span className="rep-stamp" role="status">{stamp}</span>}
    </li>
  )
}

/** 판정 도장이 보이는 시간 */
const STAMP_MS = 650

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

  if (error) return <p role="alert" className="adm-msg err">증거를 못 불러왔어요. {error}</p>
  if (!ev) return <div className="evidence"><div className="evidence-grid"><span className="evidence-photo loading" aria-label="증거 불러오는 중" /><span className="evidence-photo loading" /></div></div>
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
      {ev.note && <p className="adm-small">{ev.note}</p>}
      {ev.previous && stillInRoom(ev.previous) && (
        <button type="button" className="adm-btn line" onClick={() => onForceCheckout(ev.previous!.reservationId)}>
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
export function ForceCheckoutForm({ initialId, focus = false }: { initialId: string; focus?: boolean }) {
  const [id, setId] = useState(initialId)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const tooLong = reason.trim().length > MAX_FORCE_REASON
  const box = useRef<HTMLFormElement>(null)

  // 신고 카드의 [강제 퇴실로]에서 왔으면 이 카드로 내려와 번호 칸을 바로 쓸 수 있게
  useEffect(() => {
    if (!focus) return
    box.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    box.current?.querySelector<HTMLInputElement>('#force-id')?.focus({ preventScroll: true })
  }, [focus])

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
    <form ref={box} className={`card adm-card adm-form force ${focus ? 'spot' : ''}`} onSubmit={submit} aria-labelledby="force-h">
      <div className="adm-card-h">
        <span className="adm-card-icon warn" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
        </span>
        <div>
          <h2 id="force-h">강제 퇴실</h2>
          <p>사용 중인 예약을 지금 끝내요. 경고·정지는 따로 걸리지 않아요(벌칙은 신고 판정이 맡아요).</p>
        </div>
      </div>
      <label htmlFor="force-id" className="adm-label">예약 번호</label>
      <input id="force-id" className="adm-input" inputMode="numeric" value={id} disabled={busy}
        onChange={(e) => setId(e.target.value.replace(/\D/g, ''))} placeholder="예: 12" />
      <label htmlFor="force-reason" className="adm-label">사유 <small>선택</small></label>
      <textarea id="force-reason" className="adm-input" rows={3} value={reason} disabled={busy}
        onChange={(e) => setReason(e.target.value)} placeholder="학생 알림에 그대로 보여요. 이름·학번은 적지 마세요." />
      <span className={`adm-count ${tooLong ? 'over' : ''}`}>{reason.trim().length}/{MAX_FORCE_REASON}</span>
      <button className="adm-btn dark" disabled={busy || !id || tooLong}>{busy ? '처리하는 중…' : '강제 퇴실'}</button>
      {msg && <p role={msg.error ? 'alert' : 'status'} className={`adm-msg ${msg.error ? 'err' : 'ok'}`}>{msg.text}</p>}
    </form>
  )
}
