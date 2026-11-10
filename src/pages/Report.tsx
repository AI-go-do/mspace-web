import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { currentMemberId } from '../api/client'
import {
  CATEGORIES, clearReportDraft, loadReportDraft, MAX_REPORT_CONTENT, MESSY_RULE, reportErrorMessage, reportProblem, saveReportDraft, submitReport,
  type ReportCategory, type SubmittedReport,
} from '../api/reports'
import PhotoUpload from '../components/PhotoUpload'
import { BackIcon } from '../components/ReserveSteps'
import './Report.css'

const ROOMS = [1, 2, 3, 4, 5]

/** 신고 종류 아이콘(선 그림, 24칸). 색은 글씨색을 따른다 */
const KIND_ICON: Record<ReportCategory, ReactNode> = {
  BROKEN: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></>,
  WINDOW_OPEN: <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M12 3v18M4 12h8" /><path d="m15 9 3-2v10l-3-2" /></>,
  MESSY: <><path d="M4 20h16" /><path d="m6 20 1.5-6h9L18 20" /><path d="M9 10l1-6M15 10l-1-6M12 10V3" /></>,
  NOISE: <><path d="M11 5 6 9H3v6h3l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" /></>,
}

/** 주소의 ?roomId=를 1–5 방 번호로. 없거나 틀리면 null */
function roomFrom(v: string | null): number | null {
  const n = Number(v)
  return ROOMS.includes(n) ? n : null
}

