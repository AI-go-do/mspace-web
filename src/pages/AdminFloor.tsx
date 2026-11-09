import { type CSSProperties } from 'react'
import { applianceState, useAppliances } from '../api/appliances'
import { ENV_RULES } from '../config/adminRooms'
import { CLIMATE_RULES, ROOM_APPLIANCES } from '../config/appliances'
import { climateTips, type TipRules } from '../lib/climate'
import type { Advice } from '../lib/roomAdvice'
import type { RoomView } from '../lib/roomHealth'
import { useCountUp } from '../lib/useCountUp'

/**
 * 관제실 평면도: 방 1~5를 실제 배치처럼 한 판에. 1~4번은 한 줄, 큰 방 5번은 아래 넓게, 맨 아래 복도.
 * 칸 모양만 봐도 상태가 보이게: 사람 있음 = 파랗게 숨쉬기, 주의 = 노란 고리, 확인 필요 = 줄무늬, 빈 방 = 점선.
 * 칸마다 지난 시간 CO2 작은 그래프(점선 = 예측, 노란 점선 = 환기 기준)
 */

export type TileTone = 'ok' | 'warn' | 'off'

/** 작은 CO2 그래프. 지난 값 + 예측을 0~100 칸에 그리고 선 굵기는 화면 크기와 상관없이 같게 */
export function Spark({ view, limit = ENV_RULES.co2LimitPpm, wide = false }: { view: RoomView; limit?: number; wide?: boolean }) {
  const past = view.history
  const ahead = view.forecast
  const total = past.length + ahead.length
  const values = [...past, ...ahead].filter((v): v is number => v !== null)
  if (total < 2 || values.length < 2) return <div className="ctl-spark none" aria-hidden="true" />
  const lo = Math.min(400, ...values) - 20
  const hi = Math.max(limit + 120, ...values) + 20
  const x = (i: number) => (i / (total - 1)) * 100
  const y = (v: number) => 40 - ((v - lo) / (hi - lo)) * 40
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(2)},${b.toFixed(2)}`).join('')
  // 값이 빈 분에서는 선을 끊는다
  const segs: [number, number][][] = []
  let cur: [number, number][] = []
  past.forEach((v, i) => {
    if (v === null) { if (cur.length) segs.push(cur); cur = []; return }
    cur.push([x(i), y(v)])
  })
  if (cur.length) segs.push(cur)
  const lastIdx = past.length - 1
  const lastVal = past[lastIdx]
  const pred = lastVal !== null && ahead.length ? line([[x(lastIdx), y(lastVal)], ...ahead.map((v, i) => [x(lastIdx + 1 + i), y(v)] as [number, number])]) : ''
  const area = segs.length ? `${line(segs[segs.length - 1])}L${segs[segs.length - 1].at(-1)![0].toFixed(2)},40L${segs[segs.length - 1][0][0].toFixed(2)},40Z` : ''
  const nowX = x(lastIdx)
  return (
    <svg className={`ctl-spark ${wide ? 'wide' : ''}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="100" height={Math.max(0, y(limit))} className="sp-over" />
      <line x1="0" x2="100" y1={y(limit)} y2={y(limit)} className="sp-limit" vectorEffect="non-scaling-stroke" />
      {area && <path d={area} className="sp-area" />}
      {segs.map((s, i) => <path key={i} d={line(s)} className="sp-line" vectorEffect="non-scaling-stroke" pathLength={1} />)}
      {pred && <path d={pred} className="sp-pred" vectorEffect="non-scaling-stroke" />}
      <line x1={nowX} x2={nowX} y1="0" y2="40" className="sp-now" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/** 칸 안 에어컨·공기청정기 표시: 권유 한 줄 + 켜진 기기 ("숨 막히기 12분 전") */
function ClimateChips({ view, now, rules }: { view: RoomView; now: Date; rules: TipRules }) {
  const store = useAppliances()
  const devs = ROOM_APPLIANCES[view.roomId] ?? []
  if (!devs.length) return null
  const tips = climateTips(view, now, (id) => applianceState(id, store), rules)
  const on = devs.filter((a) => applianceState(a.id, store).power === 'ON')
  if (!tips.length && !on.length) return null
  return (
    <span className="cl-chips">
      {tips.slice(0, 1).map((t) => <span key={t.key} className="cl-chip tip">{t.title}{t.button ? ` · ${t.button}` : ''}</span>)}
      {on.map((a) => <span key={a.id} className="cl-chip on">{a.name} 켜짐</span>)}
    </span>
  )
}

/** 평면도 칸 하나. 누르면 방 상세 창 */
export function RoomTile({ view, tone, advice, blocked, reports, i, big = false, now = null, rules = CLIMATE_RULES, onOpen }: {
  view: RoomView
  /** 에어컨·공기청정기 권유 계산용. 아직 값이 없으면 칩을 안 그린다 */
  now?: Date | null
  rules?: TipRules
  tone: TileTone
  advice: Advice[]
  blocked: string | null
  reports: number
  i: number
  big?: boolean
  onOpen: () => void
}) {
  const shown = useCountUp(view.co2)
  const used = view.presence === 'OCCUPIED'
  const state = view.tone === 'off' ? 'off' : used ? 'use' : 'empty'
  const line = advice[0]?.title ?? view.co2Note
  const facts = [
    view.temperatureC === null ? null : `${view.temperatureC.toFixed(1)}°C`,
    view.humidityPct === null ? null : `${view.humidityPct}%`,
    view.light === null ? null : `조도 ${view.light}%`,
    view.door?.open ? `문 열림 ${view.door.minutes}분` : null,
  ].filter(Boolean).join(' · ')
  return (
    <button type="button" className={`ctl-tile st-${state} tn-${tone} ${big ? 'big' : ''}`} style={{ '--k': i } as CSSProperties} onClick={onOpen}
      aria-label={`${view.name} ${view.status.text}${view.co2 === null ? '' : `, CO2 ${view.co2}ppm`}${advice.length ? `, ${line}` : ''}. 자세히 보기`}>
      {tone === 'warn' && <span className="ctl-ring" aria-hidden="true" />}
      <span className="ct-head">
        <b className="ct-no">{view.roomId}</b>
        <span className="ct-name">{view.name}<small>{view.slot}</small></span>
        <span className="ct-tags">
          {reports > 0 && <span className="ct-tag warn">신고 {reports}</span>}
          {blocked && <span className="ct-tag warn">{blocked}</span>}
          <span className={`ct-tag s-${view.status.tone}`}>{view.status.text}</span>
        </span>
      </span>
      <span className="ct-main">
        <span className="ct-co2">
          {view.co2 === null ? <b className="none">–</b> : <b key={view.co2 >= ENV_RULES.co2LimitPpm ? 'over' : 'ok'} className={view.flags.co2Over ? 'over' : ''}>{shown}<i>ppm</i></b>}
          <em className={tone !== 'ok' ? `why ${tone}` : ''}>{advice.length ? <span aria-hidden="true">!</span> : null}{line}{advice.length > 1 ? ` 외 ${advice.length - 1}` : ''}</em>
        </span>
        <Spark view={view} wide={big} />
      </span>
      {now && <ClimateChips view={view} now={now} rules={rules} />}
      <span className="ct-foot">
        <span>{facts || '센서 없음'}</span>
        <span className="ct-go" aria-hidden="true">자세히 ›</span>
      </span>
    </button>
  )
}
