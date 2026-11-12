import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import {
  climateMissing, getClimateRooms, getClimateSeries, getDecisions, streamClimate,
  type ClimateRoom, type Decision, type MetricKey, type Reading, type Series, type SeriesPoint, type SseEvent, type StreamState,
} from '../api/climate'
import { adminErrorMessage } from '../api/admin'
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
const GROUP: Record<Decision['group'], string> = { HIGH: '평소보다 높아요', LOW: '평소보다 낮아요', SENSOR: '센서가 이상해요' }
const STEP: Record<Decision['steps'][number]['key'], string> = { DETECT: '탐지', PREDICT: '예측', NOTIFY: '알림', CONTROL: '제어', VERIFY: '다시 확인' }


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

/** climate 실시간 값·판단 카드. enabled=false(시연 값)면 아무것도 읽지 않는다 */
export function useClimateLive(enabled: boolean) {
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
    if (!enabled) return
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
  }, [loadSeries, enabled])

  return { rooms, series, decisions, state, missing, error, flash, lastAt }
}

const STATUS_CLASS: Record<Decision['steps'][number]['status'], string> = { DONE: 's-done', RUNNING: 's-now', SKIPPED: 's-next', FAILED: 's-fail' }

/**
 * 오른쪽 "오디가 한 일" 안의 공기 판단 (기존 줄 모양 그대로). 한 줄 = 방 하나의 판단 하나, 아래에 다섯 단계.
 * 단계 시각은 서버가 실제로 한 시각, 도는 표시는 아직 끝나지 않은 "다시 확인"뿐
 */
export function ClimateFeed({ decisions, onOpen, max = 4 }: { decisions: Decision[]; onOpen: (roomId: number) => void; max?: number }) {
  const list = decisions.slice(0, max)
  if (list.length === 0) return null
  return (
    <ul className="ctl-feed cl-feed">
      {list.map((d, i) => {
        const detect = d.steps.find((s) => s.key === 'DETECT')
        const control = d.steps.find((s) => s.key === 'CONTROL')
        return (
          <li key={d.id} style={{ '--k': i } as CSSProperties}>
            <button type="button" className={`cf-item i-${d.open ? 'warn' : 'ok'}`} onClick={() => onOpen(d.roomId)}>
              <span className="cf-no">{d.roomId}</span>
              <span className="cf-text">
                <small>{d.roomName} · {d.metric ? LABEL[d.metric] : '센서'} · {clock(d.openedAt).slice(0, 5)}</small>
                <b>{detect?.text ?? ''}</b>
                {control && control.status === 'DONE' && <span className="cf-auto">오디: {control.text}</span>}
              </span>
              <span className="cf-go" aria-hidden="true">›</span>
            </button>
            <ol className="ca-steps cl-steps" aria-label="오디가 판단한 과정">
              {d.steps.map((s) => (
                <li key={s.key} className={STATUS_CLASS[s.status]}>
                  <i aria-hidden="true" />
                  <span><b>{STEP[s.key]}</b> {s.key === 'DETECT' && s.status === 'DONE' ? GROUP[d.group] : s.text}</span>
                  {s.at && s.status !== 'SKIPPED' && <small className="cl-at">{clock(s.at).slice(0, 5)}</small>}
                  {s.status === 'RUNNING' && <span className="sr-only"> (진행 중)</span>}
                </li>
              ))}
            </ol>
          </li>
        )
      })}
    </ul>
  )
}
