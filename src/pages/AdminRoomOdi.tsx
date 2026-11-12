import type { Decision } from '../api/climate'
import Odi from '../components/Odi'
import { STEP, THINK, useReveal } from './AdminClimate'
import './AdminRoomOdi.css'

/**
 * 방 칸 안의 "오디 AI가 이 방에서 지금 하는 일"(재웅 11/12 17:57 "어디 방에서 어떤 걸 오디 AI가 하고 있는지 각각 크게").
 * 다섯 단계(탐지 → 예측 → 알림 → 제어 → 다시 확인)를 점 다섯으로, 지금 단계 한 줄을 크게, 아래에 왜·한 일.
 * 새 판단은 오른쪽 카드처럼 단계를 하나씩 "하는 중"으로 열고, 판단이 없으면 "지켜보는 중"
 */

type Key = Decision['steps'][number]['key']
const ORDER: Key[] = ['DETECT', 'PREDICT', 'NOTIFY', 'CONTROL', 'VERIFY']

export type DotState = 'ok' | 'doing' | 'skip' | 'fail' | 'wait'
export interface OdiView {
  dots: { key: Key; label: string; state: DotState }[]
  /** 크게 보일 지금 단계 */
  head: { label: string; text: string; busy: boolean; at: string | null }
  why: string | null
  did: string | null
  busy: boolean
}

const STATE: Record<Decision['steps'][number]['status'], DotState> = { DONE: 'ok', RUNNING: 'doing', SKIPPED: 'skip', FAILED: 'fail' }

/**
 * 판단 하나 + 지금까지 연 단계 수 → 칸에 그릴 것.
 * 여는 순서(애니메이션)는 점이 차는 것만이고, "하는 중"은 서버가 RUNNING이라고 한 단계에만 붙인다
 */
export function odiView(d: Decision, shown: number): OdiView {
  const n = Math.max(1, Math.min(d.steps.length, shown))
  const opened = d.steps.slice(0, n)
  const running = opened.find((s) => s.status === 'RUNNING') ?? null
  const dots = ORDER.map((key) => {
    const s = opened.find((x) => x.key === key)
    return { key, label: STEP[key], state: s ? STATE[s.status] : 'wait' as const }
  })
  const last = [...opened].reverse().find((s) => s.status !== 'SKIPPED') ?? opened[opened.length - 1] ?? null
  const head = running ? { label: STEP[running.key], text: running.text, busy: true, at: null }
    : last ? { label: STEP[last.key], text: last.text, busy: false, at: last.at }
    : { label: STEP.DETECT, text: THINK.DETECT, busy: true, at: null }
  const detect = opened.find((s) => s.key === 'DETECT')
  const control = opened.find((s) => s.key === 'CONTROL' && s.status === 'DONE')
  const headKey = running?.key ?? last?.key
  return {
    dots, head,
    why: detect && headKey !== 'DETECT' ? detect.text : null,
    did: control && headKey !== 'CONTROL' ? control.text : null,
    busy: head.busy || d.open,
  }
}

function clock(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

export function RoomOdi({ decision }: { decision: Decision | null }) {
  const shown = useReveal(decision ? [decision] : [])
  if (!decision) {
    return (
      <span className="ro idle">
        <span className="ro-top"><span className="ro-face"><Odi size={30} label="" /></span><b className="ro-name">오디 AI</b><span className="ro-state">지켜보는 중</span></span>
        <span className="ro-now"><span className="ro-scan" aria-hidden="true" />이 방은 평소 범위예요</span>
      </span>
    )
  }
  const v = odiView(decision, shown(decision.id))
  return (
    <span className={`ro ${v.busy ? 'busy' : 'done'}`} role="status" aria-label={`오디 AI ${v.head.label} ${v.head.text}`}>
      <span className="ro-top">
        <span className="ro-face"><Odi size={30} label="" /></span>
        <b className="ro-name">오디 AI <i aria-hidden="true">✦</i></b>
        <ol className="ro-dots" aria-hidden="true">
          {v.dots.map((x) => <li key={x.key} className={`d-${x.state}`}><i /><small>{x.label}</small></li>)}
        </ol>
        <span className="ro-state">{v.busy ? '판단 중' : v.head.at ? `${clock(v.head.at)} 끝남` : '끝남'}</span>
      </span>
      <span key={`${v.head.label}${v.head.busy}`} className={`ro-now ${v.head.busy ? 'busy' : ''}`}>
        <b>{v.head.label}</b>{v.head.text}
        {v.head.busy && <span className="cl-dots" aria-hidden="true"><i /><i /><i /></span>}
      </span>
      {(v.why || v.did) && (
        <span className="ro-why">
          {v.why && <span><em>왜</em>{v.why}</span>}
          {v.did && <span><em>한 일</em>{v.did}</span>}
        </span>
      )}
    </span>
  )
}
