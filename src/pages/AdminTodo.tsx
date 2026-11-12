import { useEffect, useState } from 'react'
import { currentMemberId } from '../api/client'
import { onReportsChanged } from '../lib/reportsBus'
import { useMemberId } from '../lib/useMemberId'
import { adminErrorMessage, getReports, getTidyChecks } from '../api/admin'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { judgeCounts, judgeRows, type JudgeRow } from '../lib/judgeLog'
import { useApprentice } from '../api/apprentice'
import type { Proposal } from '../lib/apprentice'
import { InboxItem, Notice } from './AdminApprentice'
import { ReportList } from './AdminReports'
import { RestProposals } from './AdminRest'
import { POLL_MS } from '../lib/poll'
import { demoOn } from '../lib/demo'

/**
 * "할 일": 사람이 정해야 하는 일을 한곳에. 신고 판정(core, 실제 API)과 AI 처리안(가짜 단계)을 같이 보여 준다.
 * AI의 "신고 판정 초안"은 실제 신고 카드와 겹쳐서 여기에는 올리지 않는다(신고는 늘 사람이 판정, 레벨 1 고정)
 */
export const inTodo = (p: Proposal) => p.kind !== 'report'

/** reportsKnown: 신고 수를 확인했나(불러오는 중·실패면 false). reportsFailed: 마지막 요청이 실패했나 */
export type TodoCounts = {
  reports: number; reportsKnown: boolean; reportsFailed: boolean; ai: number; total: number
  /** 방마다 판정 기다리는 신고 수 ("지금" 화면 방 표시용). 확인 못 했으면 빈 칸 */
  byRoom: Record<number, number>
}

/**
 * 메뉴 숫자: 판정 기다리는 신고 + AI 처리안. 신고 수를 한 번도 못 받았거나 마지막 갱신이 실패하면
 * reportsKnown=false (0건과 "모름"을 구분해 "사람이 볼 일이 없어요"라고 잘못 말하지 않게). 다음 차례에 다시 센다
 */
export function useTodoCounts(): TodoCounts {
  const ai = useApprentice().state.inbox.filter(inTodo).length
  const member = useMemberId()
  // 누구의 숫자인지 같이 들고, 로그인한 회원이 바뀌면 앞 사람 숫자는 버린다(모름으로 돌아감)
  const [res, setRes] = useState<{ member: number | null; n: number | null; failed: boolean; byRoom: Record<number, number> }>(
    { member: null, n: null, failed: false, byRoom: {} })
  useEffect(() => {
    let stale = false
    let ctrl: AbortController | null = null
    const load = () => {
      if (member === null || stale || currentMemberId() !== member) return
      ctrl?.abort()
      const mine = new AbortController()
      ctrl = mine
      const timer = setTimeout(() => mine.abort(), 10_000)
      getReports('OPEN', mine.signal, member)
        .then((l) => {
          if (stale || ctrl !== mine) return
          const counted = l.filter((r) => r.category !== 'NOISE')
          const byRoom: Record<number, number> = {}
          for (const r of counted) byRoom[r.roomId] = (byRoom[r.roomId] ?? 0) + 1
          setRes({ member, n: counted.length, failed: false, byRoom })
        })
        .catch(() => { if (!stale && ctrl === mine) setRes((p) => ({ member, n: p.member === member ? p.n : null, failed: true, byRoom: p.member === member ? p.byRoom : {} })) })
        .finally(() => clearTimeout(timer))
    }
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    // 신고 판정이 끝나면 숫자를 다시 센다
    const stop = onReportsChanged(load)
    return () => { stale = true; clearInterval(t); ctrl?.abort(); stop() }
  }, [member])
  const mineNow = res.member === member && member !== null
  const reports = mineNow ? res.n : null
  const failed = mineNow && res.failed
  const known = reports !== null && !failed
  // 확인하지 못한 신고 수는 합계에 넣지 않는다(옛 숫자를 확인된 것처럼 보이지 않게). 합계는 그때 "AI 제안 수 이상"
  const shown = known ? reports : 0
  return { reports: shown, reportsKnown: known, reportsFailed: failed, ai, total: shown + ai, byRoom: known ? res.byRoom : {} }
}

/**
 * 오디가 판정·처리한 기록 (10차 회의·11/10 재웅: 관리자는 보기만, 판단은 AI).
 * core에 쌓인 신고 판정(판정기)과 방 카메라 정리 확인을 최근 순으로 보여 준다(lib/judgeLog). 시연 값(?demo=1)이면 예시.
 * 판정기 확신도·근거는 core가 목록에 붙이면 같이 보인다(발표의 "AI 판단 신뢰도" 표와 이어짐)
 */
