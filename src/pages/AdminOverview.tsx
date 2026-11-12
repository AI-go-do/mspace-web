import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ENV_RULES } from '../config/adminRooms'
import { rangeOf } from '../lib/chartRange'
import type { RoomView } from '../lib/roomHealth'
import { isTrusted, overview, type Level } from '../lib/roomOverview'
import { seoulClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import type { LiveTick, LiveTicks } from './AdminClimate'

/**
 * 관제실 "전체 실시간 분석": 방 1~5를 한 그래프에 겹쳐 비교한다.
 *  - 위: 다섯 방 선 그래프(CO2·온도·습도 바꿔 보기). 선 끝 동그라미 번호가 방, 노란 선은 기준을 넘었거나 곧 넘을 방
 *  - 마우스를 올리면 그 분의 다섯 방 값을 높은 순으로, 아래 방 단추를 누르면 그 방만 또렷하게
 *  - 아래: 방마다 지난 시간 + 예측 15분 열지도(진할수록 높음, 노랑 = 기준 가까움·넘음), 넘은 분, 15분 뒤 값
 * 색은 4+2색 안에서: 선은 하늘, 주의는 노랑, 확인 필요(끊김·멈춤)는 흐린 점선
 */

type Metric = 'co2' | 'temp' | 'hum' | 'light'
const METRICS: { key: Metric; label: string; unit: string; digits: number }[] = [
  { key: 'co2', label: 'CO2', unit: 'ppm', digits: 0 },
  { key: 'temp', label: '온도', unit: '°C', digits: 1 },
  { key: 'hum', label: '습도', unit: '%', digits: 0 },
  { key: 'light', label: '조도', unit: '%', digits: 0 },
]

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

const seriesOf = (v: RoomView, m: Metric) => (m === 'co2' ? v.history : m === 'temp' ? v.temps : m === 'hum' ? v.hums : v.lights)
const fmt = (v: number, d: number) => (d ? v.toFixed(d) : String(Math.round(v)))

const PAD = { l: 48, r: 44, t: 16, b: 30 }
/** 큰 그래프가 보여 주는 지난 시간. 짧게 잡아 1초마다 옆으로 흐르는 게 눈에 보이게(재웅 11/12 "진짜 실시간 차트 느낌") */
const PAST_MIN = 20
const GRID_MIN = 5

type Pt = { t: number; v: number }

/** 분 기록 + (있으면) 초 단위 실시간 값. 초 값이 시작된 뒤의 분 기록은 초 값으로 갈음한다 */
function pointsOf(v: RoomView, metric: Metric, ticks: LiveTick[] | undefined, from: number): (Pt | null)[] {
  const vals = seriesOf(v, metric)
  const live = metric === 'light' ? [] : (ticks ?? []).map((k) => ({ t: k.t, v: metric === 'co2' ? k.co2 : metric === 'temp' ? k.temp : k.hum }))
    .filter((p): p is Pt => p.v !== null)
  const cut = live.length ? live[0].t : Infinity
  const out: (Pt | null)[] = []
  vals.forEach((val, i) => {
    const t = Date.parse(v.times[i] ?? '')
    if (!Number.isFinite(t) || t < from - 60_000 || t >= cut) return
    out.push(val === null ? null : { t, v: val })
  })
  return [...out, ...live]
}

function MultiChart({ views, metric, focus, onFocus, ticks, compact = false }: { views: RoomView[]; metric: Metric; focus: number | null; onFocus: (id: number | null) => void; ticks?: LiveTicks; compact?: boolean }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const clock = useNow(1000)
  // 관제 바닥 여섯째 칸(compact)은 방 칸 높이에 맞춰 낮게. 더 높으면 둘째 줄이 늘어 화면이 스크롤된다
  const h = compact ? 270 : 340
  const m = METRICS.find((x) => x.key === metric)!
  // 지금 = 화면 시각(1초마다). 실시간 값이 없는 시연 값이면 마지막 기록 시각
  const lastT = Math.max(0, ...views.map((v) => Date.parse(v.times[v.times.length - 1] ?? '') || 0))
  const live = !!ticks && Object.keys(ticks).length > 0
  const now = live ? clock.getTime() : lastT || clock.getTime()
  // 예측 칸은 가장 긴 예측 길이만큼(최대 15분, 최소 5분). 온도·습도는 예측이 없어 오른쪽 여백 1분
  const ahead = metric === 'co2' ? Math.max(5, Math.min(ENV_RULES.forecastMinutes, Math.max(0, ...views.map((v) => v.forecast.length)))) : 1
  const t0 = now - PAST_MIN * 60_000
  const t1 = now + ahead * 60_000
  const limit = metric === 'co2' ? ENV_RULES.co2LimitPpm : metric === 'temp' ? ENV_RULES.hotC : metric === 'hum' ? ENV_RULES.dryPct : ENV_RULES.lightOnPct
  const trusted = (v: RoomView) => (metric === 'light' ? !v.flags.offline : isTrusted(v))

  const lines = views.map((v) => {
    const pts = pointsOf(v, metric, ticks?.[v.roomId], t0)
    let last: Pt | null = null
    for (let k = pts.length - 1; k >= 0 && !last; k--) last = pts[k]
    // 마지막 값을 지금까지 이어 선 끝이 늘 오른쪽 "지금"에 닿게
    const tip = last && live && now - last.t < 90_000 ? { t: now, v: last.v } : last
    const pred = metric === 'co2' && tip ? v.forecast.map((p, i) => ({ t: tip.t + (i + 1) * 60_000, v: p })) : []
    return { v, pts, tip, pred }
  })

  const sure = lines.filter((l) => trusted(l.v)).flatMap((l) => [...l.pts, ...l.pred]).filter((p): p is Pt => !!p && p.t >= t0).map((p) => p.v)
  const all = sure.length ? sure : lines.flatMap((l) => l.pts).filter((p): p is Pt => !!p).map((p) => p.v)
  // 값 둘레로 확대해 움직임이 보이게. 기준이 멀면 기준선 대신 위(습도는 아래) 끝에 "기준까지 얼마"만 적는다
  const [lo, hi] = all.length ? rangeOf(metric, all, limit) : [0, 100]

  const iw = Math.max(1, w - PAD.l - PAD.r)
  const ih = h - PAD.t - PAD.b
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * iw
  const y = (v: number) => PAD.t + ih - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih
  const ticksY = useMemo(() => {
    const span = hi - lo
    const step = metric === 'co2' ? (span > 500 ? 200 : span > 250 ? 100 : 50) : metric === 'temp' ? (span > 4 ? 1 : 0.5) : metric === 'hum' ? 5 : 25
    const out: number[] = []
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
    return out
  }, [lo, hi, metric])
  // 5분마다 세로 눈금과 시각. 시간이 흐르면 같이 왼쪽으로 흘러간다
  const gridT: number[] = []
  for (let t = Math.ceil(t0 / (GRID_MIN * 60_000)) * GRID_MIN * 60_000; t <= t1; t += GRID_MIN * 60_000) gridT.push(t)

  const pathOf = (pts: (Pt | null)[]) => {
    let d = ''
    let pen = false
    let prev = -Infinity
    for (const p of pts) {
      // 값이 없거나 3분 넘게 비면 선을 끊는다
      if (!p || p.t - prev > 180_000) pen = false
      if (!p) continue
      d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`
      pen = true
      prev = p.t
    }
    return d
  }
  const area = (pts: (Pt | null)[], tip: Pt | null) => {
    // 칠하는 면은 지금에서 거꾸로 끊김 없이 이어진 구간만(센서가 3분 넘게 빈 곳을 가로질러 칠하지 않게)
    const ok: Pt[] = []
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i]
      if (!p || p.t < t0 - 60_000 || (ok.length && ok[0].t - p.t > 3 * 60_000)) break
      ok.unshift(p)
    }
    if (!ok.length || !tip) return ''
    const line = [...ok, tip].map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
    return `${line}L${x(tip.t).toFixed(1)},${PAD.t + ih}L${x(ok[0].t).toFixed(1)},${PAD.t + ih}Z`
  }

  // 선 끝 번호: 겹치면 18px씩 띄운다
  const ends = lines.filter((l) => l.tip).map((l) => ({ id: l.v.roomId, y: y(trusted(l.v) && l.pred.length ? l.pred[l.pred.length - 1].v : l.tip!.v) })).sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 18) ends[k].y = ends[k - 1].y + 18

  const hot = (v: RoomView) => metric === 'co2' ? v.flags.co2Over || v.flags.co2Soon : metric === 'light' ? v.flags.lightLeftOn : false

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const t = t0 + ((e.clientX - r.left - PAD.l) / iw) * (t1 - t0)
    setHover(t < t0 || t > t1 ? null : t)
  }
  const near = (pts: (Pt | null)[], t: number) => {
    let best: Pt | null = null
    for (const p of pts) if (p && Math.abs(p.t - t) <= 60_000 && (!best || Math.abs(p.t - t) < Math.abs(best.t - t))) best = p
    return best
  }
  const at = hover === null ? null : lines.map((l) => {
    const pred = hover > now
    const p = !trusted(l.v) ? null : pred ? near(l.pred, hover) : near(l.tip ? [...l.pts, l.tip] : l.pts, hover)
    return { id: l.v.roomId, name: l.v.name, val: p?.v ?? null, pred }
  })
  const limitY = y(limit)
  const above = metric !== 'hum'
  const limitIn = limit >= lo && limit <= hi
  const zone = metric !== 'light' && limitIn
  const nowX = x(now)

  const label = `방 ${views.length}개 ${m.label} 지난 ${PAST_MIN}분${metric === 'co2' ? `과 ${ahead}분 예측` : ''}. ` + lines.map((l) =>
    `${l.v.roomId}번 ${trusted(l.v) && l.tip ? `${fmt(l.tip.v, m.digits)}${m.unit}` : '값 없음'}`).join(', ')

  return (
    <div className={`ov-chart ${live ? 'is-live' : ''}`} ref={ref}>
      {w === 0 && <div style={{ height: h }} aria-hidden="true" />}
      {w > 0 && (
        <svg className={metric === 'temp' || metric === 'hum' ? 'ov-ref' : ''} width={w} height={h} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <pattern id="ov-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="6" className="ov-hatch" />
            </pattern>
            <clipPath id="ov-clip"><rect x={PAD.l} y={PAD.t - 4} width={iw} height={ih + 8} /></clipPath>
            {lines.map((l) => (
              <linearGradient key={l.v.roomId} id={`ov-fill-${l.v.roomId}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" className={`ov-stop r${l.v.roomId}`} stopOpacity="0.16" />
                <stop offset="1" className={`ov-stop r${l.v.roomId}`} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {zone && <rect x={PAD.l} width={iw} y={above ? PAD.t : limitY} height={above ? Math.max(0, limitY - PAD.t) : Math.max(0, PAD.t + ih - limitY)} fill="url(#ov-hatch)" />}
          {ticksY.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} className="ov-grid" />
              <text x={PAD.l - 8} y={y(t) + 4} className="ov-tick" textAnchor="end">{fmt(t, Number.isInteger(t) ? 0 : 1)}</text>
            </g>
          ))}
          {gridT.map((t) => (
            <g key={t} className="ov-vt">
              <line x1={x(t)} x2={x(t)} y1={PAD.t} y2={PAD.t + ih} className="ov-grid" />
              {Math.abs(x(t) - nowX) > 28 && <text x={x(t)} y={h - 9} className="ov-tick" textAnchor="middle">{seoulClock(new Date(t)).slice(0, 5)}</text>}
            </g>
          ))}
          {limitIn && <line x1={PAD.l} x2={PAD.l + iw} y1={limitY} y2={limitY} className="ov-limit" />}
          {limitIn && <text x={PAD.l + 6} y={limitY - 6} className="ov-limit-t">{metric === 'co2' ? `환기 기준 ${limit}` : metric === 'temp' ? `참고 ${limit}°C` : metric === 'hum' ? `참고 ${limit}%` : `불 켜짐 ${limit}%`}</text>}
          {!limitIn && <text x={PAD.l + 6} y={above ? PAD.t + 14 : PAD.t + ih - 6} className="ov-limit-t ov-limit-off">{`${above ? '↑' : '↓'} ${metric === 'co2' ? '환기 기준' : '참고'} ${fmt(limit, 0)}${m.unit === 'ppm' ? '' : m.unit}`}</text>}
          {metric === 'co2' && <rect x={nowX} width={Math.max(0, PAD.l + iw - nowX)} y={PAD.t} height={ih} className="ov-ahead" />}
          <line x1={nowX} x2={nowX} y1={PAD.t} y2={PAD.t + ih} className="ov-now" />
          <text x={nowX} y={h - 9} className="ov-tick ov-now-t" textAnchor="middle">{seoulClock(new Date(now))}</text>
          {metric === 'co2' && <text x={PAD.l + iw - 4} y={PAD.t + 14} className="ov-tick" textAnchor="end">예측 {ahead}분</text>}

          <g clipPath="url(#ov-clip)">
            {lines.map((l) => {
              const ok = trusted(l.v)
              const dim = focus !== null && focus !== l.v.roomId
              const cls = `ov-line r${l.v.roomId} ${!ok ? 'off' : hot(l.v) ? 'hot' : ''} ${dim ? 'dim' : ''} ${focus === l.v.roomId ? 'focus' : ''}`
              const pts = l.tip && l.tip !== l.pts[l.pts.length - 1] ? [...l.pts, l.tip] : l.pts
              const pred = ok && l.tip && l.pred.length ? pathOf([l.tip, ...l.pred]) : ''
              return (
                <g key={l.v.roomId} className={cls}>
                  {ok && (focus === l.v.roomId || (focus === null && hot(l.v))) && <path d={area(l.pts, l.tip)} fill={`url(#ov-fill-${l.v.roomId})`} className="ov-area" />}
                  <path d={pathOf(pts)} className="ov-path" />
                  {pred && <path d={pred} className="ov-pred" />}
                </g>
              )
            })}
          </g>

          {lines.filter((l) => l.tip && trusted(l.v)).map((l) => (
            <g key={l.v.roomId} className={`ov-live r${l.v.roomId} ${hot(l.v) ? 'hot' : ''} ${focus !== null && focus !== l.v.roomId ? 'dim' : ''}`} transform={`translate(${x(l.tip!.t).toFixed(1)},${y(l.tip!.v).toFixed(1)})`}>
              <circle r="9" className="ov-ping" />
              <circle r="3.5" className="ov-dot" />
            </g>
          ))}
          {ends.map((e) => {
            const v = views.find((q) => q.roomId === e.id)!
            const dim = focus !== null && focus !== e.id
            return (
              <g key={e.id} className={`ov-end r${e.id} ${!trusted(v) ? 'off' : hot(v) ? 'hot' : ''} ${dim ? 'dim' : ''}`} transform={`translate(${(PAD.l + iw + 22).toFixed(1)},${e.y})`}>
                <circle r="9" />
                <text y="4" textAnchor="middle">{e.id}</text>
              </g>
            )
          })}

          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="ov-cross" />}
        </svg>
      )}
      {at && hover !== null && (
        <div className="ov-tip" style={{ left: Math.min(Math.max(x(hover), 90), w - 90) }} role="status">
          <b>{seoulClock(new Date(hover))}{at[0]?.pred ? ' 예측' : ''}</b>
          {[...at].sort((a, b) => (b.val ?? -1e9) - (a.val ?? -1e9)).map((r) => (
            <span key={r.id} className={`r${r.id} ${focus === r.id ? 'on' : ''}`}><i>{r.id}</i>{r.name}<em>{r.val === null ? '–' : `${fmt(r.val, m.digits)}${m.unit}`}</em></span>
          ))}
        </div>
      )}
      <div className="ov-rooms" role="group" aria-label="방 골라 또렷하게 보기">
        {views.map((v) => (
          <button key={v.roomId} type="button" aria-pressed={focus === v.roomId} className={`r${v.roomId} ${!trusted(v) ? 'off' : hot(v) ? 'hot' : ''}`}
            onClick={() => onFocus(focus === v.roomId ? null : v.roomId)}>
            <i aria-hidden="true">{v.roomId}</i><span className="ov-room-n">{v.name}</span>
            <b className="ov-room-v">{(() => { const l = lines.find((q) => q.v.roomId === v.roomId); return l?.tip && trusted(v) ? <>{fmt(l.tip.v, m.digits)}<small>{m.unit}</small></> : '–' })()}</b>
          </button>
        ))}
        <span className="ov-key"><i className="k-line" />측정 {metric === 'co2' && <><i className="k-pred" />예측</>}<i className="k-hot" />주의 <i className="k-off" />확인 필요</span>
      </div>
    </div>
  )
}

