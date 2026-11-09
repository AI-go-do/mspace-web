import { useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ENV_RULES, type SensorKind } from '../config/adminRooms'
import type { RoomView } from '../lib/roomHealth'
import { seoulClock } from '../lib/time'

/**
 * 관제실 "방별 센서": 방마다 CO2·온도·조도 그래프를 따로 한 칸씩(재웅 11/9).
 * - 조도는 우노 CDS 원시값(0~1023)을 밝기 %로 바꿔 그린다. 가로 점선 = 불 켜짐 기준(ENV_RULES.lightOnPct, 임시)
 * - 조도 칸 아래 옅은 띠 = 사람이 있던 분(core가 분마다 재실을 주면). 띠 없이 밝으면 "빈 방 불 켜짐"
 * - 값이 없으면 칸을 비우고 이유를 쓴다: 센서 목록에 없으면 "센서 없음", 있는데 값이 안 오면 "아직 값이 없어요"
 *   (11/9 지금 실제 장치는 조도·재실만 보낸다. CO2·온도·습도 SCD40은 아직 안 붙음)
 */

type Kind = 'co2' | 'temp' | 'light'

interface Spec {
  kind: Kind
  label: string
  unit: string
  digits: number
  sensor: SensorKind
  values: (number | null)[]
  limit: number
  limitLabel: string
  /** 기준 위가 나쁨(CO2·온도). 조도는 기준이 나쁨이 아니라 "불 켜짐" 표시라 빗금을 안 깐다 */
  bad: boolean
  lo: number
  hi: number
  hot: boolean
  band: (boolean | null)[] | null
  note: string
}

const finite = (xs: (number | null)[]) => xs.filter((v): v is number => v !== null)

function specs(v: RoomView): Spec[] {
  const t = finite(v.temps)
  const c = finite(v.history)
  const hasBand = v.occupancy.some((o) => o !== null)
  return [
    {
      kind: 'co2', label: 'CO2', unit: 'ppm', digits: 0, sensor: 'co2', values: v.history,
      limit: ENV_RULES.co2LimitPpm, limitLabel: `환기 ${ENV_RULES.co2LimitPpm}`, bad: true,
      lo: Math.min(400, ...c) - 20, hi: Math.max(ENV_RULES.co2LimitPpm + 150, ...c) + 20,
      hot: v.flags.co2Over || v.flags.co2Soon, band: null, note: v.co2Note,
    },
    {
      kind: 'temp', label: '온도', unit: '°C', digits: 1, sensor: 'temperature', values: v.temps,
      limit: ENV_RULES.hotC, limitLabel: `참고 ${ENV_RULES.hotC}`, bad: false,
      lo: Math.min(20, ...t) - 0.5, hi: Math.max(ENV_RULES.hotC + 1, ...t) + 0.5,
      // 덥다는 느낌은 사람마다 달라서 주의 색 없이 참고선만
      hot: false, band: null, note: v.tempNote,
    },
    {
      kind: 'light', label: '조도', unit: '%', digits: 0, sensor: 'light', values: v.lights,
      limit: ENV_RULES.lightOnPct, limitLabel: `불 켜짐 ${ENV_RULES.lightOnPct}%`, bad: false,
      lo: 0, hi: 100, hot: v.flags.lightLeftOn, band: hasBand ? v.occupancy : null, note: v.lightNote,
    },
  ]
}

