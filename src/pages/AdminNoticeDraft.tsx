import { useState, type CSSProperties } from 'react'
import { createBlock, mockReservations, useRoomBlocks } from '../api/roomBlocks'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { timeRange } from '../lib/format'
import { NOTICE_EXAMPLES, parseNotice, splitBySpans, type DraftRow, type NoticeDraft } from '../lib/noticeParse'
import { conflictsOf, reasonLabel, reasonStatus } from '../lib/roomBlocks'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import './AdminNoticeDraft.css'

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`

/** "11월 12일 (목) 09:00–12:00" / 여러 날이면 "11월 16일 (월) 00:00 → 11월 18일 (수) 00:00" */
function period(r: Pick<DraftRow, 'startAt' | 'endAt'>): string {
  const s = new Date(r.startAt)
  const e = new Date(r.endAt)
  const sameDay = seoulDate(s) === seoulDate(e) || (seoulClock(e) === '00:00' && e.getTime() - s.getTime() <= 86_400_000)
  if (sameDay) return `${dayLabel(seoulDate(s))} ${seoulClock(s) === '00:00' && seoulClock(e) === '00:00' ? '하루 종일' : timeRange(r.startAt, r.endAt)}`
  // 여러 날 하루 종일: "11월 16일 (월) ~ 11월 17일 (화) 하루 종일"
  if (seoulClock(s) === '00:00' && seoulClock(e) === '00:00') return `${dayLabel(seoulDate(s))} ~ ${dayLabel(seoulDate(new Date(e.getTime() - 1)))} 하루 종일`
  return `${dayLabel(seoulDate(s))} ${seoulClock(s)} → ${dayLabel(seoulDate(e))} ${seoulClock(e)}`
}

const KIND_LABEL = { date: '날짜', time: '시각', room: '방', reason: '사유' } as const

/**
 * 방 관리 맨 위 "공지 한 줄로 막기" (웹 화면만). 교학팀 공지를 붙여 넣으면 날짜·시각·방·사유를 읽어 막기안을 보여 주고,
 * 관리자가 확인해서 [이대로 막기]를 누르거나 [양식에서 고치기]로 아래 양식에 채운다. 지금은 규칙으로 읽고, 나중에 AI로 바꾼다
 */
export function NoticeDraftCard({ onEdit }: { onEdit: (row: DraftRow, draft: NoticeDraft) => void }) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<{ text: string; d: NoticeDraft } | null>(null)
  const [done, setDone] = useState<{ ok: number; errors: string[] } | null>(null)
  const { canceled } = useRoomBlocks()

  function read(t = text) {
    setDone(null)
    setDraft({ text: t, d: parseNotice(t, new Date()) })
  }

  function blockAll(d: NoticeDraft) {
    const errors: string[] = []
    let ok = 0
    for (const r of d.rows) {
      const res = createBlock({ roomId: r.roomId, startAt: new Date(r.startAt), endAt: new Date(r.endAt), reason: d.reason, memo: d.memo })
      if ('error' in res) errors.push(`${roomName(r.roomId)} ${period(r)}: ${res.error}`)
      else ok++
    }
    setDone({ ok, errors })
    if (errors.length === 0) { setDraft(null); setText('') }
  }

  const now = new Date()
  const reservations = mockReservations(now).filter((r) => !canceled.includes(r.reservationId))
  const d = draft?.d
  const conflictTotal = d ? d.rows.reduce((n, r) => n + conflictsOf(r, reservations).length, 0) : 0

  return (
    <section className="card adm-card nd" aria-labelledby="nd-title">
      <div className="adm-card-h">
        <span className="adm-card-icon nd-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5h16M4 10h10M4 15h7" /><path d="m15 17 2 2 4-5" /></svg>
        </span>
        <div>
          <h2 id="nd-title">공지 한 줄로 막기</h2>
          <p>교학팀 공지 문장을 붙여 넣으면 날짜·시각·방·사유를 읽어 막기안을 만들어요. 막기는 확인한 뒤에 눌러요.</p>
        </div>
      </div>
      <label htmlFor="nd-text" className="adm-label">공지 문장</label>
      <textarea id="nd-text" className="adm-input nd-text" rows={2} value={text} maxLength={300}
        placeholder="예: 11월 12일(목) 오전 9시~12시 5번 방 에어컨 점검으로 사용할 수 없습니다."
        onChange={(e) => { setText(e.target.value); setDone(null) }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); read() } }} />
      <div className="nd-examples" role="group" aria-label="예시 공지">
        <span className="muted">예시</span>
        {NOTICE_EXAMPLES.map((ex, i) => (
          <button key={ex} type="button" className="nd-ex" onClick={() => { setText(ex); read(ex) }}>예시 {i + 1}</button>
        ))}
      </div>
      <button type="button" className="adm-btn dark nd-go" disabled={!text.trim()} onClick={() => read()}>막기안 만들기</button>

      {draft && d && (
        <div className="nd-out" key={draft.text} aria-live="polite">
          <p className="nd-read" aria-label="읽은 곳">
            {splitBySpans(draft.text, d.spans).map((p, i) => p.kind
              ? <mark key={i} className={`nd-m m-${p.kind}`} style={{ '--d': `${i * 90}ms` } as CSSProperties} title={KIND_LABEL[p.kind]}>{p.text}</mark>
              : <span key={i}>{p.text}</span>)}
          </p>
          <div className="nd-legend" aria-hidden="true">
            {(['date', 'time', 'room', 'reason'] as const).map((k) => <span key={k} className={`nd-key m-${k}`}>{KIND_LABEL[k]}</span>)}
          </div>
          {d.problem ? (
            <p role="alert" className="adm-msg err">{d.problem}</p>
          ) : (
            <div className="nd-draft">
              <div className="nd-draft-h">
                <b>막기안</b>
                <span className="nd-reason">{reasonLabel(d.reason)}</span>
                {d.memo && <span className="nd-memo">"{d.memo}"</span>}
                <span className="nd-count">{d.rows.length}건</span>
              </div>
              <ul className="nd-rows">
                {d.rows.map((r, i) => {
                  const c = conflictsOf(r, reservations).length
                  return (
                    <li key={`${r.roomId}-${r.startAt}`} style={{ '--d': `${300 + i * 60}ms` } as CSSProperties}>
                      <span className="adm-room" aria-hidden="true">{r.roomId}</span>
                      <span className="nd-row-text"><b>{roomName(r.roomId)}</b><span className="muted">{period(r)}</span></span>
                      {c > 0 && <span className="nd-clash">겹친 예약 {c}건</span>}
                    </li>
                  )
                })}
              </ul>
              {d.notes.length > 0 && (
                <ul className="nd-notes" aria-label="짐작한 것, 확인해 주세요">
                  {d.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              )}
              {conflictTotal > 0 && <p className="nd-warn">막으면 이미 잡힌 예약 {conflictTotal}건이 아래 목록에 떠요. 바로 지우지 않고, 확인한 뒤 취소·알림을 보내요.</p>}
              <div className="nd-actions">
                <button type="button" className="adm-btn" onClick={() => blockAll(d)}>이대로 {d.rows.length}건 막기</button>
                <button type="button" className="adm-btn line" onClick={() => onEdit(d.rows[0], d)}>{d.rows.length > 1 ? '첫 건을 양식에서 고치기' : '양식에서 고치기'}</button>
              </div>
              <p className="adm-foot">학생 화면에는 "{reasonStatus(d.reason)}"으로 보여요. 지금은 규칙으로 읽어요(나중에 AI로 바꿔요).</p>
            </div>
          )}
        </div>
      )}
      {done && (
        <p role={done.errors.length ? 'alert' : 'status'} className={`adm-msg ${done.errors.length ? 'err' : 'ok'}`}>
          {done.ok > 0 && <>공지대로 {done.ok}건을 막았어요. </>}
          {done.errors.map((e) => <span key={e} className="nd-err-line">{e}</span>)}
        </p>
      )}
    </section>
  )
}
