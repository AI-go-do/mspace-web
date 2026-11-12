import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { resetAppeals, sendAppeal, useWarnings } from '../api/appeal'
import { appealButtonLabel, appealStep, APPEAL_RULES, canAppeal, confidenceLabel, draftAppeal, forEvidence, statusLabel, WARNING_LABEL, type WarningRecord } from '../lib/appeal'
import { timeRange } from '../lib/format'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import Spacey from './Spacey'
import './PenaltyHistory.css'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/**
 * 내 경고 목록 + 경고 철회 요청 (FR-RPT-105, 웹 화면만 가짜 단계). 이용 규칙 화면 "내 경고 N회" 아래에 경고마다
 * 왜 받았는지·근거 기록·철회 요청 상태를 보여 준다. 같은 요청은 내 예약 > 지난 예약 카드 버튼에서도 연다(PastWarnings).
 * core #111 API가 없어 ?demo=1일 때만 그린다(Rules.tsx). 보낸 요청은 이 탭에만 남고, AI 판단도 예시 규칙이다
 */
export function PenaltyHistory() {
  const list = useWarnings()
  const [writing, setWriting] = useState<WarningRecord | null>(null)
  const [justSent, setJustSent] = useState<number | null>(null)
  const now = new Date()
  const open = list.filter((w) => canAppeal(w, now)).length
  return (
    <section className="card ph" aria-labelledby="ph-title">
      <div className="ph-head">
        <h2 id="ph-title">왜 받았나요</h2>
        <span className="sample">예시</span>
      </div>
      <p className="ph-lead">{open > 0 ? <b>철회 요청 가능 {open}건</b> : `철회 요청은 ${APPEAL_RULES.days}일 안`}</p>
      <ul className="ph-list">
        {list.map((w, i) => (
          <WarningItem key={w.id} w={w} i={i} now={now} fresh={justSent === w.id} onWrite={() => setWriting(w)} />
        ))}
      </ul>
      <p className="ph-foot">

        <button type="button" className="ph-link" onClick={() => { resetAppeals(); setJustSent(null) }}>예시 처음으로</button>
      </p>
      {writing && (
        <AppealSheet w={writing} onClose={() => setWriting(null)} onSent={() => { setJustSent(writing.id) }} />
      )}
    </section>
  )
}

