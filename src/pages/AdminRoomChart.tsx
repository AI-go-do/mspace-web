import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { ENV_RULES } from '../config/adminRooms'
import type { RoomView } from '../lib/roomHealth'
import { seoulClock } from '../lib/time'
import './AdminRoomChart.css'

/**
 * 관리자 "지금" 방 그래프. 지켜보는 그림이 아니라 "언제 무엇을 해야 하나"가 보이게 그린다.
 *  - 배경 띠: 괜찮음 / 곧 기준(노랑 옅게) / 기준 넘음(노랑 빗금)
 *  - 기준을 넘은 구간은 선 아래에 노란 빛이 깔린다
 *  - 예측은 점선 + 시간이 갈수록 넓어지는 범위(확실하지 않은 만큼)
 *  - 예측이 기준을 넘는 순간에 "N분 뒤 넘음" 표시, 예약 끝·다음 예약 시각을 세로선으로
 *  - 예약이 끝났는데 사람이 남아 있으면 그 구간을 빗금으로
 *  - 마우스를 올리면 그 분의 CO2·온도·습도
 * 픽셀 크기를 재서 그리므로 가로로 늘어나도 글씨·선이 찌그러지지 않는다
 */

export type MetricKey = 'co2' | 'temp' | 'hum'

interface Metric {
  key: MetricKey
  label: string
  unit: string
  digits: number
  values: (number | null)[]
  forecast: number[]
  /** 기준 값과 방향(above: 넘으면 나쁨, below: 밑이면 나쁨) */
  limit: number
  dir: 'above' | 'below'
  /** 기준 앞 "곧" 띠의 시작 */
  caution: number | null
  lo: number
  hi: number
  /** 예측 범위가 1분마다 넓어지는 정도 */
  spread: number
}

const finite = (xs: (number | null)[]) => xs.filter((v): v is number => v !== null)

export function metricOf(view: RoomView, key: MetricKey): Metric {
  if (key === 'temp') {
    const vs = finite(view.temps)
    const limit = ENV_RULES.hotC
    return {
      key, label: '온도', unit: '°C', digits: 1, values: view.temps, forecast: [], limit, dir: 'above', caution: limit - 1.5,
      lo: Math.min(20, ...vs.map((v) => v - 0.8)), hi: Math.max(limit + 1.5, ...vs.map((v) => v + 0.8)), spread: 0,
    }
  }
  if (key === 'hum') {
    const vs = finite(view.hums)
    const limit = ENV_RULES.dryPct
    return {
      key, label: '습도', unit: '%', digits: 0, values: view.hums, forecast: [], limit, dir: 'below', caution: limit + 5,
      lo: Math.min(limit - 10, ...vs.map((v) => v - 4)), hi: Math.max(65, ...vs.map((v) => v + 4)), spread: 0,
    }
  }
  const limit = ENV_RULES.co2LimitPpm
  const vs = [...finite(view.history), ...view.forecast]
  return {
    key, label: 'CO2', unit: 'ppm', digits: 0, values: view.history, forecast: view.forecast, limit, dir: 'above', caution: limit - 200,
    lo: 400, hi: Math.max(limit + 200, ...vs.map((v) => v + 60)), spread: 7,
  }
}

function useSize(ref: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const read = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (s.w === Math.round(r.width) && s.h === Math.round(r.height) ? s : { w: Math.round(r.width), h: Math.round(r.height) }))
    }
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return size
}

const fmt = (v: number, d: number) => (d ? v.toFixed(d) : String(Math.round(v)))

