import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { ENV_RULES } from '../config/adminRooms'
import type { RoomView } from '../lib/roomHealth'
import { isTrusted, overview, type Level } from '../lib/roomOverview'
import { seoulClock } from '../lib/time'

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

const PAD = { l: 44, r: 40, t: 14, b: 26 }

function MultiChart({ views, metric, focus, onFocus }: { views: RoomView[]; metric: Metric; focus: number | null; onFocus: (id: number | null) => void }) {
  const [ref, w] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const h = 240
  const m = METRICS.find((x) => x.key === metric)!
  const past = Math.max(0, ...views.map((v) => v.history.length))
  const ahead = metric === 'co2' ? ENV_RULES.forecastMinutes : 0
  const total = past + ahead
  const limit = metric === 'co2' ? ENV_RULES.co2LimitPpm : metric === 'temp' ? ENV_RULES.hotC : metric === 'hum' ? ENV_RULES.dryPct : ENV_RULES.lightOnPct
  // CO2 멈춤(stuck)은 SCD40 하나가 고장 난 것이라 CO2·온도·습도만 믿지 않는다. 조도는 우노라 끊김만 본다
  const trusted = (v: RoomView) => (metric === 'light' ? !v.flags.offline : isTrusted(v))

  // 축 범위는 믿을 수 있는 방 값으로만 정한다. 멈춘·끊긴 방의 튀는 값이 다른 방 선을 눌러 버리지 않게.
  // 믿을 수 없는 방 선은 그대로 그리되(점선) 범위 밖이면 위·아래 끝에 붙인다
  const valuesOf = (vs: RoomView[]) => vs.flatMap((v) => [...seriesOf(v, metric), ...(metric === 'co2' ? v.forecast : [])]).filter((x): x is number => x !== null)
  const sure = valuesOf(views.filter(trusted))
  const all = sure.length ? sure : valuesOf(views)
  const [lo, hi] = metric === 'co2'
    ? [Math.min(400, ...all) - 20, Math.max(limit + 150, ...all) + 30]
    : metric === 'temp' ? [Math.min(21, ...all) - 0.5, Math.max(limit + 1, ...all) + 0.5]
      : metric === 'hum' ? [Math.min(limit - 8, ...all) - 2, Math.max(62, ...all) + 2] : [0, 100]

  const iw = Math.max(1, w - PAD.l - PAD.r)
  const ih = h - PAD.t - PAD.b
  const x = (i: number) => PAD.l + (total > 1 ? (i / (total - 1)) * iw : 0)
  const y = (v: number) => PAD.t + ih - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * ih
  const nowI = past - 1
  const ticks = useMemo(() => {
    const step = metric === 'co2' ? 200 : metric === 'temp' ? 2 : metric === 'hum' ? 10 : 25
    const out: number[] = []
    for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v)
    return out
  }, [lo, hi, metric])

  const pathOf = (vals: (number | null)[], start = 0) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v === null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(start + i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }

  // 선 끝 번호: "지금" 자리의 값. 겹치면 위아래로 밀어 18px씩 띄운다
  const ends = views.map((v) => {
    const vals = seriesOf(v, metric)
    let j = vals.length - 1
    while (j >= 0 && vals[j] === null) j--
    return { id: v.roomId, y: j >= 0 ? y(vals[j] as number) : null }
  }).filter((e): e is { id: number; y: number } => e.y !== null).sort((a, b) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 18) ends[k].y = ends[k - 1].y + 18

  const hot = (v: RoomView) => metric === 'co2' ? v.flags.co2Over || v.flags.co2Soon : metric === 'temp' ? v.flags.hot : metric === 'hum' ? v.flags.dry : v.flags.lightLeftOn

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const px = e.clientX - r.left
    const i = Math.round(((px - PAD.l) / iw) * (total - 1))
    setHover(i < 0 || i >= total ? null : i)
  }
  const at = hover === null ? null : hover <= nowI
    ? views.map((v) => ({ id: v.roomId, name: v.name, val: trusted(v) ? seriesOf(v, metric)[hover] ?? null : null, pred: false }))
    : views.map((v) => ({ id: v.roomId, name: v.name, val: trusted(v) && metric === 'co2' ? v.forecast[hover - past] ?? null : null, pred: true }))
  const hoverTime = hover === null ? null : (() => {
    const base = views[0]?.times[views[0].times.length - 1]
    if (!base) return null
    return seoulClock(new Date(new Date(base).getTime() + (hover - nowI) * 60_000))
  })()
  const limitY = y(limit)
  const above = metric !== 'hum'
  // 조도 기준선은 "불 켜짐" 표시일 뿐 나쁨이 아니라 빗금 띠를 깔지 않는다
  const zone = metric !== 'light'

  const label = `방 ${views.length}개 ${m.label} 지난 ${past}분${ahead ? `과 ${ahead}분 예측` : ''}. ` + views.map((v) => {
    const vals = seriesOf(v, metric).filter((q): q is number => q !== null)
    return `${v.roomId}번 ${trusted(v) && vals.length ? `${fmt(vals[vals.length - 1], m.digits)}${m.unit}` : '값 없음'}`
  }).join(', ')

  return (
    <div className="ov-chart" ref={ref}>
      {/* 첫 그림 전(폭을 재기 전)에도 높이를 잡아 두어 값을 바꿀 때 화면이 튀지 않게 */}
      {w === 0 && <div style={{ height: h }} aria-hidden="true" />}
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label={label} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <defs>
            <pattern id="ov-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="2" height="6" className="ov-hatch" />
            </pattern>
          </defs>
          {/* 기준 넘는 쪽 띠 */}
          {zone && <rect x={PAD.l} width={iw} y={above ? PAD.t : limitY} height={above ? Math.max(0, limitY - PAD.t) : Math.max(0, PAD.t + ih - limitY)} fill="url(#ov-hatch)" />}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD.l} x2={PAD.l + iw} y1={y(t)} y2={y(t)} className="ov-grid" />
              <text x={PAD.l - 8} y={y(t) + 4} className="ov-tick" textAnchor="end">{fmt(t, 0)}</text>
            </g>
          ))}
          <line x1={PAD.l} x2={PAD.l + iw} y1={limitY} y2={limitY} className="ov-limit" />
          <text x={PAD.l + 6} y={limitY - 6} className="ov-limit-t">{metric === 'co2' ? `환기 기준 ${limit}` : metric === 'temp' ? `더움 ${limit}°C` : metric === 'hum' ? `건조 ${limit}%` : `불 켜짐 ${limit}%`}</text>
          {ahead > 0 && <rect x={x(nowI)} width={Math.max(0, x(total - 1) - x(nowI))} y={PAD.t} height={ih} className="ov-ahead" />}
          <line x1={x(nowI)} x2={x(nowI)} y1={PAD.t} y2={PAD.t + ih} className="ov-now" />
          <text x={x(nowI)} y={h - 8} className="ov-tick" textAnchor="middle">지금</text>
          <text x={PAD.l} y={h - 8} className="ov-tick">{past}분 전</text>
          {ahead > 0 && <text x={PAD.l + iw} y={h - 8} className="ov-tick" textAnchor="end">+{ahead}분</text>}

          {views.map((v) => {
            const ok = trusted(v)
            const dim = focus !== null && focus !== v.roomId
            const cls = `ov-line ${!ok ? 'off' : hot(v) ? 'hot' : ''} ${dim ? 'dim' : ''} ${focus === v.roomId ? 'focus' : ''}`
            const vals = seriesOf(v, metric)
            let last = vals.length - 1
            while (last >= 0 && vals[last] === null) last--
            const pred = ok && metric === 'co2' && v.forecast.length && last >= 0
              ? `M${x(last).toFixed(1)},${y(vals[last] as number).toFixed(1)}` + v.forecast.map((p, i) => `L${x(past + i).toFixed(1)},${y(p).toFixed(1)}`).join('')
              : ''
            return (
              <g key={v.roomId} className={cls}>
                <path d={pathOf(vals)} className="ov-path" pathLength={1} />
                {pred && <path d={pred} className="ov-pred" />}
              </g>
            )
          })}

          {ends.map((e) => {
            const v = views.find((q) => q.roomId === e.id)!
            const dim = focus !== null && focus !== e.id
            return (
              <g key={e.id} className={`ov-end ${!trusted(v) ? 'off' : hot(v) ? 'hot' : ''} ${dim ? 'dim' : ''}`} transform={`translate(${x(nowI)},${e.y})`}>
                <circle r="9" />
                <text y="4" textAnchor="middle">{e.id}</text>
              </g>
            )
          })}

          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={PAD.t + ih} className="ov-cross" />}
        </svg>
      )}
      {at && hoverTime && (
        <div className="ov-tip" style={{ left: Math.min(Math.max(x(hover!), 90), w - 90) }} role="status">
          <b>{hoverTime}{at[0]?.pred ? ' 예측' : ''}</b>
          {[...at].sort((a, b) => (b.val ?? -1e9) - (a.val ?? -1e9)).map((r) => (
            <span key={r.id} className={focus === r.id ? 'on' : ''}><i>{r.id}</i>{r.name}<em>{r.val === null ? '–' : `${fmt(r.val, m.digits)}${m.unit}`}</em></span>
          ))}
        </div>
      )}
      <div className="ov-rooms" role="group" aria-label="방 골라 또렷하게 보기">
        {views.map((v) => (
          <button key={v.roomId} type="button" aria-pressed={focus === v.roomId} className={!trusted(v) ? 'off' : hot(v) ? 'hot' : ''}
            onClick={() => onFocus(focus === v.roomId ? null : v.roomId)}>
            <i aria-hidden="true">{v.roomId}</i>{v.name}
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

export function AdminOverview({ views }: { views: RoomView[] }) {
  const [metric, setMetric] = useState<Metric>('co2')
  const [focus, setFocus] = useState<number | null>(null)
  const o = useMemo(() => overview(views), [views])
  const top = o.top ? views.find((v) => v.roomId === o.top!.roomId) : null

  return (
    <section className="ctl-ov" aria-labelledby="ov-h">
      <header className="ov-head">
        <h2 id="ov-h">전체 실시간 분석 <small>방 1~5 한 그래프</small></h2>
        <div className="ov-seg" role="group" aria-label="보는 값" style={{ '--i': METRICS.findIndex((x) => x.key === metric) } as CSSProperties}>
          <span className="ov-seg-glow" aria-hidden="true" />
          {METRICS.map((x) => <button key={x.key} type="button" aria-pressed={metric === x.key} onClick={() => setMetric(x.key)}>{x.label}</button>)}
        </div>
      </header>

      <ul className="ov-facts">
        <li><small>평균 CO2</small><b>{o.avg ?? '–'}<i>ppm</i></b><em>값 있는 방 {o.measured}곳</em></li>
        <li><small>가장 높은 방</small><b>{o.top ? <>{o.top.roomId}<i>번</i> {o.top.co2}</> : '–'}</b><em>{top?.co2Note ?? ''}</em></li>
        <li className={o.soon ? 'hot' : ''}><small>넘었거나 {ENV_RULES.warnWithinMinutes}분 안에 넘을 방</small><b>{o.soon}<i>곳</i></b><em>{o.soon ? '환기 순서를 보세요' : '없어요'}</em></li>
        <li className="ov-order">
          <small>환기 순서</small>
          {o.order.length
            ? <ol>{o.order.map((x) => <li key={x.roomId}><i>{x.roomId}</i>{x.why}</li>)}</ol>
            : <p>지금은 서둘러 환기할 방이 없어요.</p>}
        </li>
      </ul>

      <MultiChart key={metric} views={views} metric={metric} focus={focus} onFocus={setFocus} />

      <div className="ov-heat">
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
      </div>
    </section>
  )
}