function WarningItem({ w, i, now, fresh, onWrite }: { w: WarningRecord; i: number; now: Date; fresh: boolean; onWrite: () => void }) {
  const [openLog, setOpenLog] = useState(false)
  const st = statusLabel(w, now)
  const can = canAppeal(w, now)
  const button = appealButtonLabel(w, now)
  const day = dayLabel(seoulDate(new Date(w.startAt)))
  const forCount = forEvidence(w).length
  const logId = `ph-log-${w.id}`
  return (
    <li className={`ph-item t-${st.tone}`} style={{ '--d': `${i * 70}ms` } as CSSProperties}>
      <div className="ph-top">
        <span className={`ph-kind k-${w.kind}`}>{WARNING_LABEL[w.kind]}</span>
        <span className={`ph-pill p-${st.tone}`}>{st.text}</span>
      </div>
      <b className={`ph-when ${w.appeal?.status === 'ACCEPTED' ? 'struck' : ''}`}>{w.roomId}번 방 · {day} {timeRange(w.startAt, w.endAt)}</b>
      <p className="ph-why">{w.why}</p>

      <button type="button" className="ph-toggle" aria-expanded={openLog} aria-controls={logId} onClick={() => setOpenLog((v) => !v)}>
        근거 기록 {w.evidence.length}개 {openLog ? '접기' : '보기'}
        {!openLog && forCount > 0 && !w.appeal && <span className="ph-hint">요청에 쓸 만한 기록 {forCount}개</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={openLog ? 'up' : ''}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {openLog && (
        <ol id={logId} className="ph-tl">
          {w.evidence.map((e, j) => (
            <li key={j} className={e.tone === 'for' ? 'for' : ''} style={{ '--d': `${j * 80}ms` } as CSSProperties}>
              <time dateTime={e.at}>{seoulClock(new Date(e.at))}</time>
              <span className="ph-src">{e.source}</span>
              <span className="ph-txt">{e.text}</span>
            </li>
          ))}
        </ol>
      )}

      {w.appeal && <AppealProgress w={w} fresh={fresh} />}
      {can && button && <button type="button" className="btn-primary ph-write" onClick={onWrite}>{button}</button>}
    </li>
  )
}

/** 보냄 → AI가 다시 비교 → 결과. 방금 보냈으면 첫 칸이 채워지며 도장이 찍힌다. 관리자는 정하지 않는다(FR-RPT-105) */
export function AppealProgress({ w, fresh }: { w: WarningRecord; fresh: boolean }) {
  const a = w.appeal!
  const step = appealStep(a)
  const result = a.status === 'ACCEPTED' ? '경고를 철회했어요' : a.status === 'REJECTED' ? '경고는 그대로예요' : '결과'
  const sure = confidenceLabel(a.confidence)
  return (
    <div className={`ph-appeal s-${a.status} ${fresh ? 'fresh' : ''}`} aria-live="polite">
      <ol className="ph-steps" aria-label={`철회 요청 진행 3단계 중 ${step}단계`} style={{ '--n': step } as CSSProperties}>
        <li className={step >= 1 ? 'on' : ''}>보냄</li>
        <li className={step >= 2 || a.status !== 'SENT' ? 'on' : 'cur'}>AI가 다시 비교</li>
        <li className={step >= 3 ? 'on' : ''}>{result}</li>
      </ol>
      <p className="ph-said"><span className="muted">내가 보낸 철회 요청 · {dayLabel(seoulDate(new Date(a.sentAt)))} {seoulClock(new Date(a.sentAt))}</span>{a.text}</p>
      {a.answer && <p className="ph-answer"><b>AI 답{sure ? ` · ${sure}` : ''}</b>{a.answer}</p>}
      {a.status === 'SENT' && <p className="ph-wait muted">AI가 근거 기록과 같이 다시 비교하고 알림으로 알려 드려요.</p>}
      {fresh && a.status === 'SENT' && <span className="ph-stamp" aria-hidden="true">보냄</span>}
    </div>
  )
}

/** 철회 요청 아래 시트: 같이 보낼 근거 고르기 + 비서가 쓴 초안(고쳐 써도 됨). 내 예약 화면도 같이 쓴다 */
export function AppealSheet({ w, onClose, onSent }: { w: WarningRecord; onClose: () => void; onSent: () => void }) {
  const [picked, setPicked] = useState<number[]>(() => forEvidence(w))
  const full = draftAppeal(w, picked)
  const [text, setText] = useState(() => (reduced() ? full : ''))
  const [typing, setTyping] = useState(() => !reduced())
  const [edited, setEdited] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)

  // 처음 열면 비서가 초안을 한 글자씩 써 내려간다(동작 줄이기면 바로 다 보임). 누르거나 키를 치면 바로 끝까지
  useEffect(() => {
    if (!typing) return
    let n = 0
    const t = setInterval(() => {
      n += 2
      setText(full.slice(0, n))
      if (n >= full.length) { clearInterval(t); setTyping(false) }
    }, 16)
    return () => clearInterval(t)
    // typing이 false가 되면(누름·키·근거 바꿈) 바로 멈춘다. 그동안 full은 바뀌지 않는다(toggle이 먼저 typing을 끈다)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typing])

  // 학생이 아직 손대지 않았으면 근거를 바꿀 때 초안도 다시 쓴다
  function toggle(j: number) {
    const next = picked.includes(j) ? picked.filter((x) => x !== j) : [...picked, j].sort((a, b) => a - b)
    setPicked(next)
    if (!edited) { setTyping(false); setText(draftAppeal(w, next)) }
  }

  function finishTyping() {
    if (typing) { setTyping(false); setText(full) }
  }

  function submit() {
    const problem = sendAppeal(w.id, text, picked)
    if (problem) { setError(problem); area.current?.focus(); return }
    setSent(true)
    onSent()
  }

  const forCount = forEvidence(w).length
  return (
    <div className="sheet-wrap">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet ph-sheet" role="dialog" aria-modal="true" aria-labelledby="ph-sheet-title">
        {sent ? (
          <div className="ph-done" role="status">
            <span className="ph-done-mark" aria-hidden="true">
              <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5 10 17.5 19 7" pathLength={1} /></svg>
            </span>
            <h2 id="ph-sheet-title">철회 요청을 보냈어요</h2>
            <p className="muted">AI가 근거 기록 {picked.length}개와 같이 다시 비교하고 알림으로 알려 드려요. 그동안 경고는 "AI가 다시 보는 중"으로 보여요.</p>
            <button type="button" className="btn-primary" autoFocus onClick={onClose}>확인</button>
          </div>
        ) : (
          <>
            <h2 id="ph-sheet-title">{WARNING_LABEL[w.kind]} 경고 철회 요청</h2>
            <div className="ph-butler">
              <span className="ph-butler-face" aria-hidden="true"><Spacey size={30} label="" /></span>
              <p>{forCount > 0
                ? <>기록에서 요청에 쓸 만한 근거를 <b>{forCount}개</b> 찾아 초안을 써 뒀어요. 고쳐 써도 돼요.</>
                : <>이 경고에는 요청에 쓸 만한 기록이 없었어요. 어떤 일이 있었는지 직접 적어 주세요.</>}</p>
            </div>
            <fieldset className="ph-pick">
              <legend>같이 보낼 기록</legend>
              {w.evidence.map((e, j) => (
                <label key={j} className={picked.includes(j) ? 'on' : ''}>
                  <input type="checkbox" checked={picked.includes(j)} onChange={() => toggle(j)} />
                  <time dateTime={e.at}>{seoulClock(new Date(e.at))}</time>
                  <span>{e.text}</span>
                </label>
              ))}
            </fieldset>
            <label htmlFor="ph-text" className="ph-label">철회 요청 이유 <small>{text.trim().length}/{APPEAL_RULES.maxChars}</small></label>
            <textarea
              id="ph-text" ref={area} className={`ph-text ${typing ? 'typing' : ''}`} rows={5} value={text}
              maxLength={APPEAL_RULES.maxChars + 50}
              aria-invalid={error != null} aria-describedby="ph-privacy"
              onPointerDown={finishTyping} onKeyDown={finishTyping}
              onChange={(e) => { setText(e.target.value); setEdited(true); setError(null) }}
            />
            <p id="ph-privacy" className="ph-privacy muted">받은 뒤 {APPEAL_RULES.days}일 안, 경고마다 한 번 보낼 수 있어요. 이름·학번·전화번호는 적지 않아도 돼요. AI는 예약 기록으로 다시 봐요.</p>
            {error && <p role="alert" className="ph-err">{error}</p>}
            <div className="sheet-actions">
              <button type="button" className="btn-line" onClick={onClose}>닫기</button>
              <button type="button" className="btn-primary" disabled={typing} onClick={submit}>보내기</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
