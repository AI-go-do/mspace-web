import { api, ApiError, refreshTokens } from './client'
import { accessAlive, readTokens } from '../auth/tokens'

/**
 * 오디 공기 관리(mspace-climate, 게이트웨이 /api/climate/**) 창구. 재웅 11/12 관리자 센서·자동 제어.
 * - 처음 한 번 방·그래프·판단 카드를 읽고, 그 뒤는 실시간 연결(SSE)로 밀려오는 값으로 바꾼다(10초 조회 아님)
 * - EventSource는 Authorization 머리글을 못 붙여서 fetch 스트림으로 읽는다
 */

export type MetricKey = 'CO2' | 'TEMPERATURE' | 'HUMIDITY'
export const METRICS: MetricKey[] = ['CO2', 'TEMPERATURE', 'HUMIDITY']

export interface Baseline {
  mean: number | null
  std: number | null
  lower: number | null
  upper: number | null
  samples: number
  learning: boolean
  scope: string
}

/** status: OK / SOON(곧 넘음) / OVER(넘음) / SENSOR(센서 이상) / NONE(값 없음) */
export interface ClimateMetric {
  unit: string
  value: number | null
  at: string | null
  baseline: Baseline
  trendPerMinute: number
  etaMinutes: number | null
  towards: 'UPPER' | 'LOWER' | null
  status: 'OK' | 'SOON' | 'OVER' | 'SENSOR' | 'NONE'
}

export interface ClimateAppliance {
  applianceId: string
  roomId: number
  kind: 'AIRCON' | 'PURIFIER' | 'VENTILATOR'
  brand: string
  adapter: string
  power: 'ON' | 'OFF'
  mode: 'COOL' | 'HEAT' | 'DRY' | null
  targetC: number | null
  changedAt: string | null
  by: string | null
}

/** source: REAL(실제 센서) / DERIVED(실습실 실제 값으로 만든 시뮬레이션) */
export interface ClimateRoom {
  roomId: number
  roomName: string
  source: 'REAL' | 'DERIVED'
  occupied: boolean | null
  auto: boolean
  offline: boolean
  envAt: string | null
  metrics: Partial<Record<MetricKey, ClimateMetric>>
  findings: { kind: string; metric: MetricKey | null; message: string; etaMinutes: number | null }[]
  appliances: ClimateAppliance[]
}

export interface SeriesPoint { at: string; value: number; lower: number | null; upper: number | null }
export interface Series { unit: string; points: SeriesPoint[]; forecast: SeriesPoint[]; baseline: Baseline }

export type StepKey = 'DETECT' | 'PREDICT' | 'NOTIFY' | 'CONTROL' | 'VERIFY'
export type StepStatus = 'RUNNING' | 'DONE' | 'SKIPPED' | 'FAILED'

/** 오디 판단 카드: 탐지 → 예측 → 알림 → 제어 → 다시 확인 */
export interface Decision {
  id: string
  roomId: number
  roomName: string
  metric: MetricKey | null
  group: 'HIGH' | 'LOW' | 'SENSOR'
  kind: string
  openedAt: string
  closedAt: string | null
  open: boolean
  steps: { key: StepKey; status: StepStatus; text: string; at: string }[]
}

/** 실시간으로 밀려온 새 값 한 줄 */
export interface Reading {
  roomId: number
  at: string
  co2: number | null
  temperatureC: number | null
  humidityPct: number | null
  source: 'REAL' | 'DERIVED'
}

export async function getClimateRooms(signal?: AbortSignal): Promise<ClimateRoom[]> {
  const r = await api<{ rooms: ClimateRoom[] }>('/api/climate/rooms', { signal })
  return r.rooms
}

export async function getClimateSeries(roomId: number, minutes: number, signal?: AbortSignal): Promise<Partial<Record<MetricKey, Series>>> {
  const r = await api<{ metrics: Partial<Record<MetricKey, Series>> }>(`/api/climate/rooms/${roomId}/series?minutes=${minutes}`, { signal })
  return r.metrics
}

export async function getDecisions(limit: number, signal?: AbortSignal): Promise<Decision[]> {
  const r = await api<{ decisions: Decision[] }>(`/api/climate/decisions?limit=${limit}`, { signal })
  return r.decisions
}

/** climate가 아직 안 깔린 서버(게이트웨이에 길 없음)면 404·502·503. 화면은 이 칸을 숨긴다 */
export function climateMissing(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 404 || e.status === 502 || e.status === 503)
}

export interface SseEvent { event: string; data: string }

/**
 * SSE 글 조각을 이벤트로 나눈다. 다 못 받은 끝부분은 rest로 돌려 다음 조각 앞에 붙인다.
 * 빈 줄 = 이벤트 끝, ":"로 시작 = 주석(ping), "event:" "data:" 뒤 공백 하나는 있어도 되고 없어도 된다
 */
export function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const norm = buffer.replace(/\r\n?/g, '\n')
  const blocks = norm.split('\n\n')
  const rest = blocks.pop() ?? ''
  for (const block of blocks) {
    let event = 'message'
    const data: string[] = []
    for (const line of block.split('\n')) {
      if (line === '' || line.startsWith(':')) continue
      const i = line.indexOf(':')
      const field = i < 0 ? line : line.slice(0, i)
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '')
      if (field === 'event') event = value
      else if (field === 'data') data.push(value)
    }
    if (data.length > 0 || event !== 'message') events.push({ event, data: data.join('\n') })
  }
  return { events, rest }
}

export type StreamState = 'connecting' | 'live' | 'retrying'

/**
 * 실시간 연결을 열어 두고, 끊기면 다시 붙는다(1초 → 2초 → … 최대 15초). signal을 끊으면 멈춘다.
 * 토큰이 끝났으면 refresh로 새로 받아 다시 붙는다
 */
export async function streamClimate(onEvent: (e: SseEvent) => void, onState: (s: StreamState) => void, signal: AbortSignal): Promise<void> {
  let wait = 1000
  while (!signal.aborted) {
    onState('connecting')
    try {
      let tokens = readTokens()
      if (!accessAlive(tokens)) tokens = await refreshTokens()
      const res = await fetch('/api/climate/stream', {
        headers: { Accept: 'text/event-stream', Authorization: `Bearer ${tokens?.accessToken ?? ''}` },
        credentials: 'same-origin',
        cache: 'no-store',
        signal,
      })
      if (res.status === 401) { await refreshTokens(); continue }
      if (!res.ok || !res.body) throw new Error(`stream ${res.status}`)
      onState('live')
      wait = 1000
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const { events, rest } = parseSse(buf + value)
        buf = rest
        events.forEach(onEvent)
      }
    } catch {
      if (signal.aborted) return
    }
    if (signal.aborted) return
    onState('retrying')
    await new Promise((r) => setTimeout(r, wait))
    wait = Math.min(15_000, wait * 2)
  }
}
