import { useEffect, useRef, useState, type FormEvent } from 'react'
import { blockConflicts, cancelConflicts, createBlock, releaseBlock, resetBlocks, useRoomBlocks } from '../api/roomBlocks'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { timeRange } from '../lib/format'
import { BLOCK_REASONS, BLOCK_RULES, isActive, reasonLabel, reasonStatus, type BlockReason, type RoomBlock } from '../lib/roomBlocks'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import { NoticeDraftCard } from './AdminNoticeDraft'
import './AdminBlocks.css'

/** 00:00 ~ 23:30, 30분 칸 */
const TIMES = Array.from({ length: 48 }, (_, i) => `${String(Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`
const at = (date: string, time: string) => new Date(`${date}T${time}:00+09:00`)

/** "11월 9일 (월) 09:00 → 11월 9일 (월) 12:00" (같은 날이면 날짜 한 번) */
function period(b: Pick<RoomBlock, 'startAt' | 'endAt'>): string {
  const s = new Date(b.startAt)
  const e = new Date(b.endAt)
  if (seoulDate(s) === seoulDate(e)) return `${dayLabel(seoulDate(s))} ${timeRange(b.startAt, b.endAt)}`
  return `${dayLabel(seoulDate(s))} ${seoulClock(s)} → ${dayLabel(seoulDate(e))} ${seoulClock(e)}`
}

/** 다음 30분 칸 */
function nextSlot(now: Date): Date {
  const slot = 30 * 60_000
  return new Date(Math.ceil((now.getTime() + 1) / slot) * slot)
}

/** 공지 막기안에서 [양식에서 고치기]로 채울 값 */
interface Preset { roomId: number; startAt: string; endAt: string; reason: BlockReason; memo: string }

function BlockForm({ preset }: { preset?: Preset | null }) {
  const first = preset ? new Date(preset.startAt) : nextSlot(new Date())
  const until = preset ? new Date(preset.endAt) : new Date(first.getTime() + 2 * 3_600_000)
  const [roomId, setRoomId] = useState(preset?.roomId ?? ADMIN_ROOMS[0]?.roomId ?? 1)
  const [startDate, setStartDate] = useState(seoulDate(first))
  const [startTime, setStartTime] = useState(seoulClock(first))
  const [endDate, setEndDate] = useState(seoulDate(until))
  const [endTime, setEndTime] = useState(seoulClock(until))
  const [reason, setReason] = useState<BlockReason>(preset?.reason ?? 'INSPECTION')
  const [memo, setMemo] = useState(preset?.memo ?? '')
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(
    preset ? { text: '공지 막기안으로 채웠어요. 고친 뒤 [기간 막기]를 눌러 주세요.', error: false } : null)
  const ref = useRef<HTMLFormElement>(null)
  // 막기안에서 넘어오면 양식이 보이게 내리고 첫 칸에 손이 가게
  useEffect(() => {
    if (!preset) return
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    ref.current?.querySelector<HTMLSelectElement>('#blk-room')?.focus({ preventScroll: true })
  }, [preset])

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = createBlock({ roomId, startAt: at(startDate, startTime), endAt: at(endDate, endTime), reason, memo })
    if ('error' in r) { setMsg({ text: r.error, error: true }); return }
    setMemo('')
    setMsg({
      text: r.conflicts.length
        ? `막았어요. 그 기간에 이미 잡힌 예약이 ${r.conflicts.length}건 있어요. 아래 목록에서 확인해 주세요.`
        : `${roomName(roomId)}을 막았어요. 학생 화면에 "${reasonStatus(reason)}"으로 보여요.`,
      error: false,
    })
  }

  return (
    <form ref={ref} className={`card adm-card adm-form blk-form ${preset ? 'nd-filled' : ''}`} onSubmit={submit} aria-label="기간 막기">
      <div className="adm-card-h">
        <span className="adm-card-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M5.6 5.6l12.8 12.8" /></svg>
        </span>
        <div>
          <h2>기간 막기</h2>
          <p>공사·점검·대관처럼 방을 쓸 수 없는 기간을 막아요. 막힌 칸은 학생이 예약·즉시 시작·연장할 수 없어요.</p>
        </div>
      </div>
      <label htmlFor="blk-room" className="adm-label">방</label>
      <select id="blk-room" className="adm-input" value={roomId} onChange={(e) => setRoomId(Number(e.target.value))}>
        {ADMIN_ROOMS.map((r) => <option key={r.roomId} value={r.roomId}>{r.name}</option>)}
      </select>
      <fieldset className="blk-reasons">
        <legend className="adm-label">사유</legend>
        {BLOCK_REASONS.map((r) => (
          <label key={r.value} className={`blk-reason ${reason === r.value ? 'on' : ''}`}>
            <input type="radio" name="blk-reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
            {r.label}
          </label>
        ))}
      </fieldset>
      <div className="blk-when">
        <div>
          <label htmlFor="blk-sd" className="adm-label">시작</label>
          <div className="blk-dt">
            <input id="blk-sd" type="date" className="adm-input" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <select aria-label="시작 시각" className="adm-input" value={startTime} onChange={(e) => setStartTime(e.target.value)}>
              {TIMES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="blk-ed" className="adm-label">끝</label>
          <div className="blk-dt">
            <input id="blk-ed" type="date" className="adm-input" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <select aria-label="끝 시각" className="adm-input" value={endTime} onChange={(e) => setEndTime(e.target.value)}>
              {TIMES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      </div>
      <label htmlFor="blk-memo" className="adm-label">메모 <small>선택</small></label>
      <input id="blk-memo" className="adm-input" value={memo} maxLength={BLOCK_RULES.memoMax + 20}
        onChange={(e) => setMemo(e.target.value)} placeholder="예: 에어컨 점검. 학생 화면에 같이 보여요" />
      <button className="adm-btn">기간 막기</button>
      {msg && <p role={msg.error ? 'alert' : 'status'} className={`adm-msg ${msg.error ? 'err' : ''}`}>{msg.text}</p>}
    </form>
  )
}

function BlockItem({ b, now }: { b: RoomBlock; now: Date }) {
  const [note, setNote] = useState<string | null>(null)
  const active = isActive(b, now)
  const conflicts = active ? blockConflicts(b.id, now) : []
  const running = active && new Date(b.startAt).getTime() <= now.getTime()

  function cancelAll() {
    if (!window.confirm(`겹친 예약 ${conflicts.length}건을 취소할까요? 대표자와 참여자에게 "${reasonStatus(b.reason)}" 사유로 알림이 가요.`)) return
    const n = cancelConflicts(b.id, new Date()) // 확인 창이 떠 있는 동안 끝난 예약은 빼려고 누른 시각으로
    setNote(`예약 ${n}건을 취소했어요. (가짜 단계라 실제 알림은 보내지 않았어요)`)
  }

  return (
    <li className={`card blk-item ${active ? '' : 'off'} ${running ? 'running' : ''}`}>
      <div className="blk-top">
        <span className="adm-room" aria-hidden="true">{b.roomId}</span>
        <div className="blk-text">
          <b>{roomName(b.roomId)} · {reasonLabel(b.reason)}</b>
          <span className="muted">{period(b)}</span>
          {b.memo && <span className="muted">"{b.memo}"</span>}
        </div>
        <span className={`blk-state ${running ? 'now' : active ? '' : 'end'}`}>
          {b.releasedAt ? '풀림' : !active ? '끝남' : running ? reasonStatus(b.reason) : '예정'}
        </span>
      </div>
      {conflicts.length > 0 && (
        <div className="blk-conflicts">
          <p><b>이 기간에 이미 잡힌 예약 {conflicts.length}건</b> · 바로 지우지 않았어요</p>
          <ul>
            {conflicts.map((c) => (
              <li key={c.reservationId}>#{c.reservationId} · {dayLabel(seoulDate(new Date(c.startAt)))} {timeRange(c.startAt, c.endAt)} · 예약 {c.people}명</li>
            ))}
          </ul>
          <button type="button" className="adm-btn" onClick={cancelAll}>확인하고 취소·알림 보내기</button>
        </div>
      )}
      {note && <p className="adm-msg" role="status">{note}</p>}
      {active && <button type="button" className="adm-btn line blk-release" onClick={() => releaseBlock(b.id)}>막기 풀기</button>}
    </li>
  )
}

/** 관리자 "기간 막기" 탭: 막기 + 목록(겹친 예약 확인·취소, 풀기) */
export function AdminBlocks() {
  const { blocks } = useRoomBlocks()
  // 공지 막기안 → 양식 채우기. 누를 때마다 양식을 새로 그려 값이 들어가게(seq를 key로)
  const [preset, setPreset] = useState<{ seq: number; p: Preset } | null>(null)
  const now = new Date()
  const active = blocks.filter((b) => isActive(b, now))
  const past = blocks.filter((b) => !isActive(b, now))
  return (
    <section className="blk-wrap" aria-label="기간 막기">
      <div className="blk-main">
        <NoticeDraftCard onEdit={(row, d) => setPreset((x) => ({ seq: (x?.seq ?? 0) + 1, p: { ...row, reason: d.reason, memo: d.memo } }))} />
        <BlockForm key={preset?.seq ?? 0} preset={preset?.p} />
      </div>
      <div className="blk-side">
      <h2 className="blk-h">막힌 기간 <span className="adm-chip-n">{active.length}</span></h2>
      {active.length === 0 && (
        <div className="adm-empty">
          <span className="adm-empty-mark" aria-hidden="true">✓</span>
          <b>지금 막힌 기간이 없어요</b>
          <span>왼쪽에서 방과 기간을 고르면 여기에 쌓여요.</span>
        </div>
      )}
      <ul className="blk-list">{active.map((b) => <BlockItem key={b.id} b={b} now={now} />)}</ul>
      {past.length > 0 && (
        <details className="blk-past">
          <summary>지난·푼 기간 {past.length}건</summary>
          <ul className="blk-list">{past.map((b) => <BlockItem key={b.id} b={b} now={now} />)}</ul>
        </details>
      )}
      <p className="adm-foot">
        가짜 값 단계예요(core #95 전). 기록은 이 브라우저에만 남고 학생에게 아무것도 보내지 않아요.{' '}
        <button type="button" className="adm-link" onClick={resetBlocks}>가짜 기록 처음으로</button>
      </p>
      </div>
    </section>
  )
}
