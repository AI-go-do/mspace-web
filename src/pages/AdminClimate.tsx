import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  climateMissing, getClimateRooms, getClimateSeries, getDecisions, METRICS, streamClimate,
  type ClimateRoom, type Decision, type MetricKey, type Reading, type Series, type SeriesPoint, type SseEvent, type StreamState,
} from '../api/climate'
import { adminErrorMessage } from '../api/admin'
import Odi from '../components/Odi'
import './AdminClimate.css'

/**
 * 관리자 "공기" 칸 (재웅 11/12: 센서 값은 들어오는 순간 바뀌고, 오디 판단은 정리 확인 AI 상자처럼 로딩 → 체크).
 * - 값: 처음 한 번 읽고, 그 뒤는 climate가 밀어 주는 reading으로 바로 바꾼다(물어보러 가지 않음)
 * - 그래프: 지난 2시간 실측 + 이 방 기준선 띠(평균 ± 2.5σ) + 앞으로 30분 예측 점선
 * - 오디 판단 카드: 탐지 → 예측 → 알림 → 제어 → 다시 확인. 단계 시각은 서버가 실제로 한 시각이고,
 *   돌아가는 표시는 아직 끝나지 않은 "다시 확인"뿐이다(정해 둔 시간으로 움직이는 연출 없음, 정리 확인 상자와 같은 규칙)
 * climate가 아직 없는 서버면(404·502·503) 이 칸을 숨긴다
 */

const MINUTES = 120
/** 판단 카드는 이만큼만(글자가 많아지지 않게). 다시 확인 중인 카드가 먼저 온다 */
const SHOWN = 4
const LABEL: Record<MetricKey, string> = { CO2: 'CO2', TEMPERATURE: '온도', HUMIDITY: '습도' }
const DIGITS: Record<MetricKey, number> = { CO2: 0, TEMPERATURE: 1, HUMIDITY: 0 }
const STEP: Record<Decision['steps'][number]['key'], string> = { DETECT: '탐지', PREDICT: '예측', NOTIFY: '알림', CONTROL: '제어', VERIFY: '다시 확인' }

const fmt = (v: number | null | undefined, m: MetricKey) => (v === null || v === undefined ? '–' : DIGITS[m] ? v.toFixed(DIGITS[m]) : String(Math.round(v)))

function clock(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(iso))
}

