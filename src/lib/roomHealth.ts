import type { RoomEnvironment } from '../api/environment'
import { ENV_RULES, type AdminRoomConfig, type EnvRules, type SensorKind } from '../config/adminRooms'
import { timeRange } from './format'
import { LIGHT_STALE_MINUTES } from './lightTrail'
import { seoulClock } from './time'

/**
 * 관리자 "지금" 탭 방 카드 한 장에 필요한 것. API·가짜 값 어느 쪽이 와도 같은 규칙으로 이상을 가린다.
 * 노랑(warn): 15분 안에 CO2 기준을 넘을 것 같음·이미 넘음·시간 넘김·예약 없는데 CO2 오름(무단 사용 의심)
 * 온도·습도는 덥고 건조한 느낌이 사람마다 달라서 노랑으로 올리지 않는다(방 상세 창에 참고로만)
 * 빨강(off): 신호 끊김·CO2가 20분 넘게 같은 값(센서 고장 의심)
 */
export type Tone = 'ok' | 'warn' | 'off'

export interface RoomView {
  roomId: number
  name: string
  sensors: ReadonlySet<SensorKind>
  co2: number | null
  temperatureC: number | null
  humidityPct: number | null
  /** 그래프용 지난 CO2 (센서 없는 분은 null) */
  history: (number | null)[]
  /** 그래프용 지난 온도·습도 (history와 같은 분) */
  temps: (number | null)[]
  hums: (number | null)[]
  /** 지금 밝기 % (조도 원시값 0~1023 → 0~100). 조도 센서가 없거나 값이 없으면 null */
  light: number | null
  /** PIR 움직임 최신 값(core가 줄 때만). 보여 주기만 하고 재실 판단에는 안 쓴다 */
  pir: boolean | null
  /** 그래프용 지난 밝기 % (history와 같은 분) */
  lights: (number | null)[]
  /** 그래프용 지난 재실 (그 분 사람 있음). core가 분마다 안 주면 null */
  occupancy: (boolean | null)[]
  /** 끝에서부터 불이 켜진(밝기 ≥ lightOnPct) 채 이어진 분. 사람이 없던 분만 센다 */
  lightOnEmptyMinutes: number
  /** 그래프용 지난 문 열림 (장치가 없으면 null) */
  doors: (boolean | null)[]
  /** 문 지금 상태와 그 상태로 지난 분. 문 장치가 없으면 null */
  door: { open: boolean; since: string; minutes: number } | null
  /** history 각 분의 시각 */
  times: string[]
  /** 지금 걸린 예약 (방 상세 창의 강제 퇴실·예약 끝 표시용) */
  current: { reservationId: number; startAt: string; endAt: string; people: number } | null
  presence: RoomEnvironment['presence']
  lastSignalAt: string | null
  /** 그래프용 앞으로 CO2 (1분 간격). 그릴 수 없으면 빈 배열 */
  forecast: number[]
  forecastFrom: 'model' | 'trend' | null
  /** 기준을 넘기까지 남은 분. 오르는 중이 아니거나 이미 넘었으면 null */
  etaMinutes: number | null
  /** 끝에서부터 CO2가 같은 값으로 이어진 분 */
  sameForMinutes: number
  /** 예약이 시작됐는데 아무도 없는 분 (아니면 0) */
  noEntryMinutes: number
  /** 예약이 끝났는데 사람이 남은 분 (아니면 0) */
  overtimeMinutes: number
  flags: { co2Soon: boolean; co2Over: boolean; hot: boolean; dry: boolean; overtime: boolean; unbooked: boolean; offline: boolean; stuck: boolean; doorLeftOpen: boolean; noEntry: boolean; nightDoor: boolean; lightLeftOn: boolean }
  tone: Tone
  status: { text: string; tone: 'use' | 'empty' | 'warn' | 'off' }
  /** "14:00–16:00 · 예약 5명" / "다음 16:00 (예약 4명)" / "다음 예약 없음" */
  slot: string
  /** 다음 예약 시작 시각. 다음 예약이 없거나 모르면 null */
  nextAt: string | null
  /** CO2 아래 한 줄 */
  co2Note: string
  tempNote: string
  humNote: string
  lightNote: string
}