function useWidth() {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => setW(Math.round(el.getBoundingClientRect().width))
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

const H = 92
const PAD = { t: 8, r: 34, b: 18 }
const fmt = (v: number, d: number) => (d ? v.toFixed(d) : String(Math.round(v)))

/** 그래프 한 칸 */
function SensorChart({ v, s, off }: { v: RoomView; s: Spec; off: boolean }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const n = s.values.length
  const last = s.values.reduce<number>((a, x, i) => (x === null ? a : i), -1)
  const now = last >= 0 ? (s.values[last] as number) : null
  const installed = v.sensors.has(s.sensor)
  const empty = now === null
  const bandH = s.band ? 6 : 0
  const plotW = Math.max(1, w - PAD.r)
  const plotH = H - PAD.t - PAD.b - bandH
  const x = (i: number) => (n > 1 ? (i / (n - 1)) * plotW : 0)
  const y = (val: number) => PAD.t + (1 - (Math.max(s.lo, Math.min(s.hi, val)) - s.lo) / (s.hi - s.lo)) * plotH

  const runs: [number, number][][] = []
  let cur: [number, number][] = []
  s.values.forEach((val, i) => {
    if (val === null) { if (cur.length) runs.push(cur); cur = []; return }
    cur.push([x(i), y(val)])
  })
  if (cur.length) runs.push(cur)
  const d = (r: [number, number][]) => r.map(([a, b], k) => `${k ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('')
  const area = (r: [number, number][]) => `${d(r)}L${r[r.length - 1][0].toFixed(1)},${PAD.t + plotH}L${r[0][0].toFixed(1)},${PAD.t + plotH}Z`
  const yl = y(s.limit)

  // 재실 띠: 사람 있던 분을 이어 붙인 칸
  const occ: [number, number][] = []
  if (s.band) {
    let from = -1
    s.band.forEach((o, i) => {
      if (o === true && from < 0) from = i
      if (o !== true && from >= 0) { occ.push([from, i]); from = -1 }
    })
    if (from >= 0) occ.push([from, n - 1])
  }

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (empty || w === 0) return
    const r = e.currentTarget.getBoundingClientRect()
    setHover(Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / plotW) * (n - 1)))))
  }
  const hv = hover === null ? null : s.values[hover]
  const at = hover !== null && v.times[hover] ? seoulClock(new Date(v.times[hover])) : ''
  const occAt = hover !== null && s.band ? s.band[hover] : null

  const label = empty
    ? `${v.name} ${s.label} ${installed ? '아직 값 없음' : '센서 없음'}`
    : `${v.name} ${s.label} 지난 ${n}분, 지금 ${fmt(now, s.digits)}${s.unit}. ${s.note}`

  return (
    <div className={`sb-cell k-${s.kind} ${s.hot ? 'hot' : ''} ${off ? 'off' : ''} ${empty ? 'empty' : ''}`}>
      <div className="sb-cell-head">
        <small>{s.label}</small>
        {empty ? <b className="none">–</b> : <b>{fmt(now, s.digits)}<i>{s.unit}</i></b>}
        <em title={empty ? undefined : s.note}>{empty ? (installed ? '아직 값이 없어요' : '센서 없음') : s.note}</em>
      </div>
      <div ref={ref} className="sb-plot" style={{ height: H }} role="img" aria-label={label}
        onPointerDown={onMove} onPointerMove={onMove} onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(null) }}>
        {empty && (
          <span className="sb-empty">
            {installed
              ? (s.kind === 'light' ? '조도 값이 아직 안 들어와요' : 'SCD40 연결 전이라 값이 없어요')
              : `${s.label} 센서가 없는 방이에요`}
          </span>
        )}
        {!empty && w > 0 && (
          <svg width={w} height={H} aria-hidden="true">
            {s.bad && <rect x="0" y={PAD.t} width={plotW} height={Math.max(0, yl - PAD.t)} className="sb-bad" />}
            <line x1="0" x2={plotW} y1={yl} y2={yl} className="sb-limit" />
            <text x={plotW + 4} y={yl + 3.5} className="sb-limit-t">{s.kind === 'light' ? `${s.limit}%` : fmt(s.limit, s.kind === 'temp' ? 1 : 0)}</text>
            {/* 위·아래 눈금은 기준선 글자와 겹치면 뺀다 */}
            {Math.abs(yl - (PAD.t + 4)) > 11 && <text x={plotW + 4} y={PAD.t + 8} className="sb-tick">{fmt(s.hi, s.kind === 'temp' ? 1 : 0)}</text>}
            {Math.abs(yl - (PAD.t + plotH - 4)) > 11 && <text x={plotW + 4} y={PAD.t + plotH} className="sb-tick">{fmt(s.lo, s.kind === 'temp' ? 1 : 0)}</text>}
            {runs.filter((r) => r.length > 1).map((r, k) => <path key={`a${k}`} d={area(r)} className="sb-area" />)}
            {runs.filter((r) => r.length > 1).map((r, k) => <path key={`l${k}`} d={d(r)} className="sb-line" pathLength={1} />)}
            {s.band && (
              <g className="sb-band">
                <rect x="0" y={PAD.t + plotH + 3} width={plotW} height={bandH - 2} rx="2" className="sb-band-bg" />
                {occ.map(([a, b]) => <rect key={a} x={x(a)} y={PAD.t + plotH + 3} width={Math.max(2, x(b) - x(a))} height={bandH - 2} rx="2" className="sb-band-on" />)}
              </g>
            )}
            <text x="0" y={H - 4} className="sb-tick">{n}분 전</text>
            <text x={plotW} y={H - 4} className="sb-tick now" textAnchor="end">지금</text>
            {hv !== null && hv !== undefined && (
              <g className="sb-cross">
                <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + plotH} />
                <circle cx={x(hover!)} cy={y(hv)} r="3.5" />
              </g>
            )}
            <circle cx={x(last)} cy={y(now)} r="3.5" className="sb-dot" />
          </svg>
        )}
        {hover !== null && !empty && (
          <span className="sb-tip" style={{ left: Math.min(Math.max(x(hover), 40), plotW - 40) }} aria-hidden="true">
            {at} · {hv === null || hv === undefined ? '값 없음' : `${fmt(hv, s.digits)}${s.unit}`}{occAt === null ? '' : occAt ? ' · 사람 있음' : ' · 빈 방'}
          </span>
        )}
      </div>
    </div>
  )
}

/** 방별 센서 판. 방 줄을 누르면(번호·이름) 방 상세 창 */
export function AdminSensorBoard({ views, onOpen }: { views: RoomView[]; onOpen: (roomId: number) => void }) {
  const anyBand = views.some((v) => v.occupancy.some((o) => o !== null))
  return (
    <section className="ctl-ov sb" aria-labelledby="sb-h">
      <header className="sb-head">
        <h2 id="sb-h">방별 센서 실시간 <small>방마다 CO2·온도·조도 · 지난 {ENV_RULES.historyMinutes}분</small></h2>
        <span className="sb-key" aria-hidden="true">
          <i className="k-line" />측정 <i className="k-limit" />기준선 {anyBand && <><i className="k-band" />사람 있던 시간</>} <i className="k-none" />값 없음
        </span>
      </header>
      <p className="sb-sub">조도는 밝기 %예요(센서 값 0~1023을 0~100%로). 불 켜짐 기준 {ENV_RULES.lightOnPct}%는 임시값이라 실제 방에서 켜고 끈 값을 재서 맞출게요.</p>
      <div className="sb-rows">
        {views.map((v, i) => {
          const off = v.flags.offline || v.flags.stuck
          return (
            <article key={v.roomId} className={`sb-room t-${v.tone}`} style={{ '--k': i } as CSSProperties}>
              <button type="button" className="sb-name" onClick={() => onOpen(v.roomId)} aria-label={`${v.name} ${v.status.text}. 자세히 보기`}>
                <b className="sb-no">{v.roomId}</b>
                <span>{v.name}<small className={`s-${v.status.tone}`}>{v.status.text}</small></span>
                <span className="sb-go" aria-hidden="true">›</span>
              </button>
              <div className="sb-cells">
                {/* CO2 멈춤은 SCD40(CO2·온도) 고장이라 조도(우노)는 끊김만 본다 */}
                {specs(v).map((s) => <SensorChart key={s.kind} v={v} s={s} off={s.kind === 'light' ? v.flags.offline : off} />)}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