type Judgement = { at: string; room: string; what: string; verdict: string; sure: number; why: string; tone: 'warn' | 'ok' | 'off' }
const SAMPLE_JUDGEMENTS: Judgement[] = [
  { at: '13:42', room: '창작실 2', what: '예약이 끝났는데 사람이 남아 있음 (#1042)', verdict: '경고 1회 · 대표자에게 알림', sure: 96, why: "끝난 뒤 19분째 재실 센서 '있음', 퇴실 안내 뒤 10분 더 지켜봄", tone: 'warn' },
  { at: '13:20', room: '창작실 3', what: '어질러짐 신고 (학생)', verdict: '경고 없음 · 신고자에게 결과 알림', sure: 88, why: '입실 사진과 퇴실 사진이 거의 같아요. 의자 1개만 옮겨짐', tone: 'ok' },
  { at: '12:55', room: '창작실 4', what: 'CO2가 59분째 같은 값', verdict: '센서 고장으로 보고 장치 담당에게 넘김', sure: 91, why: '재실 센서는 움직이는데 CO2만 변화 없음', tone: 'off' },
  { at: '11:30', room: '창작실 1', what: '두고 간 물건 (카메라)', verdict: '대표자에게 2시간 안에 가져가라고 알림', sure: 84, why: '퇴실 뒤 빈 방 사진에서 책상 위 물건 1개', tone: 'warn' },
  { at: '10:05', room: '창작실 5', what: '경고 철회 요청', verdict: '철회 · 경고 지움', sure: 72, why: '확신도가 기준(80%)보다 낮아 "확인 불가 = 철회" 규칙', tone: 'ok' },
]

/** 실제 판정 기록: 신고와 방 카메라 정리 확인(최근 7일). 1분마다 다시 읽는다 */
const JUDGE_DAYS = 7
/** 한 번에 그리는 줄 수. 넘으면 [더 보기] */
const JUDGE_PAGE = 60
type JudgeSource = 'reports' | 'tidy'
const SOURCE_LABEL: Record<JudgeSource, string> = { reports: '신고 판정', tidy: '방 카메라 정리 확인' }
type JudgeState = { member: number | null; rows: JudgeRow[] | null; failed: JudgeSource[]; error: string | null }

/**
 * 두 창구를 따로 기다린다. 하나가 실패해도 다른 쪽 기록은 보여 주고, 실패한 쪽은 옛 값을 쓰지 않고 빠졌다고 알린다
 * (숫자가 전부인 것처럼 보이지 않게)
 */
function useJudgeRows(): Omit<JudgeState, 'member'> {
  const member = useMemberId()
  const [state, setState] = useState<JudgeState>({ member: null, rows: null, failed: [], error: null })
  useEffect(() => {
    if (member === null) return
    let stale = false
    let ctrl: AbortController | null = null
    const load = () => {
      if (stale || currentMemberId() !== member) return
      ctrl?.abort()
      const mine = new AbortController()
      ctrl = mine
      const timer = setTimeout(() => mine.abort(), 15_000)
      Promise.allSettled([getReports(null, mine.signal, member), getTidyChecks(JUDGE_DAYS, mine.signal, member)])
        .then(([reports, tidy]) => {
          if (stale || ctrl !== mine) return
          const failed: JudgeSource[] = []
          if (reports.status === 'rejected') failed.push('reports')
          if (tidy.status === 'rejected') failed.push('tidy')
          const firstError = reports.status === 'rejected' ? reports.reason : tidy.status === 'rejected' ? tidy.reason : null
          if (failed.length === 2) {
            // 둘 다 못 받았으면 줄은 비우고 오류만
            setState({ member, rows: null, failed, error: adminErrorMessage(firstError) })
            return
          }
          const rows = judgeRows(
            reports.status === 'fulfilled' ? reports.value : [],
            tidy.status === 'fulfilled' ? tidy.value : [],
            roomName, new Date(), JUDGE_DAYS)
          setState({ member, rows, failed, error: null })
        })
        .finally(() => clearTimeout(timer))
    }
    load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') load() }, POLL_MS)
    const stop = onReportsChanged(load)
    return () => { stale = true; clearInterval(t); ctrl?.abort(); stop() }
  }, [member])
  return state.member === member ? { rows: state.rows, failed: state.failed, error: state.error } : { rows: null, failed: [], error: null }
}

const roomName = (id: number) => ADMIN_ROOMS.find((r) => r.roomId === id)?.name ?? `${id}번 방`