/** "12초 전" · "3분 전" */
export function ago(iso: string | null, now: number): string {
  if (!iso) return ''
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.floor(s / 60)}분 전` : `${Math.floor(s / 3600)}시간 전`
}

type SeriesMap = Record<number, Partial<Record<MetricKey, Series>>>

/** 밀려온 값 하나를 방 카드·그래프에 붙인다(같은 분이면 갈아 끼움) */
export function applyReading(rooms: ClimateRoom[], series: SeriesMap, r: Reading): { rooms: ClimateRoom[]; series: SeriesMap } {
  const vals: [MetricKey, number | null][] = [['CO2', r.co2], ['TEMPERATURE', r.temperatureC], ['HUMIDITY', r.humidityPct]]
  const nextRooms = rooms.map((room) => {
    if (room.roomId !== r.roomId) return room
    const metrics = { ...room.metrics }
    for (const [k, v] of vals) {
      const m = metrics[k]
      if (v === null || !m) continue
      metrics[k] = { ...m, value: v, at: r.at }
    }
    return { ...room, metrics, envAt: r.at, offline: false }
  })
  const per = { ...(series[r.roomId] ?? {}) }
  const minute = Math.floor(Date.parse(r.at) / 60_000)
  for (const [k, v] of vals) {
    const s = per[k]
    if (v === null || !s) continue
    const pts = s.points.slice()
    const last = pts[pts.length - 1]
    const p: SeriesPoint = { at: r.at, value: v, lower: last?.lower ?? s.baseline.lower, upper: last?.upper ?? s.baseline.upper }
    if (last && Math.floor(Date.parse(last.at) / 60_000) === minute) pts[pts.length - 1] = p
    else pts.push(p)
    per[k] = { ...s, points: pts }
  }
  return { rooms: nextRooms, series: { ...series, [r.roomId]: per } }
}

/** 판단 카드를 id로 갈아 끼우고, 열린 것 먼저·새것 먼저 */
export function upsertDecision(list: Decision[], d: Decision): Decision[] {
  const rest = list.filter((x) => x.id !== d.id)
  return [d, ...rest].sort((a, b) => Number(b.open) - Number(a.open) || Date.parse(b.openedAt) - Date.parse(a.openedAt)).slice(0, 30)
}

function useClimateLive() {
  const [rooms, setRooms] = useState<ClimateRoom[] | null>(null)
  const [series, setSeries] = useState<SeriesMap>({})
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [state, setState] = useState<StreamState>('connecting')
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<Record<number, number>>({})
  const [lastAt, setLastAt] = useState<string | null>(null)
  const seriesRef = useRef(series)
  seriesRef.current = series

  const loadSeries = useCallback(async (ids: number[], signal: AbortSignal) => {
    const all = await Promise.all(ids.map((id) => getClimateSeries(id, MINUTES, signal).then((m) => [id, m] as const).catch(() => [id, seriesRef.current[id] ?? {}] as const)))
    if (!signal.aborted) setSeries(Object.fromEntries(all))
  }, [])

  useEffect(() => {
    const ctrl = new AbortController()
    const { signal } = ctrl
    const reload = async (withSeries: boolean) => {
      const r = await getClimateRooms(signal)
      setRooms(r)
      setError(null)
      const latest = r.map((x) => x.envAt).filter((x): x is string => !!x).sort().pop() ?? null
      setLastAt((p) => (p && latest && p > latest ? p : latest))
      if (withSeries) await loadSeries(r.map((x) => x.roomId), signal)
    }
    const onEvent = (e: SseEvent) => {
      try {
        if (e.event === 'reading') {
          const r = JSON.parse(e.data) as Reading
          setRooms((prev) => {
            if (!prev) return prev
            const out = applyReading(prev, seriesRef.current, r)
            setSeries(out.series)
            return out.rooms
          })
          setFlash((f) => ({ ...f, [r.roomId]: Date.now() }))
          setLastAt(r.at)
        } else if (e.event === 'decision') {
          const d = JSON.parse(e.data) as Decision
          setDecisions((l) => upsertDecision(l, d))
        } else if (e.event === 'tick') {
          // 1분 판단이 끝남: 기준선·예측·기기 상태를 다시 읽는다(그래프는 5분마다)
          void reload(new Date().getMinutes() % 5 === 0).catch(() => undefined)
        }
      } catch { /* 모양이 다른 한 줄은 버린다 */ }
    }
    ;(async () => {
      try {
        await reload(true)
        const d = await getDecisions(12, signal)
        setDecisions(d.reduce(upsertDecision, [] as Decision[]))
        void streamClimate(onEvent, setState, signal)
      } catch (e) {
        if (signal.aborted) return
        if (climateMissing(e)) setMissing(true)
        else setError(adminErrorMessage(e))
      }
    })()
    return () => ctrl.abort()
  }, [loadSeries])

  return { rooms, series, decisions, state, missing, error, flash, lastAt }
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

/** 작은 그래프: 기준선 띠 + 실측 + 예측 점선 */
function Spark({ s, metric, now, pulse }: { s: Series | undefined; metric: MetricKey; now: number; pulse: boolean }) {
  const W = 240
  const H = 56
  if (!s || s.points.length === 0) return <div className="cl-spark empty" aria-hidden="true">값 기다리는 중</div>
  const t0 = now - MINUTES * 60_000
  const t1 = now + 30 * 60_000
  const pts = s.points.filter((p) => Date.parse(p.at) >= t0)
  const fc = s.forecast ?? []
  const vals = [...pts.map((p) => p.value), ...fc.map((p) => p.value), ...pts.flatMap((p) => [p.lower, p.upper]).filter((v): v is number => v !== null)]
  let lo = Math.min(...vals)
  let hi = Math.max(...vals)
  const pad = Math.max((hi - lo) * 0.12, metric === 'CO2' ? 20 : 0.3)
  lo -= pad
  hi += pad
  const x = (iso: string) => ((Date.parse(iso) - t0) / (t1 - t0)) * W
  const y = (v: number) => H - ((v - lo) / (hi - lo)) * H
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join('')
  const banded = pts.filter((p) => p.lower !== null && p.upper !== null)
  const band = banded.length > 1
    ? `M${banded.map((p) => `${x(p.at).toFixed(1)},${y(p.upper!).toFixed(1)}`).join('L')}L${banded.slice().reverse().map((p) => `${x(p.at).toFixed(1)},${y(p.lower!).toFixed(1)}`).join('L')}Z`
    : ''
  const last = pts[pts.length - 1]
  const fline = last && fc.length ? `M${x(last.at).toFixed(1)},${y(last.value).toFixed(1)}${fc.map((p) => `L${x(p.at).toFixed(1)},${y(p.value).toFixed(1)}`).join('')}` : ''
  const nowX = x(new Date(now).toISOString())
  return (
    <svg className="cl-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
      {band && <path d={band} className="cl-band" />}
      <line x1={nowX} x2={nowX} y1="0" y2={H} className="cl-now" />
      <path d={line} className="cl-line" />
      {fline && <path d={fline} className="cl-fc" />}
      {last && <circle key={pulse ? last.at : 'still'} cx={x(last.at)} cy={y(last.value)} r="3" className={`cl-dot${pulse ? ' pulse' : ''}`} />}
    </svg>
  )
}

const APPL: Record<string, string> = { AIRCON: '에어컨', PURIFIER: '공기청정기', VENTILATOR: '환풍기' }
const MODE: Record<string, string> = { COOL: '냉방', HEAT: '난방', DRY: '제습' }

function RoomAir({ room, series, metric, now, flashAt, i }: { room: ClimateRoom; series: Partial<Record<MetricKey, Series>> | undefined; metric: MetricKey; now: number; flashAt: number | undefined; i: number }) {
  const m = room.metrics[metric]
  const fresh = flashAt !== undefined && now - flashAt < 2500
  const status = room.offline ? 'SENSOR' : m?.status ?? 'NONE'
  const soon = m && m.status === 'SOON' && m.etaMinutes !== null ? `${m.etaMinutes}분 뒤 넘음` : m?.status === 'OVER' ? '넘음' : null
  const on = room.appliances.filter((a) => a.power === 'ON')
  return (
    <article className={`cl-room st-${status}${fresh ? ' fresh' : ''}`} style={{ '--k': i } as CSSProperties}
      aria-label={`${room.roomName} ${LABEL[metric]} ${fmt(m?.value, metric)}${m?.unit ?? ''}${soon ? `, ${soon}` : ''}`}>
      <header>
        <b className="cl-no">{room.roomId}</b>
        <span className="cl-name">{room.roomName}</span>
        <span className={`cl-src ${room.source === 'REAL' ? 'real' : 'sim'}`} title={room.source === 'REAL' ? '실제 센서 값' : '실습실 실제 값으로 만든 시뮬레이션 값'}>
          {room.source === 'REAL' ? '실측' : '시뮬'}
        </span>
        <span className={`cl-occ o-${room.occupied === null ? 'unk' : room.occupied ? 'in' : 'out'}`} title={room.occupied === null ? '재실 모름' : room.occupied ? '사람 있음' : '빈 방'} aria-hidden="true" />
      </header>
      <div className="cl-big">
        <b key={m?.at ?? 'x'} className={fresh ? 'tick' : ''}>{fmt(m?.value, metric)}</b><i>{m?.unit}</i>
        {soon && <em className="cl-soon">{soon}</em>}
      </div>
      <Spark s={series?.[metric]} metric={metric} now={now} pulse={fresh} />
      <div className="cl-sub">
        {METRICS.filter((k) => k !== metric).map((k) => (
          <span key={k}>{LABEL[k]} <b>{fmt(room.metrics[k]?.value, k)}</b>{room.metrics[k]?.unit}</span>
        ))}
        <span className="cl-ago">{room.offline ? '끊김' : ago(m?.at ?? null, now)}</span>
      </div>
      {on.length > 0 && (
        <ul className="cl-appl">
          {on.map((a) => <li key={a.applianceId}>{APPL[a.kind]}{a.mode ? ` ${MODE[a.mode]}` : ''}{a.targetC ? ` ${a.targetC}°` : ''}</li>)}
        </ul>
      )}
    </article>
  )
}

/** 오디 판단 카드 하나 (정리 확인 오디 AI 상자와 같은 모양) */
export function DecisionCard({ d }: { d: Decision }) {
  const warn = d.group !== 'LOW' && d.steps.some((s) => s.key === 'DETECT') && (d.kind === 'OVER' || d.steps.some((s) => s.status === 'FAILED'))
  const what = d.metric ? LABEL[d.metric] : '센서'
  return (
    <div className={`tidy-ai cl-card ${d.open ? 'thinking' : 'done'}${warn ? ' t-warn' : ''}`}>
      <div className="tidy-ai-head">
        <span className="tidy-ai-odi"><Odi size={24} label="오디" /></span>
        <span className="tidy-ai-name">오디 AI <i aria-hidden="true">✦</i></span>
        <span className="tidy-ai-model">{d.roomName} · {what}</span>
      </div>
      <ol className="tidy-ai-acts tidy-ai-timeline">
        {d.steps.map((s) => (
          <li key={s.key} className={s.status === 'DONE' ? 'ok' : s.status === 'RUNNING' ? 'doing' : s.status === 'FAILED' ? 'fail' : 'skip'}>
            <span className="mark" aria-hidden="true" />
            <span className="txt">
              {s.status !== 'RUNNING' && <time className="tidy-ai-at" dateTime={s.at}>{clock(s.at)}</time>}
              <b className="cl-step">{STEP[s.key]}</b>
              {s.text}
              {s.status === 'RUNNING' && <span className="sr-only"> (진행 중)</span>}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function AdminClimate() {
  const { rooms, series, decisions, state, missing, error, flash, lastAt } = useClimateLive()
  const [metric, setMetric] = useState<MetricKey>('CO2')
  const now = useNow()
  if (missing) return null
  return (
    <section className="cl" aria-labelledby="cl-h">
      <header className="cl-head">
        <h2 id="cl-h">공기</h2>
        <span className={`cl-live s-${state}`} role="status">
          <i aria-hidden="true" />{state === 'live' ? '실시간' : state === 'connecting' ? '연결 중' : '다시 연결 중'}
        </span>
        {lastAt && <span className="cl-last">새 값 {ago(lastAt, now)}</span>}
        <div className="cl-tabs" role="tablist" aria-label="지표">
          {METRICS.map((k) => (
            <button key={k} type="button" role="tab" aria-selected={metric === k} className={metric === k ? 'on' : ''} onClick={() => setMetric(k)}>{LABEL[k]}</button>
          ))}
        </div>
      </header>
      {error && <p role="alert" className="adm-msg err">{error}</p>}
      <div className="cl-body">
        <div className="cl-grid">
          {!rooms && !error && Array.from({ length: 5 }, (_, i) => <div key={i} className="cl-room skel" />)}
          {rooms?.map((r, i) => <RoomAir key={r.roomId} room={r} series={series[r.roomId]} metric={metric} now={now} flashAt={flash[r.roomId]} i={i} />)}
        </div>
        <aside className="cl-odi" aria-labelledby="cl-odi-h">
          <h3 id="cl-odi-h">오디 판단 <b>{decisions.filter((d) => d.open).length}</b></h3>
          {decisions.length === 0 && rooms && <p className="cl-calm"><span aria-hidden="true">✓</span> 모든 방 공기가 평소 범위예요</p>}
          {decisions.slice(0, SHOWN).map((d) => <DecisionCard key={d.id} d={d} />)}
          {decisions.length > SHOWN && <p className="cl-more">지난 판단 {decisions.length - SHOWN}건 더</p>}
        </aside>
      </div>
    </section>
  )
}