export function RoomChart({ view, metric = 'co2', now, detail = false }: { view: RoomView; metric?: MetricKey; now: Date; detail?: boolean }) {
  const box = useRef<HTMLDivElement>(null)
  const { w, h } = useSize(box)
  const [hover, setHover] = useState<number | null>(null)
  const m = metricOf(view, metric)
  const n = m.values.length
  const f = metric === 'co2' ? ENV_RULES.forecastMinutes : 0
  const total = Math.max(2, n + f)

  const hasDoor = view.sensors.has('door') && view.doors.some((d) => d !== null)
  const padT = 10
  const doorH = hasDoor ? (detail ? 10 : 7) : 0
  const padB = 20 + (hasDoor ? doorH + 4 : 0)
  const padR = detail ? 52 : 40
  const plotW = Math.max(1, w - padR)
  const plotH = Math.max(1, h - padT - padB)
  const x = (i: number) => (i / (total - 1)) * plotW
  const y = (v: number) => padT + (1 - (Math.max(m.lo, Math.min(m.hi, v)) - m.lo) / (m.hi - m.lo)) * plotH

  const lastIdx = m.values.reduce<number>((a, v, i) => (v === null ? a : i), -1)
  // "지금"은 늘 마지막 분. 끝 쪽 값이 비어 있으면 마지막 값(점)은 그보다 앞에 찍힌다
  const nowIdx = n - 1
  const last = lastIdx >= 0 ? (m.values[lastIdx] as number) : null
  const nowMs = now.getTime()
  // 시각 → 그래프 위 분 위치(마지막 값 = 지금)
  const idxAt = (iso: string) => (n - 1) + (new Date(iso).getTime() - nowMs) / 60_000

  // 값이 빈 분에서 선을 끊는다
  const runs: [number, number][][] = []
  m.values.forEach((v, i) => {
    if (v === null) { runs.push([]); return }
    if (!runs.length) runs.push([])
    runs[runs.length - 1].push([x(i), y(v)])
  })
  const lines = runs.filter((r) => r.length > 1)
  const d = (r: [number, number][]) => r.map(([a, b], k) => `${k ? 'L' : 'M'}${a.toFixed(1)},${b.toFixed(1)}`).join('')
  const area = (r: [number, number][]) => `${d(r)}L${r[r.length - 1][0].toFixed(1)},${padT + plotH}L${r[0][0].toFixed(1)},${padT + plotH}Z`

  const pred = last !== null && m.forecast.length ? [last, ...m.forecast] : []
  const predPts = pred.map((v, k) => [x(lastIdx + k), y(v)] as [number, number])
  const cone = pred.length
    ? [...pred.map((v, k) => [x(lastIdx + k), y(v + m.spread * Math.sqrt(k))] as [number, number]),
       ...pred.map((v, k) => [x(lastIdx + k), y(v - m.spread * Math.sqrt(k))] as [number, number]).reverse()]
    : []

  const yLimit = y(m.limit)
  const yCaution = m.caution === null ? null : y(m.caution)
  const badTop = m.dir === 'above' ? padT : yLimit
  const badH = m.dir === 'above' ? yLimit - padT : padT + plotH - yLimit
  const cautionTop = yCaution === null ? 0 : m.dir === 'above' ? yLimit : yCaution
  const cautionH = yCaution === null ? 0 : Math.abs(yCaution - yLimit)

  const eta = metric === 'co2' && view.etaMinutes !== null && lastIdx >= 0 ? lastIdx + view.etaMinutes : null

  // 예약 표시: 지금 예약 끝, 다음 예약 시작 (그래프 안에 들어올 때만)
  const marks: { i: number; label: string; kind: 'end' | 'next' }[] = []
  if (view.current) {
    const i = idxAt(view.current.endAt)
    if (i >= 0 && i <= total - 1) marks.push({ i, label: `예약 끝 ${seoulClock(new Date(view.current.endAt))}`, kind: 'end' })
  }
  if (view.nextAt) {
    const i = idxAt(view.nextAt)
    if (i >= 0 && i <= total - 1) marks.push({ i, label: `다음 예약 ${seoulClock(new Date(view.nextAt))}`, kind: 'next' })
  }
  const overFrom = view.flags.overtime && view.current ? Math.max(0, idxAt(view.current.endAt)) : null

  // 시간 눈금: 15분마다 + 지금 + 예측 끝
  const ticks: { i: number; label: string; now?: boolean }[] = []
  view.times.forEach((t, i) => {
    const dt = new Date(t)
    if (dt.getMinutes() % 15 === 0 && i < nowIdx - 3) ticks.push({ i, label: seoulClock(dt) })
  })
  if (n > 0) ticks.push({ i: nowIdx, label: '지금', now: true })
  if (f > 0) ticks.push({ i: total - 1, label: `+${f}분` })

  // 문 열린 구간(연속된 분을 한 칸으로)
  const doorRuns: [number, number][] = []
  if (hasDoor) {
    let from = -1
    view.doors.forEach((d, i) => {
      if (d === true && from < 0) from = i
      if (d !== true && from >= 0) { doorRuns.push([from, i]); from = -1 }
    })
    if (from >= 0) doorRuns.push([from, Math.max(from + 1, nowIdx)])
  }
  const doorY = padT + plotH + 4

  const ready = w > 0 && h > 0
  const empty = last === null

  function onMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!ready || empty) return
    const r = e.currentTarget.getBoundingClientRect()
    const i = Math.round(((e.clientX - r.left) / plotW) * (total - 1))
    setHover(Math.max(0, Math.min(lastIdx + m.forecast.length, i)))
  }

  const tip = hover === null ? null : (() => {
    if (hover <= lastIdx) {
      const at = view.times[hover] ? seoulClock(new Date(view.times[hover])) : ''
      const co2 = view.history[hover], t = view.temps[hover], hu = view.hums[hover]
      const v = m.values[hover]
      return { i: hover, v, title: at, rows: [
        co2 !== undefined && view.sensors.has('co2') ? `CO2 ${co2 === null ? '–' : co2}ppm` : null,
        t !== undefined && view.sensors.has('temperature') ? `온도 ${t === null ? '–' : t.toFixed(1)}°C` : null,
        hu !== undefined && view.sensors.has('humidity') ? `습도 ${hu === null ? '–' : hu}%` : null,
        hasDoor && view.doors[hover] !== null ? `문 ${view.doors[hover] ? '열림' : '닫힘'}` : null,
      ].filter(Boolean) as string[] }
    }
    const k = hover - lastIdx
    const v = m.forecast[k - 1]
    return { i: hover, v, title: `${k}분 뒤 (${view.forecastFrom === 'model' ? 'Jetson 예측' : '최근 추세'})`, rows: [`약 ${fmt(v, m.digits)}${m.unit} ± ${Math.round(m.spread * Math.sqrt(k))}`] }
  })()

  const label = empty
    ? `${view.name} ${m.label} 센서 없음`
    : `${view.name} ${m.label} 지난 ${n}분${m.forecast.length ? `과 ${m.forecast.length}분 예측` : ''}. `
      + `${lastIdx < nowIdx ? `${nowIdx - lastIdx}분 전 마지막 값` : '지금'} ${fmt(last, m.digits)}${m.unit}`
      + (eta !== null ? `. ${view.etaMinutes}분 뒤 기준 ${m.limit} 넘을 것 같음` : '')

  const uid = `rc-${view.roomId}-${metric}-${detail ? 'd' : 'c'}`

  return (
    <div ref={box} className={`rc ${detail ? 'rc-detail' : ''}`} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {ready && (
        <svg width={w} height={h} role="img" aria-label={label}>
          <defs>
            <linearGradient id={`${uid}-fill`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" className="rc-fill-top" />
              <stop offset="1" className="rc-fill-bottom" />
            </linearGradient>
            <pattern id={`${uid}-hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" className="rc-hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="7" className="rc-hatch-line" />
            </pattern>
            <pattern id={`${uid}-over`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <line x1="0" y1="0" x2="0" y2="6" className="rc-over-line" />
            </pattern>
            <clipPath id={`${uid}-bad`}><rect x="0" y={badTop} width={plotW} height={Math.max(0, badH)} /></clipPath>
          </defs>

          {/* 배경 띠 */}
          {!empty && <rect x="0" y={badTop} width={plotW} height={Math.max(0, badH)} fill={`url(#${uid}-hatch)`} className="rc-zone" />}
          {!empty && cautionH > 0 && <rect x="0" y={cautionTop} width={plotW} height={cautionH} className="rc-caution" />}
          <line x1="0" x2={plotW} y1={yLimit} y2={yLimit} className="rc-limit" />
          <text x={plotW + 6} y={yLimit + 4} className="rc-limit-t">{fmt(m.limit, m.key === 'temp' ? 1 : 0)}</text>

          {/* 예약이 끝났는데 남아 있는 구간 */}
          {overFrom !== null && nowIdx > overFrom && (
            <g className="rc-overtime">
              <rect x={x(overFrom)} y={padT} width={x(nowIdx) - x(overFrom)} height={plotH} fill={`url(#${uid}-over)`} />
              {detail && <text x={x(overFrom) + 6} y={padT + plotH - 6} className="rc-mark-t">시간 넘김 {view.overtimeMinutes}분</text>}
            </g>
          )}

          <g className="rc-plot">
            {lines.map((r, k) => <path key={`a${k}`} d={area(r)} fill={`url(#${uid}-fill)`} className="rc-area" />)}
            {/* 기준을 넘은 구간은 선 밑에 노란 빛 */}
            <g clipPath={`url(#${uid}-bad)`}>
              {lines.map((r, k) => <path key={`g${k}`} d={d(r)} className="rc-glow" />)}
            </g>
            {lines.map((r, k) => <path key={`l${k}`} d={d(r)} className="rc-line" />)}
          </g>

          {/* 예측: 범위 + 점선 */}
          {cone.length > 2 && (
            <g className="rc-pred">
              <path d={`${d(cone)}Z`} className="rc-cone" />
              <path d={d(predPts)} className="rc-pred-line" />
            </g>
          )}

          {/* 예약 끝·다음 예약 */}
          {marks.map((mk) => (
            <g key={mk.kind} className={`rc-mark ${mk.kind}`}>
              <line x1={x(mk.i)} x2={x(mk.i)} y1={padT} y2={padT + plotH} />
              <text x={x(mk.i) + (x(mk.i) > plotW - 90 ? -5 : 5)} y={padT + 11} textAnchor={x(mk.i) > plotW - 90 ? 'end' : 'start'} className="rc-mark-t">{mk.label}</text>
            </g>
          ))}

          {/* 지금 선 */}
          {n > 0 && <line x1={x(nowIdx)} x2={x(nowIdx)} y1={padT} y2={padT + plotH} className="rc-now" />}

          {/* 기준을 넘는 예상 순간 */}
          {eta !== null && (
            <g className="rc-eta">
              <line x1={x(eta)} x2={x(eta)} y1={padT} y2={padT + plotH} />
              <circle cx={x(eta)} cy={yLimit} r="5" />
            </g>
          )}

          {/* 문 열린 구간 띠 */}
          {hasDoor && (
            <g className="rc-door">
              <rect x="0" y={doorY} width={plotW} height={doorH} rx={doorH / 2} className="rc-door-bg" />
              {doorRuns.map(([a, b]) => (
                <rect key={a} x={x(a)} y={doorY} width={Math.max(3, x(b) - x(a))} height={doorH} rx={doorH / 2} className="rc-door-open" />
              ))}
              <text x={plotW + 6} y={doorY + doorH - 1} className="rc-door-t">문</text>
            </g>
          )}

          {/* 시간 눈금 */}
          <g className="rc-axis">
            {ticks.map((t) => (
              <text key={`${t.i}-${t.label}`} x={x(t.i)} y={h - 5} className={t.now ? 'now' : ''}
                textAnchor={t.i === total - 1 ? 'end' : t.i === 0 ? 'start' : 'middle'}>{t.label}</text>
            ))}
          </g>

          {/* 마우스 */}
          {tip && tip.v !== null && tip.v !== undefined && (
            <g className="rc-cross">
              <line x1={x(tip.i)} x2={x(tip.i)} y1={padT} y2={padT + plotH} />
              <circle cx={x(tip.i)} cy={y(tip.v)} r="4.5" />
            </g>
          )}
        </svg>
      )}

      {ready && last !== null && (
        <span className={`rc-dot ${view.flags.co2Over && metric === 'co2' ? 'hot' : ''}`} style={{ left: x(lastIdx), top: y(last) }} aria-hidden="true" />
      )}
      {ready && eta !== null && (
        <span className="rc-eta-tag" style={{ left: Math.min(x(eta), plotW - 4), top: Math.max(0, yLimit - 30) }} aria-hidden="true">
          {view.etaMinutes}분 뒤 {m.limit} 넘음
        </span>
      )}
      {tip && (
        <div className="rc-tip" style={{ left: x(tip.i), top: padT }} data-side={x(tip.i) > plotW * 0.6 ? 'left' : 'right'} aria-hidden="true">
          <b>{tip.title}</b>
          {tip.rows.map((r) => <span key={r}>{r}</span>)}
        </div>
      )}
      {empty && <span className="rc-empty">{m.label} 센서 없음</span>}
    </div>
  )
}
