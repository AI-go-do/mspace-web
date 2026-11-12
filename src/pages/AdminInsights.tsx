import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { ApiError, currentMemberId } from '../api/client'
import {
  adminErrorMessage, alertEffectLabel, getDailyReport, reportTotals, sumOf, writerLabel, type DailyReport, MAX_WITHDRAW_REASON, withdrawWarning, type Warning, daysBefore, getPenalties, getSourceCounts, getTidyChecks, getUsageStats, tidyCounts, pct,
  SUSPENSION_REASON, SUSPENSION_SCOPE, TIDY_LABEL, seenItemsSummary, tidyPhotoUrl, type TidyPhoto, WARNING_REASON, type Penalties, type SourceCounts, type TidyCheckRow, type UsageStats,
} from '../api/admin'
import { minutesLabel } from '../lib/format'
import { seoulDate } from '../lib/time'
import { useCountUp } from '../lib/useCountUp'
import { IconButton } from '../components/IconAction'
import Odi from '../components/Odi'
import { AuthPhoto, Skeleton } from './AdminReports'

const REQUEST_TIMEOUT_MS = 15_000
const RANGES = [7, 30, 90]

/** "11/6 14:20" (서울) */
function stamp(iso: string): string {
  const p = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(iso)).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {})
  return `${p.month}/${p.day} ${p.hour}:${p.minute}`
}

/** 기간 고르기 칩 (7·30·90일) */
function RangeChips({ value, onChange, label }: { value: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="adm-chips" role="group" aria-label={label}>
      {RANGES.map((d) => (
        <button key={d} type="button" className="adm-chip" aria-pressed={value === d} onClick={() => onChange(d)}>최근 {d}일</button>
      ))}
    </div>
  )
}

/** 숫자 칸. 숫자는 세어 올라가고, 비율(0–1)이면 % 로 */
function Tile({ label, value, rate, sub, hero, i = 0 }: { label: string; value: number | null; rate?: boolean; sub?: string; hero?: boolean; i?: number }) {
  const n = value === null ? null : rate ? Math.round(value * 100) : value
  const shown = useCountUp(n, 800)
  return (
    <div className={`card stat-tile ${hero ? 'hero' : ''}`} style={{ '--k': i } as CSSProperties}>
      <span>{label}</span>
      <b aria-hidden="true">{n === null ? '—' : <>{shown}{rate && <small>%</small>}</>}</b>
      <span className="sr-only">{n === null ? '없음' : `${n}${rate ? '%' : ''}`}</span>
      {sub && <small>{sub}</small>}
    </div>
  )
}

/**
 * 경고 한 줄 + 철회 (core #123, 11/12 지영 "AI·카메라가 틀렸을 때 사람이 바로 풀 길"). [철회]를 누르면 이유 칸이 열리고,
 * 보내면 core가 경고를 빼고 그 경고로 걸린 정지도 풀고 학생에게 이유와 함께 알린다. 이유는 학생 알림에 그대로 보인다
 */
