import { useState, type CSSProperties } from 'react'
import { decideProposal, resetApprentice, undoAutoDone, useApprentice } from '../api/apprentice'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { STREAK_TO_LEVEL_UP, traineeNote, WRONG_REASONS, type Proposal, type Trainee } from '../lib/apprentice'
import { seoulClock } from '../lib/time'
import { useCountUp } from '../lib/useCountUp'
import './AdminApprentice.css'

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`
const hm = (iso: string) => seoulClock(new Date(iso))
/** 카드가 빠져나가는 시간 (CSS .leaving과 같게) */
const LEAVE_MS = 420

export function Notice() {
  const { notice } = useApprentice()
  return <p key={notice?.text ?? ''} className="ap-notice" role="status" aria-live="polite">{notice?.text ?? ''}</p>
}

/** AI 처리안 한 건. [맞아요]면 파랑 체크, [아니에요]면 이유를 고르고 카드가 접히며 빠진다 */
export function InboxItem({ p, t, i = 0 }: { p: Proposal; t: Trainee; i?: number }) {
  const [asking, setAsking] = useState(false)
  const [leaving, setLeaving] = useState<'ok' | 'no' | null>(null)
  const decide = (ok: boolean, reason?: string) => {
    if (leaving) return
    setLeaving(ok ? 'ok' : 'no')
    setTimeout(() => decideProposal(p.id, ok, reason), LEAVE_MS)
  }
  return (
    <li className={`card ap-item ${leaving ? `leaving ${leaving}` : ''}`} style={{ '--k': i } as CSSProperties}>
      <div className="adm-meta">
        <span className="ap-tag">{t.name}</span>
        <span>{roomName(p.roomId)} · {hm(p.createdAt)}</span>
        <span className={`ap-lv l${t.locked ? 'x' : t.level}`}>{t.locked ? '사람만' : `레벨 ${t.level}`}</span>
      </div>
      <h3>{p.title}</h3>
      <div className="ap-plan">
        <span className="ap-spark" aria-hidden="true">✦</span>
        <div><b>AI 처리안</b><p>{p.plan}</p></div>
      </div>
      <ul className="ap-why">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {t.locked && <p className="ap-lock">벌이 걸린 일이라 점수와 상관없이 늘 사람이 정해요</p>}
      {!asking ? (
        <div className="ap-acts">
          <button type="button" className="adm-btn" onClick={() => decide(true)}>맞아요, 이대로</button>
          <button type="button" className="adm-btn line" onClick={() => setAsking(true)}>아니에요</button>
        </div>
      ) : (
        <div className="ap-acts ask" role="group" aria-label="어디가 틀렸나요?">
          <span className="adm-small">어디가 틀렸나요?</span>
          {WRONG_REASONS.map((r) => (
            <button key={r} type="button" className="adm-mini" onClick={() => decide(false, r)}>{r}</button>
          ))}
          <button type="button" className="adm-link" onClick={() => setAsking(false)}>취소</button>
        </div>
      )}
      {leaving && <span className={`ap-done-mark ${leaving}`} aria-hidden="true">{leaving === 'ok' ? '✓' : '↺'}</span>}
    </li>
  )
}

const LEVELS = [
  { level: 1, title: '제안만 해요', text: '사람이 [맞아요]를 눌러야 실행' },
  { level: 2, title: '먼저 하고 보고해요', text: '실행한 뒤 아침 보고에 남기고 언제든 되돌리기' },
  { level: 3, title: '혼자 해요', text: '기록은 남고 되돌릴 수 있어요' },
]

/** 일 종류 하나의 인사 기록 카드. 연속 맞힘 칸이 차례로 채워지고, 레벨이 바뀌면 카드가 반짝인다 */
function TraineeCard({ t, flash, i }: { t: Trainee; flash: 'up' | 'down' | null; i: number }) {
  const filled = t.locked ? 0 : t.level >= t.maxLevel ? STREAK_TO_LEVEL_UP : t.streak
  const rate = t.total ? Math.round((t.right / t.total) * 100) : null
  return (
    <li className={`card ap-rec ${flash ? `fx-${flash}` : ''} ${t.locked ? 'locked' : ''}`} style={{ '--k': i } as CSSProperties}>
      <div className="ap-rec-top">
        <span className={`ap-lv-big l${t.locked ? 'x' : t.level}`} aria-hidden="true">{t.locked ? '🔒' : t.level}</span>
        <div className="ap-rec-name">
          <b>{t.name}</b>
          <span className="adm-small">{t.locked ? '사람만 정해요' : `레벨 ${t.level} · 최고 ${t.maxLevel}`}</span>
        </div>
        <span className="ap-rate">{rate === null ? '—' : `${rate}%`}<small>맞힘 {t.right}/{t.total}</small></span>
      </div>
      <div className="ap-dots" role="img" aria-label={`연속 ${filled}/${STREAK_TO_LEVEL_UP}`}>
        {Array.from({ length: STREAK_TO_LEVEL_UP }, (_, k) => <i key={k} className={k < filled ? 'on' : ''} style={{ '--d': k } as CSSProperties} />)}
      </div>
      <small className="adm-small">{traineeNote(t)}</small>
    </li>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  const shown = useCountUp(value)
  return <div className="ap-stat"><dt>{label}</dt><dd><span aria-hidden="true">{shown}<small>건</small></span><span className="sr-only">{value}건</span></dd></div>
}

/**
 * "AI 수습사원": 레벨 설명, 일 종류별 인사 기록 카드, AI가 먼저 처리한 일(아침 보고)과 [되돌리기].
 * 경고·정지 같은 벌은 레벨 1 고정이라 늘 사람이 정한다
 */
export function AdminApprentice() {
  const { state, notice } = useApprentice()
  const flashFor = (t: Trainee) => (notice?.kind === t.kind && (notice.result === 'up' || notice.result === 'down') ? notice.result : null)
  return (
    <section className="ap-wrap" aria-label="AI 수습사원">
      <ol className="ap-steps">
        {LEVELS.map((l, i) => (
          <li key={l.level} className={`ap-step l${l.level}`} style={{ '--k': i } as CSSProperties}>
            <span className="ap-step-no">{l.level}</span>
            <div><b>{l.title}</b><span>{l.text}</span></div>
          </li>
        ))}
      </ol>
      <Notice />
      <div className="ap-two">
        <section className="ap-sec" aria-labelledby="ap-rec-h">
          <div className="adm-sec-h">
            <h2 id="ap-rec-h">인사 기록 카드</h2>
            <p>{STREAK_TO_LEVEL_UP}번 연속 맞으면 한 단계 올라가고, 틀리거나 되돌리면 바로 내려가요.</p>
          </div>
          <ul className="ap-recs">{state.trainees.map((t, i) => <TraineeCard key={t.kind} t={t} i={i} flash={flashFor(t)} />)}</ul>
        </section>
        <section className="ap-sec" aria-labelledby="ap-log-h">
          <div className="adm-sec-h">
            <h2 id="ap-log-h">AI가 먼저 처리한 일 <span className="ap-tag">아침 보고</span></h2>
            <p>잘못됐으면 되돌리세요. 그 종류는 다시 먼저 물어봐요.</p>
          </div>
          <dl className="ap-stats">
            <Stat label="AI가 먼저 처리" value={state.done.length} />
            <Stat label="사람이 본 일" value={state.stats.human} />
            <Stat label="되돌림" value={state.stats.undone} />
          </dl>
          <div className="card ap-log-card">
            {state.done.length === 0 ? <p className="adm-small">아직 AI가 먼저 처리한 일이 없어요.</p> : (
              <ul className="ap-log">
                {state.done.map((d, i) => {
                  const t = state.trainees.find((x) => x.kind === d.kind)!
                  return (
                    <li key={d.id} className={d.undone ? 'undone' : ''} style={{ '--k': i } as CSSProperties}>
                      <span className="ap-time">{hm(d.doneAt)}</span>
                      <div className="ap-log-text">
                        <b>{d.plan}</b>
                        <span className="adm-small">{roomName(d.roomId)} · {t.name} · 레벨 {d.level}에서 처리</span>
                      </div>
                      {d.undone ? <span className="ap-tag">되돌림</span>
                        : <button type="button" className="adm-mini" onClick={() => undoAutoDone(d.id)}>되돌리기</button>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
      <p className="adm-foot">
        시연 기록{' '}
        <button type="button" className="adm-link" onClick={resetApprentice}>처음으로</button>
      </p>
    </section>
  )
}
