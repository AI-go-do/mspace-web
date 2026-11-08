import { useState } from 'react'
import { decideProposal, resetApprentice, undoAutoDone, useApprentice } from '../api/apprentice'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { STREAK_TO_LEVEL_UP, traineeNote, WRONG_REASONS, type Proposal, type Trainee } from '../lib/apprentice'
import { seoulClock } from '../lib/time'
import './AdminApprentice.css'

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `방 ${id}`
const hm = (iso: string) => seoulClock(new Date(iso))

function Notice() {
  const { notice } = useApprentice()
  return <p className="ap-notice" role="status" aria-live="polite">{notice?.text ?? ''}</p>
}

function InboxItem({ p, t }: { p: Proposal; t: Trainee }) {
  const [asking, setAsking] = useState(false)
  return (
    <li className="ap-item">
      <div className="ap-meta">
        <span className="ap-tag">{t.name}</span>
        <span>{roomName(p.roomId)} · {hm(p.createdAt)}</span>
      </div>
      <h3>{p.title}</h3>
      <p className="ap-plan"><b>AI 처리안</b> · {p.plan}</p>
      <ul className="ap-why">{p.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
      {t.locked && <p className="ap-lock">벌이 걸린 일이라 점수와 상관없이 늘 사람이 정해요</p>}
      {!asking ? (
        <div className="ap-acts">
          <button type="button" className="ap-ok" onClick={() => decideProposal(p.id, true)}>맞아요, 이대로</button>
          <button type="button" className="ap-no" onClick={() => setAsking(true)}>아니에요</button>
        </div>
      ) : (
        <div className="ap-acts" role="group" aria-label="어디가 틀렸나요?">
          <span className="muted">어디가 틀렸나요?</span>
          {WRONG_REASONS.map((r) => (
            <button key={r} type="button" className="ap-chip" onClick={() => decideProposal(p.id, false, r)}>{r}</button>
          ))}
          <button type="button" className="ap-no" onClick={() => setAsking(false)}>취소</button>
        </div>
      )}
    </li>
  )
}

/** "지금" 탭 오른쪽 결재함: AI 처리안을 사람이 [맞아요]/[아니에요]로 채점한다 */
export function ApprenticeInbox() {
  const { state } = useApprentice()
  return (
    <aside className="card ap-inbox" aria-labelledby="ap-inbox-h">
      <h2 id="ap-inbox-h">사람이 볼 일 <span className="ap-count">{state.inbox.length}</span></h2>
      <p className="ap-sub">AI가 처리안과 이유를 올려요. 맞으면 점수가 쌓이고, 점수가 쌓인 일은 AI가 먼저 처리해요.</p>
      <Notice />
      {state.inbox.length === 0 ? (
        <div className="ap-empty"><b>지금은 사람이 볼 일이 없어요</b><span className="muted">AI가 처리한 일은 "AI 수습사원" 탭에 남아요</span></div>
      ) : (
        <ul className="ap-list">
          {state.inbox.map((p) => <InboxItem key={p.id} p={p} t={state.trainees.find((t) => t.kind === p.kind)!} />)}
        </ul>
      )}
      <p className="ap-mock muted">가짜 값 단계라 [맞아요]를 눌러도 학생에게 아무것도 보내지 않아요.</p>
    </aside>
  )
}

const LEVELS = [
  { level: 1, title: '제안만 해요', text: '사람이 [맞아요]를 눌러야 실행' },
  { level: 2, title: '먼저 하고 보고해요', text: '실행한 뒤 아침 보고에 남기고 언제든 되돌리기' },
  { level: 3, title: '혼자 해요', text: '기록은 남고 되돌릴 수 있어요' },
]

function TraineeCard({ t, flash }: { t: Trainee; flash: 'up' | 'down' | null }) {
  const filled = t.locked ? 0 : t.level >= t.maxLevel ? STREAK_TO_LEVEL_UP : t.streak
  return (
    <li className={`ap-rec ${flash ? `fx-${flash}` : ''}`}>
      <div className="ap-rec-top">
        <b>{t.name}</b>
        <span className={`ap-lv l${t.locked ? 'x' : t.level}`}>{t.locked ? '사람만' : `레벨 ${t.level}`}</span>
        <span className="muted">맞힘 {t.right}/{t.total}</span>
      </div>
      <div className="ap-dots" role="img" aria-label={`연속 ${filled}/${STREAK_TO_LEVEL_UP}`}>
        {Array.from({ length: STREAK_TO_LEVEL_UP }, (_, i) => <i key={i} className={i < filled ? 'on' : ''} />)}
      </div>
      <small className="muted">{traineeNote(t)}</small>
    </li>
  )
}

/**
 * "AI 수습사원" 탭: 레벨 설명, 일 종류별 인사 기록 카드, AI가 먼저 처리한 일(아침 보고)과 [되돌리기].
 * 경고·정지 같은 벌은 레벨 1 고정이라 늘 사람이 정한다
 */
export function AdminApprentice() {
  const { state, notice } = useApprentice()
  const flashFor = (t: Trainee) => (notice?.kind === t.kind && (notice.result === 'up' || notice.result === 'down') ? notice.result : null)
  return (
    <section className="ap-wrap" aria-label="AI 수습사원">
      <div className="ap-levels">
        {LEVELS.map((l) => (
          <div key={l.level} className="card ap-level">
            <span className={`ap-lv l${l.level}`}>레벨 {l.level}</span>
            <b>{l.title}</b>
            <span className="muted">{l.text}</span>
          </div>
        ))}
      </div>
      <Notice />
      <div className="ap-two">
        <section className="card ap-sec" aria-labelledby="ap-rec-h">
          <h2 id="ap-rec-h">AI 인사 기록 카드</h2>
          <p className="ap-sub">일 종류마다 따로 채점해요. {STREAK_TO_LEVEL_UP}번 연속 맞으면 한 단계 올라가고, 틀리거나 되돌리면 바로 내려가요.</p>
          <ul className="ap-recs">{state.trainees.map((t) => <TraineeCard key={t.kind} t={t} flash={flashFor(t)} />)}</ul>
        </section>
        <section className="card ap-sec" aria-labelledby="ap-log-h">
          <h2 id="ap-log-h">AI가 먼저 처리한 일 <span className="ap-tag">아침 보고</span></h2>
          <p className="ap-sub">잘못됐으면 되돌리세요. 그 종류는 다시 먼저 물어봐요.</p>
          {state.done.length === 0 ? <p className="muted ap-small">아직 AI가 먼저 처리한 일이 없어요.</p> : (
            <ul className="ap-log">
              {state.done.map((d) => {
                const t = state.trainees.find((x) => x.kind === d.kind)!
                return (
                  <li key={d.id} className={d.undone ? 'undone' : ''}>
                    <span className="ap-time">{hm(d.doneAt)}</span>
                    <div className="ap-log-text">
                      <b>{d.plan}</b>
                      <span className="muted">{roomName(d.roomId)} · {t.name} · 레벨 {d.level}에서 처리</span>
                    </div>
                    {d.undone ? <span className="ap-tag">되돌림</span>
                      : <button type="button" className="ap-no" onClick={() => undoAutoDone(d.id)}>되돌리기</button>}
                  </li>
                )
              })}
            </ul>
          )}
          <dl className="ap-stats">
            <div><dt>AI가 먼저 처리</dt><dd>{state.done.length}건</dd></div>
            <div><dt>사람이 본 일</dt><dd>{state.stats.human}건</dd></div>
            <div><dt>되돌림</dt><dd>{state.stats.undone}건</dd></div>
          </dl>
        </section>
      </div>
      <p className="ap-mock muted">
        가짜 값 단계예요. 기록은 이 브라우저에만 남고 학생에게 아무것도 보내지 않아요.{' '}
        <button type="button" className="linkish" onClick={resetApprentice}>가짜 기록 처음으로</button>
      </p>
    </section>
  )
}
