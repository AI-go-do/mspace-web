import { useEffect, useState } from 'react'
import { currentMemberId } from '../api/client'
import { onReportsChanged } from '../lib/reportsBus'
import { useMemberId } from '../lib/useMemberId'
import { getReports } from '../api/admin'
import { useApprentice } from '../api/apprentice'
import type { Proposal } from '../lib/apprentice'
import { InboxItem, Notice } from './AdminApprentice'
import { ReportList } from './AdminReports'

/**
 * "할 일": 사람이 정해야 하는 일을 한곳에. 신고 판정(core, 실제 API)과 AI 처리안(가짜 단계)을 같이 보여 준다.
 * AI의 "신고 판정 초안"은 실제 신고 카드와 겹쳐서 여기에는 올리지 않는다(신고는 늘 사람이 판정, 레벨 1 고정)
 */
export const inTodo = (p: Proposal) => p.kind !== 'report'


const POLL_MS = 60_000

/** reportsKnown: 신고 수를 확인했나(불러오는 중·실패면 false). reportsFailed: 마지막 요청이 실패했나 */
export type TodoCounts = { reports: number; reportsKnown: boolean; reportsFailed: boolean; ai: number; total: number }

/**
 * 메뉴 숫자: 판정 기다리는 신고 + AI 처리안. 신고 수를 한 번도 못 받았거나 마지막 갱신이 실패하면
 * reportsKnown=false (0건과 "모름"을 구분해 "사람이 볼 일이 없어요"라고 잘못 말하지 않게). 다음 차례에 다시 센다
 */
export function useTodoCounts(): TodoCounts {
  const ai = useApprentice().state.inbox.filter(inTodo).length
  const member = useMemberId()
  // 누구의 숫자인지 같이 들고, 로그인한 회원이 바뀌면 앞 사람 숫자는 버린다(모름으로 돌아감)
  const [res, setRes] = useState<{ member: number | null; n: number | null; failed: boolean }>(
    { member: null, n: null, failed: false })
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
          setRes({ member, n: l.filter((r) => r.category !== 'NOISE').length, failed: false })
        })
        .catch(() => { if (!stale && ctrl === mine) setRes((p) => ({ member, n: p.member === member ? p.n : null, failed: true })) })
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
  return { reports: shown, reportsKnown: known, reportsFailed: failed, ai, total: shown + ai }
}

type Filter = 'all' | 'reports' | 'ai'

/** counts는 Admin이 가진 것을 받는다(같은 신고 수를 두 번 읽지 않게, 메뉴 배지와 칩 숫자가 늘 같게) */
export function AdminTodo({ counts, onForceCheckout }: { counts: TodoCounts; onForceCheckout: (reservationId: number) => void }) {
  const [filter, setFilter] = useState<Filter>('all')
  const { state } = useApprentice()
  const ai = state.inbox.filter(inTodo)
  // 신고 수를 확인하지 못했으면 신고 칩은 "?", 전체 칩은 "N+"
  const unknown = !counts.reportsKnown
  const FILTERS: { id: Filter; label: string; n: number | string }[] = [
    { id: 'all', label: '전체', n: unknown ? `${counts.ai}+` : counts.total },
    { id: 'reports', label: '신고 판정', n: unknown ? '?' : counts.reports },
    { id: 'ai', label: 'AI 제안', n: counts.ai },
  ]

  return (
    <section className="todo" aria-label="할 일">
      <div className="adm-chips" role="group" aria-label="보기">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" className="adm-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
            {f.label}<span className="adm-chip-n">{f.n}</span>
          </button>
        ))}
      </div>
      <div className={`todo-cols f-${filter}`}>
        {filter !== 'ai' && (
          <section className="todo-col" aria-labelledby="todo-rep-h">
            <h2 id="todo-rep-h" className="todo-h"><span className="todo-h-dot d-rep" aria-hidden="true" />신고 판정 <small>학생·방 카메라 신고</small></h2>
            <ReportList onForceCheckout={onForceCheckout} />
          </section>
        )}
        {filter !== 'reports' && (
          <section className="todo-col" aria-labelledby="todo-ai-h">
            <h2 id="todo-ai-h" className="todo-h"><span className="todo-h-dot d-ai" aria-hidden="true" />AI 제안 <small>맞으면 점수가 쌓여요</small></h2>
            <Notice />
            {ai.length === 0 ? (
              <div className="adm-empty">
                <span className="adm-empty-mark" aria-hidden="true">✓</span>
                <b>AI 제안이 없어요</b>
                <span>AI가 먼저 처리한 일은 "AI 수습사원"에 남아요.</span>
              </div>
            ) : (
              <ul className="todo-list">
                {ai.map((p, i) => (
                  <InboxItem key={p.id} p={p} i={i} t={state.trainees.find((t) => t.kind === p.kind)!} />
                ))}
              </ul>
            )}
            <p className="adm-foot">가짜 값 단계라 [맞아요]를 눌러도 학생에게 아무것도 보내지 않아요.</p>
          </section>
        )}
      </div>
    </section>
  )
}
