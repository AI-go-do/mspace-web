import { useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  climateMissing, getClimateRooms, getClimateSeries, getDecisions, streamClimate,
  type ClimateMetric, type ClimateRoom, type Decision, type MetricKey, type Reading, type Series, type SeriesPoint, type SseEvent, type StreamState,
} from '../api/climate'
import { adminErrorMessage } from '../api/admin'
import Odi from '../components/Odi'
import './AdminClimate.css'

/**
 * 관리자 "지금" 탭의 climate 연결 (재웅 11/12: 센서 값은 들어오는 순간 바뀌고, 오디 판단은 로딩 → 체크. 디자인은 기존 그대로).
 * - 값: 처음 한 번 읽고, 그 뒤는 climate가 밀어 주는 reading으로 바로 바꾼다(물어보러 가지 않음). 화면은 lib/climateOverlay로
 *   기존 방 타일·한 그래프에 그대로 얹는다
 * - 오디 판단: 탐지 → 예측 → 알림 → 제어 → 다시 확인. 단계 시각은 서버가 실제로 한 시각이고,
 *   도는 표시는 아직 끝나지 않은 "다시 확인"뿐이다(정해 둔 시간으로 움직이는 연출 없음, 정리 확인 상자와 같은 규칙)
 * climate가 아직 없는 서버면(404·502·503) 아무것도 바꾸지 않는다
 */

const MINUTES = 120
const LABEL: Record<MetricKey, string> = { CO2: 'CO2', TEMPERATURE: '온도', HUMIDITY: '습도' }
export const STEP: Record<Decision['steps'][number]['key'], string> = { DETECT: '탐지', PREDICT: '예측', NOTIFY: '알림', CONTROL: '제어', VERIFY: '다시 확인' }


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

/** 새 값이 기준선 밖이면 넘음, 안이면 평소로. 기울기·남은 분은 다음 1분 판단(tick)에서 서버가 다시 준다 */
function judge(m: ClimateMetric, v: number): ClimateMetric {
  const { lower, upper } = m.baseline
  const out = (upper !== null && v > upper) || (lower !== null && v < lower)
  const status = m.status === 'SENSOR' ? 'SENSOR' : out ? 'OVER' : m.status === 'OVER' || m.status === 'NONE' ? 'OK' : m.status
  return { ...m, status, etaMinutes: out ? null : m.etaMinutes }
}