const LEVEL_TEXT = ['낮음', '보통', '조금 높음', '기준 가까움', '기준 넘음']

/** 방마다 지난 시간 + 예측 열지도 한 줄 */
function HeatRow({ row, i, focus }: { row: ReturnType<typeof overview>['rows'][number]; i: number; focus: boolean }) {
  const cells: { lv: Level | null; ahead: boolean }[] = [...row.past.map((lv) => ({ lv, ahead: false })), ...row.ahead.map((lv) => ({ lv, ahead: true }))]
  const max = row.past.reduce<number>((m, lv) => (lv === null ? m : Math.max(m, lv)), -1)
  return (
    <li className={`hr ${focus ? 'on' : ''}`} style={{ '--k': i } as CSSProperties}>
      <span className="hr-no">{row.roomId}</span>
      <span className="hr-strip" role="img" aria-label={`${row.name} 지난 ${row.past.length}분 가장 높을 때 ${max < 0 ? '값 없음' : LEVEL_TEXT[max]}, 기준 넘은 ${row.overMinutes}분`}>
        {cells.map((c, j) => <i key={j} className={`lv${c.lv ?? 'x'} ${c.ahead ? 'ah' : ''}`} />)}
      </span>
      <span className={`hr-n ${row.overMinutes ? 'hot' : ''}`}><b>{row.overMinutes}</b>분</span>
      <span className="hr-later">{row.later === null ? '–' : row.later}</span>
    </li>
  )
}