function WarningRow({ w, onChanged }: { w: Warning; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(w.withdrawnAt ? '철회됨' : null)
  const [msg, setMsg] = useState<string | null>(null)
  const text = reason.trim()
  // core는 글자를 코드 포인트로 센다(이모지 1개 = 1자, core #123)
  const count = [...text].length
  const tooLong = count > MAX_WITHDRAW_REASON

  const send = async (e: FormEvent) => {
    e.preventDefault()
    if (!text || tooLong || busy) return
    setBusy(true)
    setMsg(null)
    try {
      const r = await withdrawWarning(w.id, text, currentMemberId())
      setDone(['철회됨', r.suspensionLifted ? '정지 풀림' : '', r.appealClosed ? '학생 철회 요청 닫힘' : ''].filter(Boolean).join(' · '))
      setOpen(false)
      // 정지가 풀렸을 수 있어 위 정지 목록·숫자를 조용히 다시 받는다
      onChanged()
    } catch (err) {
      // 다른 관리자가 먼저 철회했으면 그쪽에서 정지도 풀었을 수 있다
      if (err instanceof ApiError && err.code === 'WARNING_ALREADY_WITHDRAWN') { setDone('철회됨'); setOpen(false); onChanged() }
      else setMsg(adminErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className={`pen-row warn-row${done ? ' withdrawn' : ''}`}>
      <span className="pen-who"><b>{w.member.name}</b><span className="muted">{w.member.studentId}</span></span>
      <span className="pen-what">
        <span className="tidy-tags">
          <span className="pen-tag">{WARNING_REASON[w.reason] ?? w.reason}</span>
          {done && <span className="pen-tag">{done}</span>}
        </span>
        <span className="muted">신고 #{w.reportId}{w.reservationId ? ` · 예약 #${w.reservationId}` : ''} · {stamp(w.createdAt)}</span>
      </span>
      {!done && !open && <button type="button" className="btn-line warn-withdraw" onClick={() => setOpen(true)}>철회</button>}
      {open && (
        <form className="warn-withdraw-form" onSubmit={(e) => void send(e)}>
          <label htmlFor={`withdraw-${w.id}`} className="adm-small">철회 이유 (학생 알림에 그대로 보여요)</label>
          <textarea id={`withdraw-${w.id}`} rows={2} value={reason} disabled={busy} autoFocus
            maxLength={MAX_WITHDRAW_REASON + 50} placeholder="예: 카메라가 잘못 봤어요" onChange={(e) => setReason(e.target.value)} />
          <span className={`adm-small${tooLong ? ' err' : ''}`}>{count}/{MAX_WITHDRAW_REASON}</span>
          {msg && <p role="alert" className="adm-msg err">{msg}</p>}
          <div className="warn-withdraw-btns">
            <button type="button" className="btn-line" disabled={busy} onClick={() => { setOpen(false); setMsg(null) }}>취소</button>
            <button type="submit" className="btn-primary" disabled={!text || tooLong || busy}>{busy ? '철회하는 중…' : '철회하기'}</button>
          </div>
        </form>
      )}
    </li>
  )
}

/** 경고·정지 목록 (FR-WEB-101, core #75). 지금 정지 중인 사람이 위, 그다음 최근 경고 */
export function AdminPenalties() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<Penalties | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 경고를 철회한 뒤 다시 받기. 목록을 비우지 않아(뼈대 없이) 줄마다 보이는 "철회됨"이 그대로 남는다
  const [reload, setReload] = useState(0)
  const [loadedDays, setLoadedDays] = useState(days)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    if (loadedDays !== days) { setData(null); setLoadedDays(days) }
    setError(null)
    const ctrl = new AbortController()
    // 정리(cleanup)에서만 켠다. 시간 초과로 끊긴 건 오류로 보여 줘야 해서 signal.aborted로 가리지 않는다
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getPenalties(days, ctrl.signal, memberId)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days, reload])

  const active = data?.suspensions.filter((s) => s.active) ?? []
  const ended = data?.suspensions.filter((s) => !s.active) ?? []

  return (
    <section className="rec-body" aria-label="경고·정지">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!data && !error && <Skeleton />}
      {data && (
        <>
          <div className="stat-tiles three">
            <Tile hero label="지금 정지" value={active.length} />
            <Tile label="끝난 정지" value={ended.length} i={1} />
            <Tile label="경고" value={data.warnings.length} i={2} />
          </div>
          <div className="rec-two">
          <section className="card admin-sec">
            <h2>정지</h2>
            {data.suspensions.length === 0 && <p className="adm-small">이 기간에 정지가 없어요.</p>}
            <ul className="pen-list">
              {[...active, ...ended].map((s) => (
                <li key={`${s.scope}${s.id}`} className={`pen-row ${s.active ? 'on' : ''}`}>
                  <span className="pen-who"><b>{s.member.name}</b><span className="muted">{s.member.studentId}</span></span>
                  <span className="pen-what">
                    <span className={`pen-tag ${s.active ? 'on' : ''}`}>{s.active ? '정지 중' : '끝남'} · {SUSPENSION_SCOPE[s.scope] ?? s.scope}</span>
                    <span className="muted">{SUSPENSION_REASON[s.reason] ?? s.reason} · {stamp(s.startsAt)} → {stamp(s.endsAt)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="card admin-sec">
            <h2>경고</h2>
            {data.warnings.length === 0 && <p className="adm-small">이 기간에 경고가 없어요.</p>}
            <ul className="pen-list">
              {data.warnings.map((w) => <WarningRow key={w.id} w={w} onChanged={() => setReload((n) => n + 1)} />)}
            </ul>
          </section>
          </div>
        </>
      )}
    </section>
  )
}

/** 줄 하나를 가리키는 키. 예약 하나에 퇴실 직후·다시 확인 두 줄이 있을 수 있다 */
const rowKey = (r: Pick<TidyCheckRow, 'reservationId' | 'phase'>) => `${r.reservationId}-${r.phase}`

/** 비교 사진 한 칸: 받을 주소와 아래 글. student면 카메라 대신 학생이 올린 사진 */
export interface Shot { url: string; label: string; when: string; student?: boolean }

/** 펼친 줄의 두 칸 이름: 왼쪽은 늘 "입실 전", 오른쪽은 단계마다 */
export const afterLabel = (r: Pick<TidyCheckRow, 'phase'>) => (r.phase === 'RECHECK' ? '3시간 뒤' : '퇴실 뒤')

/** core가 준 사진 한 장 → 칸. 없으면 null("사진을 못 받았어요") */
function shotOf(p: TidyPhoto | null | undefined, label: string): Shot | null {
  if (!p) return null
  const student = p.source === 'STUDENT'
  const at = p.takenAt ? stamp(p.takenAt) : ''
  return { url: p.url, label, when: at, student }
}

/**
 * 펼친 줄의 비교 사진 두 장 (11/12 지영 "웹캠이 입실·퇴실 사진, 못 찍었으면 학생 퇴실 사진으로 대신, 둘 다 없으면 사진이 없어요").
 * - core #125가 before·after를 주면 그대로: 왼쪽 입실 전(카메라 ENTRY → 학생 입실 사진), 오른쪽 퇴실 뒤·3시간 뒤(카메라 → 학생 퇴실 사진)
 * - 예전 core(칸 없음): 퇴실 직후 줄은 같은 방 앞 줄의 퇴실 직후 사진 ↔ 이번 퇴실 직후 사진, 다시 확인 줄은 퇴실 직후 ↔ 3시간 뒤
 */
export function tidyPair(rows: TidyCheckRow[], r: TidyCheckRow): [Shot | null, Shot | null] {
  if (r.before !== undefined || r.after !== undefined) {
    return [shotOf(r.before, '입실 전'), shotOf(r.after, afterLabel(r))]
  }
  if (r.phase === 'RECHECK') {
    return [
      { url: tidyPhotoUrl(r.reservationId, 'FIRST'), label: '퇴실 직후', when: '' },
      { url: tidyPhotoUrl(r.reservationId, 'RECHECK'), label: '3시간 뒤', when: '' },
    ]
  }
  // 목록은 최근 순이라 같은 방의 더 오래된 퇴실 직후 줄 가운데 첫 번째. 카메라 결과가 없는 예약은 목록에 없어
  // 바로 앞 예약이 아닐 수 있으므로 "앞 팀"이라 단정하지 않고 찍힌 시각을 적는다
  const before = rows.find((x) => x.roomId === r.roomId && x.phase === 'FIRST' && x.reservationId !== r.reservationId
    && Date.parse(x.observedAt) < Date.parse(r.observedAt))
  return [
    before ? { url: tidyPhotoUrl(before.reservationId, 'FIRST'), label: '입실 전', when: `${stamp(before.observedAt)} 이전 퇴실 사진` } : null,
    { url: tidyPhotoUrl(r.reservationId, 'FIRST'), label: '퇴실 뒤', when: '' },
  ]
}

/** 오디가 한 일 하나: doing은 하는 중 글, done은 끝난 글. later면 아직 안 한 일(예정) */
export interface TidyAction { doing: string; done: string; later?: boolean }

/**
 * 비교 사진 옆 오디 AI 상자(재웅 11/11 "오디 AI 안에서 젯슨 YOLO 판단 로딩 → 판단 완료 → 학생 알림 보냄"): 판단 한 줄 + 근거 + 한 일.
 * 판단은 젯슨 카메라 모델(FR-DEV-105), 알림·경고는 그 결과를 받은 core가 같은 처리 안에서 바로 보낸다(core TidyCheckService:
 * 퇴실 직후 LEFT_ITEMS → 대표자·참여자 LEFT_ITEM 알림, 3시간 뒤에도 남음 → 신고 + 대표자 경고). 그래서 결과 줄이 있으면 보낸 것으로 쓴다.
 * 물품 종류는 말하지 않는다(10차 회의 FR-DEV-105 ①: "두고 갔다"만)
 */
export function tidyReason(row: Pick<TidyCheckRow, 'phase' | 'result' | 'leftItems' | 'reportId' | 'items'>, rechecked = false): { verdict: string; why: string; actions: TidyAction[]; warn: boolean } {
  const clean = row.result === 'CLEAN' && row.leftItems.length === 0
  const n = row.items.length
  // 11/10 전 기록(NEEDS_CLEANING): 그때 core는 퇴실 직후 한 번만 보고 바로 신고했고 3시간 뒤 다시 확인이 없었다(core #110)
  if (row.result === 'NEEDS_CLEANING') {
    const acts: TidyAction[] = []
    if (row.leftItems.length > 0) acts.push({ doing: '학생에게 알림 보내는 중', done: '대표자·참여자에게 알림 보냈어요' })
    if (row.reportId !== null) acts.push({ doing: '신고 만드는 중', done: `신고 #${row.reportId} 만들었어요` })
    return { verdict: '치워야 해요', why: '정리가 안 된 채로 퇴실했어요', warn: true, actions: acts }
  }
  if (row.phase === 'RECHECK') {
    return clean
      ? { verdict: '3시간 뒤 비었어요', why: '퇴실 직후 본 물품이 없어졌어요', warn: false,
          actions: [{ doing: '경고할지 따져 보는 중', done: '경고 없이 끝냈어요' }] }
      : row.reportId === null
        // 남았는데 신고가 없으면 core 설정(경고 기준·카메라 경고 끔)상 경고하지 않은 것. 이유는 설정마다 달라 말하지 않는다
        ? { verdict: '3시간 뒤에도 두고 간 물품이 있어요', why: '퇴실 직후 본 물품이 그대로 있어요', warn: true,
            actions: [{ doing: '경고할지 따져 보는 중', done: '경고는 안 했어요' }] }
        : { verdict: '3시간 뒤에도 두고 간 물품이 있어요', why: '퇴실 직후 본 물품이 그대로 있어요', warn: true,
          actions: [
            { doing: '신고 만드는 중', done: `신고 #${row.reportId} 만들었어요` },
            { doing: '대표자에게 경고 보내는 중', done: '대표자에게 경고 보냈어요' },
          ] }
  }
  return clean
    ? { verdict: '깨끗해요', why: '앞 팀 사진과 달라진 곳이 없어요', warn: false,
        actions: [{ doing: '다음 팀 기준 사진으로 저장하는 중', done: '다음 팀 기준 사진으로 저장했어요' }] }
    : { verdict: '두고 간 물품이 있어요', why: n > 0 ? `앞 팀 사진엔 없던 물품 ${n}개` : '앞 팀 사진엔 없던 물품', warn: true,
        actions: [
          { doing: '학생에게 알림 보내는 중', done: '대표자·참여자에게 알림 보냈어요' },
          rechecked
            ? { doing: '3시간 뒤 다시 보는 중', done: '3시간 뒤 다시 확인했어요' }
            : { doing: '3시간 뒤 다시 확인 예약하는 중', done: '3시간 뒤 다시 확인할게요', later: true },
        ] }
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

/**
 * AI 답변처럼 보이는 판단 상자(재웅 11/11 "진짜 AI스럽게", "알림 보내는 중 → 완료!"):
 * 빛나는 테두리, "비교하는 중" 반짝 글 → 판단이 한 글자씩 → 근거 → 한 일이 하나씩 "보내는 중(돌기)" → "✓ 보냈어요".
 * 움직임 줄이기를 켠 사람에게는 처음부터 다 끝난 모습
 * rechecked: 같은 예약의 3시간 뒤 다시 확인 줄이 이미 있는지
 */
function TidyJudgement({ row, rechecked }: { row: TidyCheckRow; rechecked: boolean }) {
  const r = tidyReason(row, rechecked)
  const top = seenItemsSummary(row.items).top
  // 첫 줄은 젯슨 카메라 모델 판단, 그 뒤는 core가 한 일. 줄마다 2칸(하는 중 → 끝)
  const steps: TidyAction[] = [{ doing: 'YOLOv8s 모델이 사진 보는 중', done: '모델 판단 완료' }, ...r.actions]
  const last = steps.length * 2
  const [step, setStep] = useState(() => (reducedMotion() ? last : 0))
  useEffect(() => {
    if (reducedMotion()) return
    const timers: ReturnType<typeof setTimeout>[] = []
    let t = 250
    for (let k = 1; k <= last; k++) {
      const at = k
      timers.push(setTimeout(() => setStep(at), t))
      t += k % 2 === 1 ? (k === 1 ? 1600 : 1100) : 450
    }
    return () => timers.forEach(clearTimeout)
  }, [last])
  const judged = step >= 2
  const allDone = step >= last
  return (
    <div className={`tidy-ai${r.warn ? ' t-warn' : ''}${!judged ? ' thinking' : ''}${allDone ? ' done' : ''}`} aria-live="polite">
      <div className="tidy-ai-head">
        <span className="tidy-ai-odi"><Odi size={26} label="오디" /></span>
        <span className="tidy-ai-name">오디 AI <i aria-hidden="true">✦</i></span>
        <span className="tidy-ai-model" title="방 카메라 물건 찾기 모델 (device README &quot;v8s (지금)&quot;)">YOLOv8s</span>
      </div>
      <ol className="tidy-ai-acts">
        {steps.map((a, i) => {
          const at = i * 2 + 1
          if (step < at) return null
          const finished = step > at
          const cls = !finished ? 'doing' : a.later ? 'later' : 'ok'
          return (
            <li key={i} className={cls}>
              <span className="mark" aria-hidden="true" />
              <span className="txt">{finished ? a.done : a.doing}
                {i === 0 && finished && top !== null && <em className="tidy-ai-sure" title="모델 확신도">확신 {Math.round(top * 100)}%</em>}
              </span>
              {i === 0 && finished && (
                <div className="tidy-ai-result">
                  <b className="tidy-ai-verdict">{r.verdict}</b>
                  <span className="tidy-ai-reason">{r.why}</span>
                </div>
              )}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * 방 카메라 정리 확인 목록 (FR-DEV-105·FR-WEB-101, core #110·#112). 퇴실 뒤 젯슨이 본 결과를 최근 순으로.
 * 예약 하나에 퇴실 직후·3시간 뒤 다시 확인이 따로 한 줄씩. 다시 확인에도 남으면 core가 대표자 경고(신고 번호가 붙음).
 * 카메라 그림을 누르면 줄 아래에 비교 사진 두 장(core #115)을 펼친다. 사진은 누른 줄만 받는다(7일이면 수백 장)
 */
export function AdminTidyChecks() {
  const [days, setDays] = useState(7)
  const [open, setOpen] = useState<string | null>(null)
  const [rows, setRows] = useState<TidyCheckRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setRows(null)
    setError(null)
    const ctrl = new AbortController()
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getTidyChecks(days, ctrl.signal, memberId)
      .then((r) => { if (!stale) setRows(r) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days])

  const counts = rows ? tidyCounts(rows) : null
  return (
    <section className="rec-body" aria-label="카메라 정리 확인">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!rows && !error && <Skeleton />}
      {rows && counts && (
        <>
          <div className="stat-tiles three">
            <Tile hero label="두고 간 물품" value={counts.left} />
            <Tile label="깨끗함" value={counts.clean} i={1} />
            <Tile label="3시간 뒤 경고" value={counts.warned} i={2} />
          </div>
          <section className="card admin-sec">
            <h2>퇴실 뒤 카메라가 본 것</h2>
            {rows.length === 0 && <p className="adm-small">이 기간에 받은 결과가 없어요.</p>}
            <ul className="pen-list">
              {rows.map((r) => {
                const key = rowKey(r)
                const isOpen = open === key
                const on = r.result !== 'CLEAN'
                const pair = isOpen ? tidyPair(rows, r) : null
                return (
                  <li key={key} className={`pen-row tidy-row ${on ? 'on' : ''}`}>
                    <span className="pen-who"><b>{r.roomName}</b><span className="muted">예약 #{r.reservationId}</span></span>
                    <span className="pen-what">
                      <span className="tidy-tags">
                        <span className="pen-tag">{r.phase === 'RECHECK' ? '3시간 뒤' : '퇴실 직후'}</span>
                        <span className={`pen-tag ${on ? 'on' : ''}`}>
                          {TIDY_LABEL[r.result] ?? r.result}{r.reportId !== null ? ` · 경고 신고 #${r.reportId}` : ''}
                        </span>
                      </span>
                      <span className="muted">{r.phase === 'RECHECK' ? `${stamp(r.observedAt)} 다시 확인` : `${stamp(r.endedAt ?? r.observedAt)} 퇴실`}</span>
                    </span>
                    <IconButton
                      icon={isOpen ? 'close' : 'camera'}
                      label={isOpen ? '사진 닫기' : '비교 사진 보기'}
                      aria-expanded={isOpen}
                      onClick={() => setOpen(isOpen ? null : key)}
                    />
                    {pair && (
                      <div className="tidy-photos"><div className="evidence-grid">
                        {pair.map((shot, i) => {
                          const label = shot?.label ?? (i === 0 ? '입실 전' : afterLabel(r))
                          return (
                            <figure key={i} className={`evidence-cell${shot?.student ? ' student' : ''}`}>
                              <AuthPhoto url={shot?.url ?? null} empty="사진을 못 받았어요" alt={`${r.roomName} ${label} 사진`} />
                              <figcaption>
                                <b>{label}</b>
                                {shot?.student && <span className="pen-tag tidy-student">학생 사진</span>}
                                {shot?.when && <span className="muted">{shot.when}</span>}
                              </figcaption>
                            </figure>
                          )
                        })}
                      </div><TidyJudgement row={r} rechecked={r.phase === 'FIRST' && rows.some((x) => x.reservationId === r.reservationId && x.phase === 'RECHECK')} /></div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </section>
  )
}

/**
 * 이용 통계 (FR-WEB-101, core #74 + 예약 만든 곳 #45). 위에 핵심 숫자 넷, 방별 사용률 막대, 시간대별 예약 막대,
 * 결과 나눔, 센서. 막대는 한 가지 값이라 파랑 한 색(범례 없음), 값은 막대 끝에 글로, 표로도 볼 수 있다
 */
export function AdminStats() {
  const [days, setDays] = useState(7)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [source, setSource] = useState<SourceCounts | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    const to = seoulDate()
    const from = daysBefore(to, days - 1)
    setStats(null)
    setSource(null)
    setError(null)
    const ctrl = new AbortController()
    let stale = false
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getUsageStats(from, to, ctrl.signal, memberId)
      .then((s) => { if (!stale) setStats(s) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    // 만든 곳 건수는 덧붙이는 숫자라, 실패해도 통계는 보여 준다
    getSourceCounts(from, to, ctrl.signal, memberId).then((c) => { if (!stale) setSource(c) }).catch(() => undefined)
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [days])

  const t = stats?.total
  const maxHour = Math.max(1, ...(stats?.byHour.map((h) => h.reservations) ?? [0]))

  return (
    <section className="rec-body" aria-label="이용 통계">
      <RangeChips value={days} onChange={setDays} label="기간" />
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!stats && !error && <Skeleton />}
      {stats && t && (
        <>
          <span className="adm-small">{stats.from} ~ {stats.to} · {stats.days}일</span>
          <div className="stat-tiles four">
            <Tile hero label="예약" value={t.reservations.total} sub={`취소 ${t.reservations.canceled} 포함`} />
            <Tile label="실제 이용률" value={t.rates.actualUse} rate sub={`입실 ${t.reservations.used}건`} i={1} />
            <Tile label="노쇼율" value={t.rates.noShow} rate sub={`노쇼 ${t.reservations.noShow}건`} i={2} />
            <Tile label="방 사용률" value={t.rates.utilization} rate sub="하루 24시간 기준" i={3} />
          </div>
          <div className="card stat-strip">
            <span><b>{minutesLabel(t.minutes.used)}</b>이용 시간</span>
            <span><b>{t.minutes.avgUsed == null ? '—' : minutesLabel(t.minutes.avgUsed)}</b>평균 이용</span>
            <span><b>{t.uniqueUsers}명</b>이용자</span>
            {source && <span><b>{source.agent}건</b>비서 예약</span>}
          </div>

          <div className="rec-two">
          <section className="card admin-sec">
            <h2>방별 사용률</h2>
            <div className="hbar-list">
              {stats.rooms.map((r) => {
                const v = r.rates.utilization ?? 0
                return (
                  <div key={r.roomId} className="hbar-row" tabIndex={0}
                    title={`${r.roomName ?? `창작실 ${r.roomId}`}: 사용률 ${pct(r.rates.utilization)}, 예약 ${r.reservations.total}건, 노쇼 ${r.reservations.noShow}건`}>
                    <span className="hbar-label">{r.roomId}</span>
                    <span className="hbar-track"><i style={{ width: `${Math.max(v * 100, v > 0 ? 2 : 0)}%`, '--k': r.roomId } as CSSProperties} /></span>
                    <span className="hbar-value">{pct(r.rates.utilization)}</span>
                  </div>
                )
              })}
            </div>
            <details className="stat-table">
              <summary>표로 보기</summary>
              <table>
                <thead><tr><th>방</th><th>예약</th><th>입실</th><th>노쇼</th><th>사용률</th><th>이용 시간</th></tr></thead>
                <tbody>
                  {stats.rooms.map((r) => (
                    <tr key={r.roomId}>
                      <td>{r.roomName ?? r.roomId}</td><td>{r.reservations.total}</td><td>{r.reservations.used}</td>
                      <td>{r.reservations.noShow}</td><td>{pct(r.rates.utilization)}</td><td>{minutesLabel(r.minutes.used)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </section>

          <section className="card admin-sec">
            <h2>시간대별 예약</h2>
            <div className="vbar" role="img" aria-label={`시간대별 예약. 가장 많은 때 ${stats.byHour.reduce((a, h) => (h.reservations > a.reservations ? h : a), stats.byHour[0] ?? { hour: 0, reservations: 0 }).hour}시`}>
              {stats.byHour.map((h) => (
                <span key={h.hour} className="vbar-col" title={`${h.hour}시: 예약 ${h.reservations}건, 입실 ${h.used}건`}>
                  <i style={{ height: `${(h.reservations / maxHour) * 100}%`, '--k': h.hour } as CSSProperties} />
                </span>
              ))}
            </div>
            <div className="vbar-axis" aria-hidden="true"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
          </section>
          </div>
          <div className="rec-two">

          <section className="card admin-sec">
            <h2>예약이 끝난 모양</h2>
            <dl className="stat-dl">
              <div><dt>입실해서 사용</dt><dd>{t.reservations.used}</dd></div>
              <div><dt>자동 퇴실(종료 시각)</dt><dd>{t.reservations.autoCheckedOut}</dd></div>
              <div><dt>자리 비움으로 해제</dt><dd>{t.reservations.awayReleased}</dd></div>
              <div><dt>관리자 강제 퇴실</dt><dd>{t.reservations.forced}</dd></div>
              <div><dt>노쇼</dt><dd>{t.reservations.noShow}</dd></div>
              <div><dt>취소</dt><dd>{t.reservations.canceled}</dd></div>
              <div><dt>30분 안 짧은 이용</dt><dd>{t.shortUses}</dd></div>
            </dl>
          </section>

          <section className="card admin-sec">
            <h2>센서 (CO2·재실)</h2>
            <dl className="stat-dl">
              <div><dt>CO2 평균 / 최고</dt><dd>{t.sensor.co2AvgPpm ?? '—'} / {t.sensor.co2MaxPpm ?? '—'} ppm</dd></div>
              <div><dt>기준({t.sensor.thresholdPpm}ppm) 넘은 측정</dt><dd>{pct(t.sensor.co2OverRate)}</dd></div>
              <div><dt>환기 알림</dt><dd>{t.sensor.ventilationAlerts}번</dd></div>
              <div><dt>사람 있음(센서)</dt><dd>{minutesLabel(t.sensor.occupiedMinutes)}</dd></div>
              <div><dt>예약 없이 사람 있음</dt><dd>{minutesLabel(t.sensor.occupiedWithoutReservationMinutes)}</dd></div>
            </dl>
            <span className="adm-small">재실은 센서가 상태가 바뀔 때만 기록해서 근삿값이에요.</span>
          </section>
          </div>

          {t.alerts && (
            <section className="card admin-sec">
              <h2>알림 효과</h2>
              <dl className="stat-dl">
                <div><dt>노쇼 직전 알림 뒤 입실</dt><dd>{alertEffectLabel(t.alerts.noShowCheckedIn, t.alerts.noShowWarned, t.alerts.noShowCheckedInRate)}</dd></div>
                <div><dt>환기 알림 뒤 {t.alerts.resolvedWithinMinutes}분 안 CO2 기준({t.sensor.thresholdPpm}ppm) 이하</dt><dd>{alertEffectLabel(t.alerts.ventilationResolved, t.alerts.ventilationChecked, t.alerts.ventilationResolvedRate)}</dd></div>
              </dl>
              <span className="adm-small">결과가 난 알림만 세요. 아직 입실 안 했는데 입실 마감 전인 예약, 확인 시간이 아직 안 지난 환기 알림은 빠져요.</span>
            </section>
          )}
        </>
      )}
    </section>
  )
}

/**
 * 하루 운영 요약 (core #122, 11/10 회의 "관리자 = 관제 대시보드", 11/12 지영 "core 다 AI화").
 * 날짜를 고르면 그날 숫자와 오디(Gemini)가 쓴 3–5줄 요약. 오늘은 하루가 안 끝나 core가 1시간마다 새로 쓴다
 */
export function AdminDailyReport() {
  const today = seoulDate()
  const [date, setDate] = useState(today)
  const [data, setData] = useState<DailyReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    setData(null)
    setError(null)
    const ctrl = new AbortController()
    let stale = false
    // Gemini가 처음 쓰는 날은 몇 초 걸릴 수 있어 다른 기록보다 넉넉히 기다린다
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS * 2)
    getDailyReport(date === today ? null : date, ctrl.signal, memberId)
      .then((d) => { if (!stale) setData(d) })
      .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
      .finally(() => clearTimeout(timer))
    return () => { stale = true; clearTimeout(timer); ctrl.abort() }
  }, [date, today])

  const yesterday = daysBefore(today, 1)
  const f = data?.facts
  const reports = reportTotals(f?.reports)
  return (
    <section className="rec-body" aria-label="하루 운영 요약">
      <div className="adm-chips daily-dates" role="group" aria-label="날짜">
        <button type="button" className="adm-chip" aria-pressed={date === today} onClick={() => setDate(today)}>오늘</button>
        <button type="button" className="adm-chip" aria-pressed={date === yesterday} onClick={() => setDate(yesterday)}>어제</button>
        <label className="daily-pick">
          <span className="sr-only">날짜 고르기</span>
          <input type="date" value={date} max={today} onChange={(e) => { if (e.target.value && e.target.value <= today) setDate(e.target.value) }} />
        </label>
      </div>
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      {!data && !error && <Skeleton />}
      {data && f && (
        <>
          <div className="stat-tiles four">
            <Tile hero label="예약" value={f.total.reservations.total} sub={`입실 ${f.total.reservations.used}건`} />
            <Tile label="노쇼" value={f.total.reservations.noShow} i={1} />
            <Tile label="신고" value={reports.total} sub={f.autoJudged ? `오디가 판정 ${f.autoJudged}건` : undefined} i={2} />
            <Tile label="경고" value={sumOf(f.warnings)} sub={f.appeals.WITHDRAWN ? `철회 ${f.appeals.WITHDRAWN}건` : undefined} i={3} />
          </div>
          <section className="card admin-sec">
            <h2>{data.date.slice(5).replace('-', '/')} 운영 요약{f.partial && <span className="pen-tag daily-partial">진행 중</span>}</h2>
            <div className="tidy-ai daily-ai done">
              <div className="tidy-ai-head">
                <span className="tidy-ai-odi"><Odi size={26} label="오디" /></span>
                <span className="tidy-ai-name">오디 AI <i aria-hidden="true">✦</i></span>
                <span className="tidy-ai-model" title={data.writer}>{writerLabel(data.writer)}</span>
              </div>
              <ul className="daily-lines">
                {data.lines.map((l, i) => <li key={i}>{l}</li>)}
              </ul>
              <p className="adm-small daily-at">{stamp(data.generatedAt)}에 썼어요{f.partial ? ' · 오늘은 1시간마다 새로 써요' : ''}</p>
            </div>
            {sumOf(f.deviceFaults) > 0 && <p className="adm-small">장치 고장 {sumOf(f.deviceFaults)}건</p>}
          </section>
        </>
      )}
    </section>
  )
}
