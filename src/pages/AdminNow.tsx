import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { currentMemberId } from '../api/client'
import { adminErrorMessage } from '../api/admin'
import { ENV_SOURCE, getRoomsEnvironment, type RoomsEnvironment } from '../api/environment'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView, type RoomView } from '../lib/roomHealth'
import { useRoomBlocks } from '../api/roomBlocks'
import { blockNow, reasonStatus } from '../lib/roomBlocks'
import { useCountUp } from '../lib/useCountUp'
import { seoulClock } from '../lib/time'
import type { TodoCounts } from './AdminTodo'
import './AdminNow.css'

const REQUEST_TIMEOUT_MS = 8_000

/** CO2 지난 45분 선 + 15분 예측 점선 + 기준선. 가로로 늘어나도 선 굵기는 그대로 */
export function Co2Chart({ view, limit = ENV_RULES.co2LimitPpm }: { view: RoomView; limit?: number }) {
  const W = 300
  const H = 86
  const n = view.history.length
  const f = ENV_RULES.forecastMinutes
  const values = [...view.history, ...view.forecast].filter((v): v is number => v !== null)
  const lo = 400
  const hi = Math.max(limit + 200, ...values.map((v) => v + 50))
  const total = Math.max(2, n + f)
  const x = (i: number) => (i / (total - 1)) * (W - 4) + 2
  const y = (v: number) => H - 4 - ((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * (H - 10)

  // 센서 값이 빈 분에서 선을 끊는다
  const runs: [number, number][][] = []
  view.history.forEach((v, i) => {
    if (v === null) { runs.push([]); return }
    if (!runs.length) runs.push([])
    runs[runs.length - 1].push([x(i), y(v)])
  })
  const lines = runs.filter((r) => r.length > 1)
  const lastIdx = view.history.map((v, i) => (v === null ? -1 : i)).reduce((a, b) => Math.max(a, b), -1)
  const last = lastIdx >= 0 ? (view.history[lastIdx] as number) : null
  const pred = last !== null && view.forecast.length
    ? [[x(lastIdx), y(last)], ...view.forecast.map((v, i) => [x(lastIdx + i + 1), y(v)])]
    : []
  const pts = (p: number[][]) => p.map(([a, b]) => `${a.toFixed(1)},${b.toFixed(1)}`).join(' ')
  const label = view.co2 === null
    ? `${view.name} CO2 센서 없음`
    : `${view.name} CO2 지난 ${n}분${view.forecast.length ? `과 ${view.forecast.length}분 예측` : ''}. 지금 ${view.co2}ppm`

  return (
    <div className="co2-chart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label}>
        <line x1="0" x2={W} y1={y(limit)} y2={y(limit)} className="c-limit" vectorEffect="non-scaling-stroke" />
        {lines.map((r, i) => (
          <g key={i}>
            <polygon points={`${r[0][0]},${H} ${pts(r)} ${r[r.length - 1][0]},${H}`} className="c-fill" />
            <polyline points={pts(r)} className="c-line" pathLength={1} vectorEffect="non-scaling-stroke" />
          </g>
        ))}
        {pred.length > 1 && <polyline points={pts(pred)} className="c-pred" vectorEffect="non-scaling-stroke" />}
        {last !== null && <line x1={x(lastIdx)} x2={x(lastIdx)} y1="4" y2={H} className="c-now" vectorEffect="non-scaling-stroke" />}
      </svg>
      <span className="c-limit-label" style={{ top: `${(y(limit) / H) * 100}%` }}>{limit}</span>
      {last !== null && <span className="c-dot" style={{ left: `${(x(lastIdx) / W) * 100}%`, top: `${(y(last) / H) * 100}%` }} />}
      {view.co2 === null && <span className="c-empty">CO2 센서 없음</span>}
    </div>
  )
}

function Value({ label, value, unit, note, hot, big }: { label: string; value: string | null; unit: string; note: string; hot?: boolean; big?: boolean }) {
  return (
    <div className={`nv ${big ? 'big' : ''} ${hot ? 'hot' : ''}`}>
      <small>{label}</small>
      {value === null ? <b className="none">–</b> : <b>{value}<i>{unit}</i></b>}
      <em>{note}</em>
    </div>
  )
}

export function RoomCard({ view, blocked, i = 0 }: { view: RoomView; blocked?: string | null; i?: number }) {
  const { flags } = view
  return (
    <article className={`card now-room t-${view.tone}`} aria-label={`${view.name} ${view.status.text}`} style={{ '--k': i } as CSSProperties}>
      <header className="nr-head">
        <span className="nr-no">{view.roomId}</span>
        <div className="nr-title">
          <b>{view.name}</b>
          <span className="muted">{view.slot}</span>
        </div>
        {blocked && <span className="nr-st s-warn" title="관리자가 막은 기간">{blocked}</span>}
        <span className={`nr-st s-${view.status.tone}`}>{view.status.text}</span>
      </header>
      <div className="nr-vals">
        <Value big label="CO2" value={view.co2 === null ? null : String(view.co2)} unit="ppm" note={view.co2Note}
          hot={flags.co2Soon || flags.co2Over} />
        <Value label="온도" value={view.temperatureC === null ? null : view.temperatureC.toFixed(1)} unit="°C" note={view.tempNote} hot={flags.hot} />
        <Value label="습도" value={view.humidityPct === null ? null : String(view.humidityPct)} unit="%" note={view.humNote} />
      </div>
      <Co2Chart view={view} />
    </article>
  )
}

/** 위 숫자 칸 하나. 값이 바뀌면 세어 올라간다 */
function Kpi({ label, value, of, tone, onClick, hint }: { label: string; value: number | null; of?: number; tone?: string; onClick?: () => void; hint?: string }) {
  const shown = useCountUp(value ?? 0)
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <b className="kpi-num" aria-hidden="true">{value === null ? '–' : shown}{of !== undefined && <small>/ {of}</small>}</b>
      <span className="sr-only">{value === null ? '모름' : `${value}${of !== undefined ? ` / ${of}` : ''}`}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  )
  return onClick
    ? <button type="button" className={`card kpi ${tone ?? ''} as-btn`} onClick={onClick}>{body}<span className="kpi-go" aria-hidden="true">→</span></button>
    : <div className={`card kpi ${tone ?? ''}`}>{body}</div>
}

/**
 * 관리자 "지금": 위에 숫자 넷(사용 중·주의·확인 필요·할 일), 아래 방마다 CO2·온도·습도·재실을 크게. 10초마다 새로 읽는다.
 * 지켜보는 화면보다 "어디를 봐야 하나"가 먼저 보이게 이상한 방은 테두리 색으로 표시한다(노랑 주의, 남색 확인 필요).
 * 데이터는 api/environment 창구 하나에서만 받는다(지금은 가짜 값)
 */
export function AdminNow({ todo, onOpenTodo }: { todo: TodoCounts; onOpenTodo: () => void }) {
  const [data, setData] = useState<RoomsEnvironment | null>(null)
  const [sample, setSample] = useState(ENV_SOURCE === 'mock')
  const [error, setError] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    let stale = false
    let ctrl: AbortController | null = null
    let poll: ReturnType<typeof setInterval> | undefined

    const load = () => {
      if (ctrl || stale) return
      const mine = new AbortController()
      ctrl = mine
      const timer = setTimeout(() => mine.abort(), REQUEST_TIMEOUT_MS)
      getRoomsEnvironment(mine.signal, memberId)
        .then((r) => { if (stale) return; setData(r.data); setSample(r.sample); setError(null); setReadAt(new Date()) })
        .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
        .finally(() => { clearTimeout(timer); if (ctrl === mine) ctrl = null })
    }
    // 화면이 안 보일 때(다른 탭·화면 꺼짐)는 읽지 않고, 다시 보이면 바로 읽는다
    const start = () => { clearInterval(poll); load(); poll = setInterval(load, ENV_RULES.pollMs) }
    const onVisible = () => { if (document.visibilityState === 'visible') start(); else clearInterval(poll) }

    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stale = true
      clearInterval(poll)
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const { blocks } = useRoomBlocks()
  const views = useMemo(() => {
    if (!data) return []
    const now = new Date(data.now)
    return data.rooms.map((r) => toRoomView(r, ADMIN_ROOMS.find((c) => c.roomId === r.roomId), now))
  }, [data])

  const used = views.filter((v) => v.status.tone === 'use' || v.flags.overtime || v.flags.unbooked).length
  const warn = views.filter((v) => v.tone === 'warn').length
  const off = views.filter((v) => v.tone === 'off').length
  const trendOnly = views.some((v) => v.forecastFrom === 'trend')

  return (
    <section className="admin-now" aria-label="지금 방 상태">
      <div className="kpis">
        {/* 방 값을 한 번도 못 받았으면 0이 아니라 "–"(모름) */}
        <Kpi label="사용 중" value={data ? used : null} of={views.length || ADMIN_ROOMS.length} tone="blue" />
        <Kpi label="주의" value={data ? warn : null} tone={warn ? 'yellow' : ''} hint="환기·더움·시간 넘김" />
        <Kpi label="확인 필요" value={data ? off : null} tone={off ? 'navy' : ''} hint="센서 멈춤·끊김" />
        <Kpi label="할 일" value={todo.reportsKnown ? todo.total : null} tone={todo.total ? 'todo' : ''} onClick={onOpenTodo}
          hint={!todo.reportsKnown ? `신고 수를 확인하지 못했어요 · AI 제안 ${todo.ai}`
            : todo.total ? `신고 ${todo.reports} · AI 제안 ${todo.ai}` : '사람이 볼 일이 없어요'} />
      </div>
      <div className="now-bar">
        <span className="now-clock" role="status"><span className="now-dot" aria-hidden="true" />
          {readAt ? <>마지막 조회 <b>{seoulClock(readAt)}</b></> : '불러오는 중…'} · {ENV_RULES.pollMs / 1000}초마다 새 값</span>
        {sample && <span className="now-sample">가짜 값 · 시연용</span>}
        <span className="now-legend">
          <i className="lg-line" />측정 <i className="lg-pred" />{ENV_RULES.forecastMinutes}분 예측{trendOnly ? '(최근 추세)' : ''} <i className="lg-limit" />환기 기준 {ENV_RULES.co2LimitPpm}
        </span>
      </div>
      {error && <p role="alert" className="adm-msg err">{error}{data ? ` 마지막 값(${readAt ? seoulClock(readAt) : ''})을 보여 주고 있어요.` : ''}</p>}
      {!data && !error && <div className="now-rooms">{Array.from({ length: 5 }, (_, i) => <div key={i} className="card now-room skel" />)}</div>}
      {views.length > 0 && (
        <div className="now-rooms">
          {views.map((v, i) => {
            const b = data ? blockNow(v.roomId, blocks, new Date(data.now)) : null
            return <RoomCard key={v.roomId} i={i} view={v} blocked={b ? reasonStatus(b.reason) : null} />
          })}
        </div>
      )}
    </section>
  )
}