/** compact: 관리자 첫 화면(지금)에서는 그래프만. 숫자 칸·열지도는 빼서 한눈에 덜 복잡하게(11/10 재웅) */
export function AdminOverview({ views, compact = false, ticks }: { views: RoomView[]; compact?: boolean; ticks?: LiveTicks }) {
  const [metric, setMetric] = useState<Metric>('co2')
  const [focus, setFocus] = useState<number | null>(null)
  const o = useMemo(() => overview(views), [views])
  const top = o.top ? views.find((v) => v.roomId === o.top!.roomId) : null

  return (
    <section className="ctl-ov" aria-labelledby="ov-h">
      <header className="ov-head">
        <h2 id="ov-h">{compact ? '방 1~5 실시간' : <>전체 실시간 분석 <small>방 1~5 한 그래프</small></>}</h2>
        <div className="ov-seg" role="group" aria-label="보는 값" style={{ '--i': METRICS.findIndex((x) => x.key === metric) } as CSSProperties}>
          <span className="ov-seg-glow" aria-hidden="true" />
          {METRICS.map((x) => <button key={x.key} type="button" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>{x.label}</button>)}
        </div>
      </header>

      {!compact && <ul className="ov-facts">
        <li><small>평균 CO2</small><b>{o.avg ?? '–'}<i>ppm</i></b><em>값 있는 방 {o.measured}곳</em></li>
        <li><small>가장 높은 방</small><b>{o.top ? <>{o.top.roomId}<i>번</i> {o.top.co2}</> : '–'}</b><em>{top?.co2Note ?? ''}</em></li>
        <li className={o.soon ? 'hot' : ''}><small>넘었거나 {ENV_RULES.warnWithinMinutes}분 안에 넘을 방</small><b>{o.soon}<i>곳</i></b><em>{o.soon ? '환기 순서를 보세요' : '없어요'}</em></li>
        <li className="ov-order">
          <small>환기 순서</small>
          {o.order.length
            ? <ol>{o.order.map((x) => <li key={x.roomId}><i>{x.roomId}</i>{x.why}</li>)}</ol>
            : <p>지금은 서둘러 환기할 방이 없어요.</p>}
        </li>
      </ul>}

      <MultiChart key={metric} views={views} metric={metric} focus={focus} onFocus={setFocus} ticks={ticks} compact={compact} />

      {!compact && <div className="ov-heat">
        <div className="hr hr-head" aria-hidden="true">
          <span />
          <span className="hr-axis"><span>{views[0]?.history.length ?? ENV_RULES.historyMinutes}분 전</span><span>지금</span><span>+{ENV_RULES.forecastMinutes}분</span></span>
          <span>넘은 시간</span>
          <span>15분 뒤</span>
        </div>
        <ul>{o.rows.map((r, i) => <HeatRow key={r.roomId} row={r} i={i} focus={focus === r.roomId} />)}</ul>
        <p className="ov-heat-key" aria-hidden="true">
          CO2 <i className="lv0" />낮음 <i className="lv1" /><i className="lv2" /><i className="lv3" />기준 가까움 <i className="lv4" />넘음 <i className="lvx" />값 없음 · 오른쪽 옅은 칸은 예측
        </p>
      </div>}
    </section>
  )
}