function JudgeItem({ j }: { j: Pick<JudgeRow, 'day' | 'time' | 'room' | 'by' | 'what' | 'verdict' | 'sure' | 'why' | 'tone'> }) {
  return (
    <li className={`jl-item t-${j.tone}`}>
      <time>{j.day && <small>{j.day}</small>}{j.time}</time>
      <div className="jl-main">
        <small>{j.room} · {j.what}</small>
        <b>{j.verdict}</b>
        {(j.by || j.why) && <span>{[j.by, j.why].filter(Boolean).join(' · ')}</span>}
      </div>
      {j.sure !== null && <span className="jl-sure" title="확신도">{j.sure}%</span>}
    </li>
  )
}

function JudgeLog() {
  const { rows, failed, error } = useJudgeRows()
  const [visible, setVisible] = useState(JUDGE_PAGE)
  if (demoOn()) {
    return (
      <ol className="jl">
        {SAMPLE_JUDGEMENTS.map((j) => (
          <JudgeItem key={j.at + j.room} j={{ day: null, time: j.at, room: j.room, by: '오디', what: j.what, verdict: j.verdict, sure: j.sure, why: j.why, tone: j.tone }} />
        ))}
      </ol>
    )
  }
  if (rows === null) {
    return error
      ? <p role="alert" className="adm-msg err">{error}</p>
      : <div className="jl jl-skel" aria-busy="true" aria-label="불러오는 중" />
  }
  // 숫자는 자르기 전 전체로 센다
  const n = judgeCounts(rows)
  const shown = rows.slice(0, visible)
  return (
    <>
      <div className="jl-sum" role="group" aria-label={`최근 ${JUDGE_DAYS}일${failed.length ? ' (일부만)' : ''}`}>
        <span><b>{n.done}{failed.length ? '+' : ''}</b>판정</span>
        <span><b>{n.warned}{failed.length ? '+' : ''}</b>경고·신고</span>
        <span><b>{n.waiting}{failed.length ? '+' : ''}</b>판정 중</span>
      </div>
      {failed.length > 0 && <p role="alert" className="adm-msg err">{failed.map((f) => SOURCE_LABEL[f]).join('·')} 기록을 못 불러왔어요. 잠시 뒤 다시 읽어요.</p>}
      {rows.length === 0
        ? failed.length === 0 && <div className="adm-empty"><b>아직 판정한 일이 없어요</b></div>
        : <ol className="jl">{shown.map((j) => <JudgeItem key={j.key} j={j} />)}</ol>}
      {rows.length > shown.length && (
        <button type="button" className="adm-link jl-more" onClick={() => setVisible((v) => v + JUDGE_PAGE)}>{Math.min(JUDGE_PAGE, rows.length - shown.length)}건 더 보기</button>
      )}
    </>
  )
}

/** counts는 Admin이 가진 것을 받는다(같은 신고 수를 두 번 읽지 않게) */
export function AdminTodo({ counts, onForceCheckout, onOpenRooms }: { counts: TodoCounts; onForceCheckout: (reservationId: number) => void; onOpenRooms: () => void }) {
  const { state } = useApprentice()
  const ai = state.inbox.filter(inTodo)
  return (
    <section className="todo" aria-label="오디 판단 기록">
      <JudgeLog />
      {demoOn() && <p className="adm-foot">시연 값이에요. 확신도가 기준보다 낮으면 경고하지 않거나 철회해요(Q-24 제안). 기준 숫자는 팀 규칙 전 임시 값이에요.</p>}
      <details className="jl-manual">
        <summary>비상시 직접 판정 · 판정 기다리는 신고 {counts.reportsKnown ? counts.reports : '?'}건 · AI 제안 {counts.ai}건</summary>
        <p className="adm-foot">core에 AI 판정이 붙기 전까지 쓰는 임시 칸이에요. 붙으면 없앨 거예요.</p>
        <RestProposals onOpenRooms={onOpenRooms} />
        <section className="todo-col" aria-labelledby="todo-rep-h">
          <h2 id="todo-rep-h" className="todo-h">신고 판정</h2>
          <ReportList onForceCheckout={onForceCheckout} />
        </section>
        <section className="todo-col" aria-labelledby="todo-ai-h">
          <h2 id="todo-ai-h" className="todo-h">AI 제안</h2>
          <Notice />
          {ai.length === 0
            ? <p className="adm-foot">AI 제안이 없어요.</p>
            : <ul className="todo-list">{ai.map((p, i) => <InboxItem key={p.id} p={p} i={i} t={state.trainees.find((t) => t.kind === p.kind)!} />)}</ul>}
        </section>
      </details>
    </section>
  )
}
