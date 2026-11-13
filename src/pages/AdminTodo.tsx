import { useEffect, useState } from 'react'
import { currentMemberId } from '../api/client'
import { onReportsChanged } from '../lib/reportsBus'
import { useMemberId } from '../lib/useMemberId'
import { getReports } from '../api/admin'
import { ReportList } from './AdminReports'
import { RestProposals } from './AdminRest'
import { POLL_MS } from '../lib/poll'
import { demoOn } from '../lib/demo'

/** reportsKnown: 신고 수를 확인했나(불러오는 중·실패면 false). reportsFailed: 마지막 요청이 실패했나 */
export type TodoCounts = {
  reports: number; reportsKnown: boolean; reportsFailed: boolean; total: number
  /** 방마다 판정 기다리는 신고 수 ("지금" 화면 방 표시용). 확인 못 했으면 빈 칸 */
  byRoom: Record<number, number>
}

/**
 * 메뉴 숫자: 판정 기다리는 신고. 신고 수를 한 번도 못 받았거나 마지막 갱신이 실패하면
 * reportsKnown=false (0건과 "모름"을 구분해 "사람이 볼 일이 없어요"라고 잘못 말하지 않게). 다음 차례에 다시 센다
 */
export function useTodoCounts(): TodoCounts {
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
  // 확인하지 못한 신고 수는 합계에 넣지 않는다(옛 숫자를 확인된 것처럼 보이지 않게)
  const shown = known ? reports : 0
  return { reports: shown, reportsKnown: known, reportsFailed: failed, total: shown, byRoom: known ? res.byRoom : {} }
}

/**
 * 오디가 판정·처리한 기록 (10차 회의·11/10 재웅: 관리자는 보기만, 판단은 AI).
 * core에 AI 판정이 아직 없어 시연 값(?demo=1)에서만 예시를 보여 준다. 확신도·근거를 같이 남겨 발표의 "AI 판단 신뢰도" 표와 이어진다
 */
type Judgement = { at: string; room: string; what: string; verdict: string; sure: number; why: string; tone: 'warn' | 'ok' | 'off' }
const SAMPLE_JUDGEMENTS: Judgement[] = [
  { at: '13:42', room: '창작실 2', what: '예약이 끝났는데 사람이 남아 있음 (#1042)', verdict: '경고 1회 · 대표자에게 알림', sure: 96, why: "끝난 뒤 19분째 재실 센서 '있음', 퇴실 안내 뒤 10분 더 지켜봄", tone: 'warn' },
  { at: '13:20', room: '창작실 3', what: '어질러짐 신고 (학생)', verdict: '경고 없음 · 신고자에게 결과 알림', sure: 88, why: '입실 사진과 퇴실 사진이 거의 같아요. 의자 1개만 옮겨짐', tone: 'ok' },
  { at: '12:55', room: '창작실 4', what: 'CO2가 59분째 같은 값', verdict: '센서 고장으로 보고 장치 담당에게 넘김', sure: 91, why: '재실 센서는 움직이는데 CO2만 변화 없음', tone: 'off' },
  { at: '11:30', room: '창작실 1', what: '두고 간 물건 (카메라)', verdict: '경고 없음 · 대표자에게 물건이 있다고 알림', sure: 84, why: '퇴실 뒤 빈 방 사진에서 책상 위 물건 1개', tone: 'ok' },
  { at: '10:05', room: '창작실 5', what: '경고 철회 요청', verdict: '철회 · 경고 지움', sure: 72, why: '확신도가 기준(80%)보다 낮아 "확인 불가 = 철회" 규칙', tone: 'ok' },
]

function JudgeLog() {
  if (!demoOn()) {
    return (
      <div className="adm-empty">
        <b>오디 판정 기록이 아직 없어요</b>
        <span>core에 AI 판정이 붙으면 신고·경고·철회 판정이 여기 쌓여요. 주소에 ?demo=1을 붙이면 예시를 볼 수 있어요.</span>
      </div>
    )
  }
  return (
    <ol className="jl">
      {SAMPLE_JUDGEMENTS.map((j) => (
        <li key={j.at + j.room} className={`jl-item t-${j.tone}`}>
          <time>{j.at}</time>
          <div className="jl-main">
            <small>{j.room} · {j.what}</small>
            <b>{j.verdict}</b>
            <span>근거: {j.why}</span>
          </div>
          <span className="jl-sure" title="오디 확신도">{j.sure}%</span>
        </li>
      ))}
    </ol>
  )
}

/** counts는 Admin이 가진 것을 받는다(같은 신고 수를 두 번 읽지 않게) */
export function AdminTodo({ counts, onForceCheckout, onOpenRooms }: { counts: TodoCounts; onForceCheckout: (reservationId: number) => void; onOpenRooms: () => void }) {
  return (
    <section className="todo" aria-label="오디 판단 기록">
      <JudgeLog />
      {demoOn() && <p className="adm-foot">시연 값이에요. 확신도가 기준보다 낮으면 경고하지 않거나 철회해요(Q-24 제안). 기준 숫자는 팀 규칙 전 임시 값이에요.</p>}
      <details className="jl-manual">
        <summary>비상시 직접 판정 · 판정 기다리는 신고 {counts.reportsKnown ? counts.reports : '?'}건</summary>
        <p className="adm-foot">core에 AI 판정이 붙기 전까지 쓰는 임시 칸이에요. 붙으면 없앨 거예요.</p>
        <RestProposals onOpenRooms={onOpenRooms} />
        <section className="todo-col" aria-labelledby="todo-rep-h">
          <h2 id="todo-rep-h" className="todo-h">신고 판정</h2>
          <ReportList onForceCheckout={onForceCheckout} />
        </section>
      </details>
    </section>
  )
}