/** 밀려온 값 하나를 방 카드·그래프에 붙인다(같은 분이면 갈아 끼움) */
export function applyReading(rooms: ClimateRoom[], series: SeriesMap, r: Reading): { rooms: ClimateRoom[]; series: SeriesMap } {
  const vals: [MetricKey, number | null][] = [['CO2', r.co2], ['TEMPERATURE', r.temperatureC], ['HUMIDITY', r.humidityPct]]
  // 방이 이미 더 새 값을 들고 있으면(늦게 도착한 값) 방도 그래프도 그대로
  const cur = rooms.find((x) => x.roomId === r.roomId)
  if (cur?.envAt && Date.parse(r.at) < Date.parse(cur.envAt)) return { rooms, series }
  const nextRooms = rooms.map((room) => {
    if (room.roomId !== r.roomId) return room
    const metrics = { ...room.metrics }
    for (const [k, v] of vals) {
      const m = metrics[k]
      if (v === null || !m) continue
      metrics[k] = { ...judge(m, v), value: v, at: r.at }
    }
    return { ...room, metrics, envAt: r.at, offline: false, source: r.source }
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

const newer = (a: string | null | undefined, b: string | null | undefined) => !!a && (!b || Date.parse(a) > Date.parse(b))

/** 다시 읽은 방 목록을 지금 화면과 합친다: 밀려온 값이 다시 읽은 값보다 새것이면 밀려온 값을 둔다 */
export function mergeRooms(prev: ClimateRoom[] | null, next: ClimateRoom[]): ClimateRoom[] {
  if (!prev) return next
  return next.map((n) => {
    const p = prev.find((x) => x.roomId === n.roomId)
    if (!p) return n
    const metrics = { ...n.metrics }
    for (const k of Object.keys(metrics) as MetricKey[]) {
      const pm = p.metrics[k]
      const nm = metrics[k]
      // 밀려온 값이 더 새것이면 값·판정·기준선을 한 묶음으로 둔다(새 기준선과 옛 판정이 섞이지 않게. 기준선은 다음 다시 읽기에서 바뀜)
      if (pm && nm && newer(pm.at, nm.at)) metrics[k] = pm
    }
    const fresher = newer(p.envAt, n.envAt)
    return { ...n, metrics, envAt: fresher ? p.envAt : n.envAt, offline: fresher ? p.offline : n.offline, source: fresher ? p.source : n.source }
  })
}

/** 다시 읽은 그래프에, 그 끝보다 뒤에 밀려온 점을 이어 붙인다 */
export function mergeSeries(prev: SeriesMap, next: SeriesMap): SeriesMap {
  const out: SeriesMap = { ...next }
  for (const id of Object.keys(next).map(Number)) {
    const per = { ...next[id] }
    for (const k of Object.keys(per) as MetricKey[]) {
      const s = per[k]
      const old = prev[id]?.[k]
      if (!s || !old) continue
      const end = s.points.length ? Date.parse(s.points[s.points.length - 1].at) : -Infinity
      const endMin = Math.floor(end / 60_000)
      const later = old.points.filter((p) => Date.parse(p.at) > end)
      if (!later.length) continue
      // 다시 읽은 마지막 분과 같은 분인데 더 늦게 밀려온 점은 그 분 점을 갈아 끼우고, 뒤 분 점은 이어 붙인다
      const same = later.filter((p) => Math.floor(Date.parse(p.at) / 60_000) === endMin).pop()
      const tail = later.filter((p) => Math.floor(Date.parse(p.at) / 60_000) > endMin)
      const pts = same ? [...s.points.slice(0, -1), same] : s.points
      per[k] = { ...s, points: [...pts, ...tail] }
    }
    out[id] = per
  }
  return out
}

/** 판단 카드를 id로 갈아 끼우고, 열린 것 먼저·새것 먼저 */
export function upsertDecision(list: Decision[], d: Decision): Decision[] {
  const rest = list.filter((x) => x.id !== d.id)
  return [d, ...rest].sort((a, b) => Number(b.open) - Number(a.open) || Date.parse(b.openedAt) - Date.parse(a.openedAt)).slice(0, 30)
}

type Live = { rooms: ClimateRoom[] | null; series: SeriesMap }

/** 밀려온 값 하나(초 단위). 큰 그래프가 분 기록 뒤에 이어 그려 진짜 실시간 차트처럼 보이게 한다 */
export interface LiveTick { t: number; co2: number | null; temp: number | null; hum: number | null }
export type LiveTicks = Record<number, LiveTick[]>
/** 초 단위 값을 들고 있는 시간 */
export const TICK_KEEP_MS = 30 * 60_000

/** 초 값 하나를 붙이고 오래된 것은 버린다 */
export function addTick(ticks: LiveTicks, r: Reading): LiveTicks {
  const t = Date.parse(r.at)
  if (!Number.isFinite(t)) return ticks
  const list = ticks[r.roomId] ?? []
  const last = list[list.length - 1]
  if (last && t <= last.t) return ticks
  const from = t - TICK_KEEP_MS
  const kept = list[0] && list[0].t < from ? list.filter((x) => x.t >= from) : list
  return { ...ticks, [r.roomId]: [...kept, { t, co2: r.co2, temp: r.temperatureC, hum: r.humidityPct }] }
}

/** climate 실시간 값·판단 카드. enabled=false(시연 값)면 아무것도 읽지 않는다 */
export function useClimateLive(enabled: boolean) {
  // 방과 그래프는 한 상태로 같이 바꾼다(값이 잇달아 와도 그래프 점이 빠지지 않게)
  const [live, setLive] = useState<Live>({ rooms: null, series: {} })
  const [decisions, setDecisions] = useState<Decision[]>([])
  const [state, setState] = useState<StreamState>('connecting')
  const [missing, setMissing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<Record<number, number>>({})
  const [lastAt, setLastAt] = useState<string | null>(null)
  const [ticks, setTicks] = useState<LiveTicks>({})

  useEffect(() => {
    if (!enabled) return
    const ctrl = new AbortController()
    const { signal } = ctrl
    const reload = async (withSeries: boolean) => {
      const r = await getClimateRooms(signal)
      let fresh: SeriesMap | null = null
      if (withSeries) {
        const all = await Promise.all(r.map((x) => getClimateSeries(x.roomId, MINUTES, signal).then((m) => [x.roomId, m] as const).catch(() => null)))
        fresh = Object.fromEntries(all.filter((x): x is NonNullable<typeof x> => x !== null))
      }
      if (signal.aborted) return
      setLive((prev) => ({
        rooms: mergeRooms(prev.rooms, r),
        series: fresh ? { ...prev.series, ...mergeSeries(prev.series, fresh) } : prev.series,
      }))
      setError(null)
      const latest = r.map((x) => x.envAt).filter((x): x is string => !!x).sort().pop() ?? null
      setLastAt((p) => (p && latest && p > latest ? p : latest))
    }
    const onEvent = (e: SseEvent) => {
      try {
        if (e.event === 'reading') {
          const r = JSON.parse(e.data) as Reading
          setLive((prev) => (prev.rooms ? applyReading(prev.rooms, prev.series, r) : prev))
          setTicks((t) => addTick(t, r))
          setFlash((f) => ({ ...f, [r.roomId]: Date.now() }))
          setLastAt(r.at)
        } else if (e.event === 'decision') {
          const d = JSON.parse(e.data) as Decision
          setDecisions((l) => upsertDecision(l, d))
          // 오디가 기기를 바꿨을 수 있다: 칸의 기기 줄이 1분 tick을 기다리지 않게 방(기기 상태)만 다시 읽는다
          void reload(false).catch(() => undefined)
        } else if (e.event === 'tick') {
          // 1분 판단이 끝남: 기준선·예측·기기 상태를 다시 읽는다(그래프는 5분마다)
          void reload(new Date().getMinutes() % 5 === 0).catch(() => undefined)
        }
      } catch { /* 모양이 다른 한 줄은 버린다 */ }
    }
    ;(async () => {
      // 처음 읽기가 잠깐 실패하면 오류를 보여 둔 채 2초 → 4초 → … 최대 30초 뒤 다시
      for (let wait = 2000; !signal.aborted; wait = Math.min(30_000, wait * 2)) {
        try {
          await reload(true)
          const d = await getDecisions(12, signal)
          setDecisions(d.reduce(upsertDecision, [] as Decision[]))
          void streamClimate(onEvent, setState, signal)
          return
        } catch (e) {
          if (signal.aborted) return
          if (climateMissing(e)) { setMissing(true); return }
          setError(adminErrorMessage(e))
        }
        await new Promise((r) => setTimeout(r, wait))
      }
    })()
    return () => ctrl.abort()
  }, [enabled])

  return { rooms: live.rooms, series: live.series, decisions, state, missing, error, flash, lastAt, ticks }
}

export const STEP_CLASS: Record<Decision['steps'][number]['status'], string> = { DONE: 'ok', RUNNING: 'doing', SKIPPED: 'skip', FAILED: 'fail' }

/** 새 판단이 오면 단계를 이만큼씩 하나씩 연다(재웅 11/12 17:29 "오디 AI도 실시간으로 파악하는, 로딩하면서 하는 느낌") */
export const REVEAL_MS = 900
/** 아직 안 연 단계 자리에 보이는 "하는 중" 문구 */
export const THINK: Record<Decision['steps'][number]['key'], string> = {
  DETECT: '값을 평소와 견주는 중', PREDICT: '앞으로 30분을 계산하는 중', NOTIFY: '방 사람에게 알릴지 보는 중',
  CONTROL: '켤 기기를 고르는 중', VERIFY: '다시 재는 중',
}

/** 처음 볼 때 탐지가 이보다 오래됐으면 지난 판단(화면을 새로 열었을 때 등)이라 다 연 채로 보인다 */
const FRESH_MS = 20_000

/**
 * 판단마다 처음 본 시각. 이미 지난 판단은 0(다 연 상태), 방금 탐지한 판단은 처음 본 시각부터 단계를 하나씩 연다.
 * 여는 동안만 0.2초마다 다시 그린다
 */
export function useReveal(list: Decision[]): (id: string) => number {
  const born = useRef(new Map<string, number>())
  const [now, setNow] = useState(() => Date.now())
  const map = born.current
  const key = list.map((d) => `${d.id}@${d.steps[0]?.at ?? ''}`).join(',')
  useEffect(() => {
    const t = Date.now()
    for (const part of key ? key.split(',') : []) {
      const [id, at] = part.split('@')
      if (!map.has(id)) map.set(id, at && t - Date.parse(at) < FRESH_MS ? t : 0)
    }
    setNow(t)
  }, [key, map])
  const opening = list.some((d) => { const b = map.get(d.id); return b === undefined || (b > 0 && now - b < REVEAL_MS * 6) })
  useEffect(() => {
    if (!opening) return
    const t = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(t)
  }, [opening])
  return (id) => revealCount(map.get(id), now)
}

/** 처음 본 시각(born)부터 now까지 연 단계 수. 0 = 화면을 열 때 이미 있던 판단(다 염), 없음 = 막 들어와 아직 하나도 안 염 */
export function revealCount(born: number | undefined, now: number): number {
  if (born === undefined) return 0
  return born === 0 ? Number.POSITIVE_INFINITY : Math.floor(Math.max(0, now - born) / REVEAL_MS)
}

/**
 * 오른쪽 "오디가 한 일" 안의 공기 판단 = 오디 AI 카드(재웅 11/12 17:09 "오른쪽 사진이 훨씬 나아", 정리 확인 오디 AI 상자와 같은 모양).
 * 카드 하나 = 방 하나의 판단 하나, 시각이 앞에 오는 다섯 단계. 시각은 서버가 실제로 한 시각, 도는 표시는 끝나지 않은 단계뿐.
 * 새로 들어온 판단은 단계를 하나씩 "하는 중"으로 보였다가 연다. 머리(오디 AI · 방 · 지표)를 누르면 그 방 상세 창
 */
export function ClimateFeed({ decisions, onOpen, max = 4 }: { decisions: Decision[]; onOpen: (roomId: number) => void; max?: number }) {
  const list = decisions.slice(0, max)
  const shown = useReveal(list)
  if (list.length === 0) return null
  return (
    <ul className="cl-feed">
      {list.map((d, i) => {
        const n = Math.min(d.steps.length, shown(d.id))
        const next = n < d.steps.length ? d.steps[n] : null
        return (
          <li key={d.id} style={{ '--k': i } as CSSProperties}>
            <article className={`tidy-ai cl-card ${d.open || next ? 'thinking' : 'done'}`} aria-label={`${d.roomName} ${d.metric ? LABEL[d.metric] : '센서'} 오디 판단`} aria-busy={next ? true : undefined}>
              <button type="button" className="tidy-ai-head cl-card-head" onClick={() => onOpen(d.roomId)} aria-label={`${d.roomName} 자세히`}>
                <span className="tidy-ai-odi"><Odi size={24} label="오디" /></span>
                <span className="tidy-ai-name">오디 AI <i aria-hidden="true">✦</i></span>
                <span className="tidy-ai-model">{d.roomName} · {d.metric ? LABEL[d.metric] : '센서'}</span>
              </button>
              <ol className="tidy-ai-acts tidy-ai-timeline" aria-label="오디가 판단한 과정">
                {d.steps.slice(0, n).map((s) => (
                  <li key={s.key} className={`${STEP_CLASS[s.status]} ${next ? 'cl-new' : ''}`}>
                    <span className="mark" aria-hidden="true" />
                    <span className="txt">
                      {s.at && s.status !== 'RUNNING' && <time className="tidy-ai-at" dateTime={s.at}>{clock(s.at)}</time>}
                      <b className="cl-step">{STEP[s.key]}</b>
                      {s.text}
                      {s.status === 'RUNNING' && <span className="sr-only"> (진행 중)</span>}
                    </span>
                  </li>
                ))}
                {next && (
                  <li key={`${next.key}-think`} className="doing cl-think">
                    <span className="mark" aria-hidden="true" />
                    <span className="txt"><b className="cl-step">{STEP[next.key]}</b>{THINK[next.key]}<span className="cl-dots" aria-hidden="true"><i /><i /><i /></span></span>
                  </li>
                )}
              </ol>
            </article>
          </li>
        )
      })}
    </ul>
  )
}
