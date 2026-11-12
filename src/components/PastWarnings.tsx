import { useWarnings } from '../api/appeal'
import { appealButtonLabel, canAppeal, statusLabel, WARNING_LABEL, type WarningRecord } from '../lib/appeal'
import { demoOn } from '../lib/demo'
import { timeRange, whenLabel } from '../lib/format'
import { AppealProgress } from './PenaltyHistory'
import './PastWarnings.css'

/**
 * 내 예약 화면의 경고 철회 요청 (FR-RPT-105, 11/10 지영 제안·재웅 확정). 배달 앱 리뷰처럼 지난 예약 카드 아래에
 * "경고 철회 요청 (N일 남음)" 버튼을 붙인다. 요청은 이용 규칙 화면과 같은 시트(AppealSheet)로 쓰고, AI가 다시 비교한다.
 * core #111(경고 목록 API)이 없어서 지금은 ?demo=1일 때만 예시 경고를 쓴다. API가 생기면 api/appeal.ts만 바꾼다
 */
export function useMyWarnings(): WarningRecord[] {
  const list = useWarnings()
  return demoOn() ? list : []
}

/** 지금 철회를 요청할 수 있는 경고 수 (탭 점·안내 띠) */
export function openAppealCount(list: WarningRecord[], now: Date): number {
  return list.filter((w) => canAppeal(w, now)).length
}

/**
 * 지난 예약 목록에 붙일 짝 맞추기: 예약 번호가 목록에 있으면 그 카드 아래(byReservation),
 * 없으면(예시·30일 넘은 예약 등) 목록 위에 따로(loose). 최근 경고부터
 */
export function matchWarnings(list: WarningRecord[], pastIds: number[]): { byReservation: Map<number, WarningRecord>; loose: WarningRecord[] } {
  const ids = new Set(pastIds)
  const byReservation = new Map<number, WarningRecord>()
  const loose: WarningRecord[] = []
  const sorted = [...list].sort((a, b) => Date.parse(b.issuedAt) - Date.parse(a.issuedAt))
  for (const w of sorted) {
    if (w.reservationId != null && ids.has(w.reservationId) && !byReservation.has(w.reservationId)) byReservation.set(w.reservationId, w)
    else loose.push(w)
  }
  return { byReservation, loose }
}

/** 지난 예약 카드 바로 아래 줄: 버튼(요청 가능) 또는 상태(AI가 다시 보는 중·철회됨·경고 유지·기간 끝남) */
export function WarningRow({ w, now, fresh, onWrite }: { w: WarningRecord; now: Date; fresh: boolean; onWrite: () => void }) {
  const label = appealButtonLabel(w, now)
  const st = statusLabel(w, now)
  return (
    <div className={`pw-row t-${st.tone}`}>
      <p className="pw-why">
        <span className={`pw-kind k-${w.kind}`}>{WARNING_LABEL[w.kind]} 경고</span>
        <span className={w.appeal?.status === 'ACCEPTED' ? 'struck' : ''}>{w.why}</span>
      </p>
      {label ? (
        <button type="button" className="pw-btn" onClick={onWrite}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
          {label}
        </button>
      ) : w.appeal ? (
        <AppealProgress w={w} fresh={fresh} />
      ) : (
        <span className="pw-closed">{st.text}</span>
      )}
    </div>
  )
}

/** 지난 목록에 예약 카드가 없는 경고: 예약 요약 + 같은 줄. 예시면 "예시" 표시 */
export function LooseWarningCard({ w, now, fresh, onWrite }: { w: WarningRecord; now: Date; fresh: boolean; onWrite: () => void }) {
  return (
    <section className="card pw-card" aria-label={`${w.roomId}번 방 ${WARNING_LABEL[w.kind]} 경고`}>
      <span className="pw-card-head">
        <span className="muted">경고 받은 예약</span>
        {w.id < 0 && <span className="sample">예시</span>}
      </span>
      <b>{whenLabel(w.startAt, now)} · 창작실 {w.roomId}</b>
      <span className="muted">{timeRange(w.startAt, w.endAt)}</span>
      <WarningRow w={w} now={now} fresh={fresh} onWrite={onWrite} />
    </section>
  )
}