/** 조도 원시값(우노 CDS 0~1023) → 밝기 % */
export const lightPct = (raw: number | null | undefined): number | null =>
  raw === null || raw === undefined ? null : Math.round((Math.max(0, Math.min(1023, raw)) / 1023) * 100)

/** 끝에서부터 같은 값이 이어진 개수 - 1 (= 분) */
function sameTail(values: (number | null)[]): number {
  let i = values.length - 1
  while (i >= 0 && values[i] === null) i--
  if (i < 0) return 0
  const v = values[i]
  let n = 0
  for (let j = i - 1; j >= 0 && values[j] === v; j--) n++
  return n
}

/** 최근 10분 기울기(1분에 몇 ppm). 값이 모자라면 null */
export function trendSlope(values: (number | null)[], span = 10): number | null {
  const pts = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] !== null)
  if (pts.length < 2) return null
  const last = pts[pts.length - 1]
  const first = pts.find((p) => p[0] >= last[0] - span) ?? pts[0]
  if (first[0] === last[0]) return null
  return (last[1] - first[1]) / (last[0] - first[0])
}

export function toRoomView(env: RoomEnvironment, cfg: AdminRoomConfig | undefined, now: Date, rules: EnvRules = ENV_RULES): RoomView {
  const sensors = new Set<SensorKind>(cfg?.sensors ?? ['co2', 'temperature', 'humidity', 'presence'])
  const history = env.series.map((p) => (sensors.has('co2') ? p.ppm : null))
  const temps = env.series.map((p) => (sensors.has('temperature') ? p.temperatureC ?? null : null))
  const hums = env.series.map((p) => (sensors.has('humidity') ? p.humidityPct ?? null : null))
  const times = env.series.map((p) => p.at)
  const doors = env.series.map((p) => (sensors.has('door') ? p.doorOpen ?? null : null))
  const lights = env.series.map((p) => (sensors.has('light') ? lightPct(p.light) : null))
  const occupancy = env.series.map((p) => p.occupied ?? null)
  const light = sensors.has('light') ? lightPct(env.light) : null
  const door = sensors.has('door') && env.door
    ? { ...env.door, minutes: Math.max(0, Math.floor((now.getTime() - new Date(env.door.since).getTime()) / 60_000)) }
    : null
  const co2 = sensors.has('co2') ? env.co2?.ppm ?? null : null
  const temperatureC = sensors.has('temperature') ? env.temperatureC : null
  const humidityPct = sensors.has('humidity') ? env.humidityPct : null

  const sameForMinutes = sameTail(history)
  // 판단용 CO2: co2MedianOf분 가운데값으로 순간 튄 값을 거른다(1이면 그대로). 화면 숫자는 그대로 보여 준다
  const k = Math.max(1, rules.co2MedianOf ?? 1)
  const smooth = k === 1 ? history : history.map((_, i) => {
    const w = history.slice(Math.max(0, i - k + 1), i + 1).filter((x): x is number => x !== null).sort((a, b) => a - b)
    return w.length ? w[Math.floor(w.length / 2)] : null
  })
  const co2Judge = co2 === null ? null : k === 1 ? co2 : smooth[smooth.length - 1] ?? co2
  const stuck = co2 !== null && sameForMinutes >= rules.stuckMinutes
  const offline = env.offline

  // 예측: 젯슨 값이 오면 그것을, 없으면 최근 10분 추세를 이어 그린다. 고장·끊김이면 그리지 않는다
  let forecast: number[] = []
  let forecastFrom: RoomView['forecastFrom'] = null
  if (co2 !== null && !stuck && !offline) {
    if (env.forecast?.length) {
      forecast = env.forecast.slice(0, rules.forecastMinutes).map((f) => f.ppm)
      forecastFrom = 'model'
    } else {
      const slope = trendSlope(smooth)
      if (slope !== null) {
        forecast = Array.from({ length: rules.forecastMinutes }, (_, i) => Math.round(co2Judge! + slope * (i + 1 + (k - 1) / 2)))  // 가운데값은 (k-1)/2분 늦으니 그만큼 앞당긴다
        forecastFrom = 'trend'
      }
    }
  }
  // 순간 튄 값에 나서지 않게, 최근 hold분 값이 모두 기준 이상일 때만 "넘음"(1이면 지금 값 하나만 본다)
  const hold = Math.max(1, rules.co2OverHoldMinutes ?? 1)
  const recent = history.slice(-hold)
  const co2OverRaw = co2Judge !== null && co2Judge >= rules.co2LimitPpm && recent.length >= hold - 1 && recent.slice(0, -1).every((v) => v !== null && v >= rules.co2LimitPpm)
  const crossAt = co2OverRaw ? -1 : forecast.findIndex((v) => v >= rules.co2LimitPpm)
  const etaMinutes = crossAt >= 0 ? crossAt + 1 : null
  // 알릴 사람이 없는 빈 방(재실 없음 + 지금 걸린 예약 없음)은 값만 보여 주고 나서지 않는다(co2AlertWhenEmpty 0)
  const nowMs = now.getTime()
  const activeBooking = !!env.current && nowMs >= new Date(env.current.startAt).getTime() && nowMs < new Date(env.current.endAt).getTime()
  const someoneToTell = env.presence !== 'EMPTY' || activeBooking || (rules.co2AlertWhenEmpty ?? 1) >= 1
  const co2Over = co2OverRaw && someoneToTell
  const co2Soon = someoneToTell && etaMinutes !== null && etaMinutes <= rules.warnWithinMinutes

  const hot = temperatureC !== null && temperatureC >= rules.hotC
  const dry = humidityPct !== null && humidityPct < rules.dryPct

  const occupied = env.presence === 'OCCUPIED'
  // 재실이 최근 presenceHoldMinutes분 내내 state였는지. 분마다 값이 없으면 지금 값만 본다
  const pHold = Math.max(1, rules.presenceHoldMinutes ?? 1)
  const heldFor = (state: boolean) => occupancy.slice(-pHold).every((o) => o === null || o === state)
  const endMs = env.current ? new Date(env.current.endAt).getTime() : null
  const overtimeMinutes = occupied && endMs !== null && now.getTime() > endMs ? Math.floor((now.getTime() - endMs) / 60_000) : 0
  const overtime = overtimeMinutes >= rules.overtimeGraceMinutes && heldFor(true)
  // 무단 사용 의심: 걸린 예약이 없는데(끝난 예약에 남은 건 "시간 넘김"이 맡는다) 최근 10분 CO2가 계속 오름
  const slope = co2 !== null && !stuck && !offline ? trendSlope(smooth) : null
  const unbooked = env.current === null && slope !== null && slope >= rules.unbookedRisePpmPerMin

  // 빈 방 문이 오래 열려 있음(사람이 있으면 환기라 괜찮다)
  const doorLeftOpen = !offline && door !== null && door.open && env.presence === 'EMPTY' && door.minutes >= rules.doorOpenEmptyMinutes

  // 입실 안 함: 예약이 시작됐는데 아무도 없음(노쇼 전에 미리 보여 준다)
  const startMs = env.current ? new Date(env.current.startAt).getTime() : null
  const noEntryMinutes = env.presence === 'EMPTY' && startMs !== null && endMs !== null && now.getTime() >= startMs && now.getTime() < endMs
    ? Math.floor((now.getTime() - startMs) / 60_000) : 0
  const noEntry = noEntryMinutes >= rules.noEntryWarnMinutes && heldFor(false)
  // 밤(운영 밖)에 문 열림: 사람이 있든 없든 바로
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Seoul', hour: '2-digit', hour12: false }).format(now)) % 24
  const night = rules.nightFromHour > rules.nightToHour
    ? hour >= rules.nightFromHour || hour < rules.nightToHour
    : hour >= rules.nightFromHour && hour < rules.nightToHour
  const nightDoor = !offline && door !== null && door.open && night

  // 빈 방 불 켜짐: 끝에서부터 불이 켜져 있고 사람이 없던 분을 센다.
  // 분마다 재실이 없으면(core가 아직 안 줌) 지금 재실로 대신한다(지금 비어 있으면 그동안도 비었다고 본다)
  // 조도 측정이 오래됐으면 지금 상태를 모르는 것으로 보고 경고하지 않는다(그래프는 그대로, 글에는 잰 시각을 붙인다)
  const lightStale = light !== null && !!env.lightAt && now.getTime() - Date.parse(env.lightAt) > LIGHT_STALE_MINUTES * 60_000
  let lightOnEmptyMinutes = 0
  if (light !== null && !lightStale && light >= rules.lightOnPct && env.presence === 'EMPTY') {
    for (let i = lights.length - 1; i >= 0; i--) {
      const l = lights[i]
      if (l === null || l < rules.lightOnPct || occupancy[i] === true) break
      lightOnEmptyMinutes++
    }
  }
  const lightLeftOn = !offline && lightOnEmptyMinutes >= rules.lightLeftOnMinutes

  const flags = { co2Soon, co2Over, hot, dry, overtime, unbooked, offline, stuck, doorLeftOpen, noEntry, nightDoor, lightLeftOn }
  const tone: Tone = offline || stuck ? 'off'
    : co2Soon || co2Over || overtime || unbooked || doorLeftOpen || noEntry || nightDoor || lightLeftOn ? 'warn' : 'ok'

  let status: RoomView['status']
  if (offline) status = { text: '신호 끊김', tone: 'off' }
  else if (stuck) status = { text: '센서 확인', tone: 'off' }
  else if (nightDoor) status = { text: '밤에 문 열림', tone: 'warn' }
  else if (overtime) status = { text: '시간 넘김', tone: 'warn' }
  else if (unbooked) status = { text: '예약 없이 사용?', tone: 'warn' }
  else if (doorLeftOpen) status = { text: '문 열림', tone: 'warn' }
  else if (noEntry) status = { text: '입실 안 함', tone: 'warn' }
  else if (lightLeftOn) status = { text: '빈 방 불 켜짐', tone: 'warn' }
  else if (env.presence === 'OCCUPIED') status = { text: '사용 중', tone: 'use' }
  else if (env.presence === 'EMPTY') status = { text: '비어 있음', tone: 'empty' }
  else status = { text: '재실 모름', tone: 'empty' }

  let slot: string
  if (env.current && (occupied || now.getTime() < (endMs ?? 0))) {
    slot = `${timeRange(env.current.startAt, env.current.endAt)} · 예약 ${env.current.people}명`
    if (overtime) slot += ` · #${env.current.reservationId}`
  } else if (env.next) slot = `다음 ${seoulClock(new Date(env.next.startAt))} (예약 ${env.next.people}명)`
  else if (env.current === undefined && env.next === undefined) slot = '예약 정보 없음'
  else slot = '다음 예약 없음'

  let co2Note: string
  if (co2 === null) co2Note = '센서 없음'
  else if (offline) co2Note = '신호가 끊겼어요'
  else if (stuck) co2Note = `${sameForMinutes}분째 값이 그대로`
  else if (co2OverRaw) co2Note = co2Over ? `기준 ${rules.co2LimitPpm} 넘음` : `기준 ${rules.co2LimitPpm} 넘음 · 빈 방이라 알림 안 함`
  else if (co2Soon) co2Note = `예측: ${etaMinutes}분 뒤 ${rules.co2LimitPpm} 넘음`
  else if (unbooked) co2Note = '예약이 없는데 오르는 중'
  else if (forecast.length) co2Note = `${rules.forecastMinutes}분 뒤 약 ${forecast[forecast.length - 1]}`
  else co2Note = '예측 없음'

  const tempNote = temperatureC === null ? '센서 없음' : hot ? '참고: 높은 편' : ''
  const humNote = humidityPct === null ? '센서 없음' : dry ? '참고: 낮은 편' : ''
  const lightState = light === null ? '센서 없음' : lightLeftOn ? `빈 방 ${lightOnEmptyMinutes}분째 불 켜짐`
    : light >= rules.lightOnPct ? '불 켜짐' : '불 꺼짐'
  const lightNote = lightStale ? `${seoulClock(new Date(env.lightAt as string))}에 잰 값 · ${lightState}` : lightState

  return {
    roomId: env.roomId,
    name: cfg?.name ?? env.roomName,
    sensors, co2, temperatureC, humidityPct, history, temps, hums, light, pir: env.pir?.detected ?? null, lights, occupancy, lightOnEmptyMinutes, doors, door, times, current: env.current ?? null,
    presence: env.presence, lastSignalAt: env.lastSignalAt, forecast, forecastFrom, etaMinutes, sameForMinutes,
    overtimeMinutes, noEntryMinutes, flags, tone, status, slot, nextAt: env.next?.startAt ?? null, co2Note, tempNote, humNote, lightNote,
  }
}