/** 주소의 ?reservationId= (지금 쓰는 예약). 없거나 틀리면 null */
function reservationFrom(v: string | null): number | null {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 방 신고 (FR-RPT-101). 사용 중 카드의 "방에 문제가 있나요?"에서 들어온다(그 방이 골라진 채로).
 * 지금 그 방이나 옆 방을 쓰는 예약자만 보낼 수 있고, 판정 결과는 알림으로 온다.
 * 소음은 "정말 소란인가요?"를 체크해야 보내고, 증명할 수 없어 판정·벌칙 대상이 아니다
 */
export default function Report() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [reservationId] = useState<number | null>(() => reservationFrom(params.get('reservationId')))
  // 주소의 방은 처음 고른 값일 뿐이다. 어질러짐의 "지금 쓰는 방만"은 core가 판단한다(403 REPORT_MESSY_OWN_ROOM_ONLY)
  const [queryRoomId] = useState<number | null>(() => roomFrom(params.get('roomId')))
  const [draft] = useState(() => loadReportDraft(reservationId))
  const [roomId, setRoomId] = useState<number | null>(draft?.roomId ?? queryRoomId)
  const [category, setCategory] = useState<ReportCategory | null>(draft?.category ?? null)
  const [content, setContent] = useState(draft?.content ?? '')
  const [noiseConfirmed, setNoiseConfirmed] = useState(false)
  const [sending, setSending] = useState(false)
  // 사진을 올리는 동안 신고를 보내면 core가 아직 사진이 없다고 거절하니 기다린다
  const [photoBusy, setPhotoBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<SubmittedReport | null>(null)

  const problem = reportProblem({ roomId, category, content, noiseConfirmed })

  // 입실 사진을 올리러 다녀와도 5분 안에 바로 보낼 수 있게 초안을 남긴다 (보내면 지움)
  useEffect(() => {
    if (reservationId !== null && !done) saveReportDraft({ reservationId, roomId, category, content })
  }, [reservationId, roomId, category, content, done])

  async function send(e: FormEvent) {
    e.preventDefault()
    const memberId = currentMemberId()
    if (sending || photoBusy || problem || roomId === null || category === null || memberId === null) return
    setSending(true)
    setError(null)
    try {
      const text = content.trim()
      const sent = await submitReport({
        roomId, category, content: text || undefined,
        noiseConfirmed: category === 'NOISE' ? noiseConfirmed : undefined,
      }, memberId)
      clearReportDraft()
      setDone(sent)
    } catch (err) {
      setError(reportErrorMessage(err))
    } finally {
      setSending(false)
    }
  }

  if (done) {
    return (
      <main className="report">
        <section className="card report-done" role="status">
          <span className="report-done-icon" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
          </span>
          <b className="report-done-title">창작실 {done.roomId} 신고를 보냈어요</b>
          <span className="muted report-done-body">
            {done.category === 'NOISE'
              ? '소음은 관리자가 바로 확인할 수 있게 전해요. 판정·경고 대상은 아니에요.'
              : '관리자가 사진과 기록을 보고 판정하면 알림으로 알려 드려요. 사실이면 앞 사용자에게 경고가 가요.'}
          </span>
          <Link to="/me/reservations" className="btn-primary report-btn">내 예약으로</Link>
        </section>
      </main>
    )
  }

  return (
    <main className="report">
      <header className="report-head">
        <button type="button" className="back" aria-label="뒤로" onClick={() => navigate(-1)}><BackIcon /></button>
        <div>
          <h1>방에 문제가 있나요?</h1>
          <span className="muted report-sub">지금 쓰는 방이나 옆 방을 신고할 수 있어요</span>
        </div>
      </header>

      <form className="report-form" onSubmit={send}>
        <fieldset className="card report-sec">
          <legend>어느 방인가요?</legend>
          <div className="report-rooms">
            {ROOMS.map((n) => (
              <button key={n} type="button" className="report-room" aria-pressed={roomId === n} disabled={sending}
                aria-label={`창작실 ${n}`} onClick={() => setRoomId(n)}>
                <b aria-hidden="true">{n}</b><span aria-hidden="true">창작실</span>
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="card report-sec">
          <legend>무엇이 문제인가요?</legend>
          <div className="report-kinds">
            {CATEGORIES.map((c) => (
              <button key={c.value} type="button" className="report-kind" aria-pressed={category === c.value} disabled={sending}
                onClick={() => { setCategory(c.value); if (c.value !== 'NOISE') setNoiseConfirmed(false) }}>
                <span className="report-kind-icon" aria-hidden="true">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{KIND_ICON[c.value]}</svg>
                </span>
                <b>{c.label}</b><span className="muted">{c.hint}</span>
              </button>
            ))}
          </div>
          {category === 'NOISE' && (
            <label className="agree-check report-noise">
              <input type="checkbox" checked={noiseConfirmed} disabled={sending} onChange={(e) => setNoiseConfirmed(e.target.checked)} />
              정말 소란인가요? 공부를 계속하기 어려울 만큼이에요
            </label>
          )}
          {category === 'MESSY' && <p className="muted report-note" role="note">{MESSY_RULE}</p>}
        </fieldset>

        {/* 어질러짐은 입실 사진이 있어야 보낼 수 있어서(core 409 REPORT_CHECKIN_PHOTO_REQUIRED) 메모처럼 칸으로 바로 받는다.
            이미 올렸으면 다시 골랐을 때 "이미 올라가 있어요"로 바뀐다 */}
        {category === 'MESSY' && reservationId !== null && (
          <PhotoUpload key={`${reservationId}-${currentMemberId()}-report`} reservationId={reservationId} kind="CHECK_IN"
            title="입실 사진 (어질러짐은 필수)" why="들어왔을 때 어질러진 모습을 찍어 주세요. 관리자가 판정할 때 이 사진을 봐요."
            required disabled={sending} onBusyChange={setPhotoBusy} />
        )}

        <div className="card report-sec">
          <label htmlFor="report-content"><b>메모 (선택)</b></label>
          <textarea id="report-content" className="report-text" rows={4} value={content} disabled={sending}
            maxLength={MAX_REPORT_CONTENT + 50} placeholder="어디가 어떻게 문제인지 적어 주세요. 이름·학번은 적지 마세요."
            onChange={(e) => setContent(e.target.value)} />
          <span className="muted report-count">{content.trim().length}/{MAX_REPORT_CONTENT}</span>
        </div>

        <p className="muted report-note">허위 신고가 쌓이면 신고가 14일 정지돼요. 입실 사진을 올려 두면 판정에 도움이 돼요.</p>
        {error && <p role="alert" className="notice">{error}</p>}

        <div className="rs-bar">
          {problem && <p className="count-hint" role="status">{problem}</p>}
          <button className="btn-primary" disabled={!!problem || sending || photoBusy}>{sending ? '보내는 중…' : '신고 보내기'}</button>
        </div>
      </form>
    </main>
  )
}
