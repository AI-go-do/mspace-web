import { ADMIN_ROOMS, type AdminRoomConfig, type SensorKind } from '../config/adminRooms'
import type { EnvPoint, RoomEnvironment, RoomsEnvironment } from './environment'
import { demoIndoorShiftC } from './weather'

/**
 * 관리자 "지금" 탭 가짜 값 (core API가 생기기 전 시연용). 학생 이름·번호는 없다.
 * 시각만으로 값이 정해져서(같은 시각 = 같은 값) 10초마다 다시 불러도 그래프가 튀지 않는다.
 * 90분마다 같은 장면이 되풀이된다:
 *  1번 CO2가 1분에 약 8ppm씩 올라 1000ppm을 넘었다가 환기로 내려감 · 2번 끝났는데 사람이 남음(시간 넘김)
 *  3번 빈 방이 점점 더워짐(다음 예약 전), 빈 방에 불이 켜진 채 남는 때가 있음 · 4번 CO2가 같은 값에 멈춤(센서 고장 의심)
 *  5번 앞 45분은 보통, 뒤 45분은 예약이 없는데 CO2가 오름(무단 사용 의심)
 * 2번은 지금 실제 장치처럼 재실·조도만 들어오고 CO2·온도·습도는 값이 없다(SCD40이 아직 안 붙음). "값 없음" 화면을 보려고 둔다
 * 조도는 우노 CDS 원시값(0~1023, 밝을수록 큼). 불 켜짐 약 550~650, 꺼짐 약 60~120
 */

const MIN = 60_000
const HALF_HOUR = 30 * MIN
const CYCLE = 90

/** 방·분마다 같은 값을 주는 흔들림 (-0.5 ~ 0.5) */
function wobble(roomId: number, minute: number, salt = 0): number {
  let h = (roomId * 374761393 + minute * 668265263 + salt * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296 - 0.5
}

interface Reading { ppm: number; temperatureC: number; humidityPct: number; doorOpen?: boolean; light: number }

/** 장면 번호(1~5, 그 밖은 보통 방)와 분(실수)으로 값 하나 */
function reading(scene: number, roomId: number, t: number): Reading {
  const phase = ((t % CYCLE) + CYCLE) % CYCLE
  const n = Math.floor(t)
  const jitter = (amp: number, salt: number) => wobble(roomId, n, salt) * amp
  switch (scene) {
    case 1: {
      // 55분 동안 오르고(560 → 약 1030) 그 뒤 창문을 열어 내려간다
      // 문을 열어 둔 13분 동안 CO2가 빠르게 내려간다
      const ppm = phase < 55 ? 560 + 8.5 * phase : Math.max(600, 1027 - 20 * (phase - 55))
      return { ppm: ppm + jitter(12, 1), temperatureC: 25 + 0.01 * phase + jitter(0.1, 2), humidityPct: 47 + jitter(2, 3), doorOpen: phase >= 55 && phase < 68, light: 640 + jitter(30, 4) }
    }
    case 2:
      return { ppm: 740 + 1.5 * (phase % 30) + jitter(12, 1), temperatureC: 24.1 + jitter(0.1, 2), humidityPct: 44 + jitter(2, 3), light: 575 + jitter(24, 4) }
    case 3:
      // 빈 방: CO2는 바깥 공기 수준, 온도는 해가 들어 점점 오른다
      // 빈 방인데 문이 열린 채로 남는 때가 있다(45분 중 35분)
      // 앞 사람이 불을 켜 둔 채 나가 20~70분 사이 빈 방에 불이 켜져 있다
      return { ppm: 478 + jitter(8, 1), temperatureC: 26.9 + 0.02 * phase + jitter(0.05, 2), humidityPct: 39 + jitter(2, 3), doorOpen: phase % 45 >= 10,
        light: phase >= 20 && phase < 70 ? 530 + jitter(20, 4) : 70 + jitter(12, 4) }
    case 4:
      // 센서가 멈춘 방: 값이 그대로
      return { ppm: 452, temperatureC: 22.6, humidityPct: 41, light: 95 + jitter(14, 4) }
    case 5:
      if (phase >= 45) return { ppm: 500 + 6 * (phase - 45) + jitter(8, 1), temperatureC: 24.2 + jitter(0.1, 2), humidityPct: 48 + jitter(2, 3), light: 610 + jitter(24, 4) }
      // 예약 칸이 시작되고 8분 동안은 아무도 없어 불이 꺼져 있다(아래 입실 안 함과 같은 때)
      return { ppm: 690 + 30 * Math.sin((phase / 45) * 2 * Math.PI) + jitter(12, 1), temperatureC: 24.8 + jitter(0.1, 2), humidityPct: 50 + jitter(2, 3),
        light: (((t % 30) + 30) % 30) >= 8 ? 600 + jitter(24, 4) : 75 + jitter(12, 4) }
    default:
      return { ppm: 690 + 40 * Math.sin((phase / CYCLE) * 2 * Math.PI) + jitter(12, 1), temperatureC: 24.8 + jitter(0.1, 2), humidityPct: 50 + jitter(2, 3), light: 600 + jitter(24, 4) }
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10

/** 그 시각(ms)에 사람이 있었는지. 아래 예약·재실과 같은 규칙으로 정한다 */
function occupiedAt(scene: number, ms: number): boolean {
  const phase = (((ms / MIN) % CYCLE) + CYCLE) % CYCLE
  const slot = Math.floor(ms / HALF_HOUR) * HALF_HOUR
  if (scene === 1 || scene === 2) return true
  if (scene === 3 || scene === 4) return false
  if (scene === 5 && phase >= 45) return true // 예약 없이 누가 들어와 있음
  return ms - slot >= 8 * MIN // 예약이 시작되고 8분 동안은 아무도 없다(입실 안 함)
}

function room(cfg: AdminRoomConfig, scene: number, now: Date, minutes: number, shiftC: number): RoomEnvironment {
  const has = (s: SensorKind) => cfg.sensors.includes(s)
  // 2번: SCD40이 아직 안 붙은 방(지금 실제와 같음). 센서 목록에는 있지만 값이 안 온다
  const noScd = scene === 2
  const nowMs = now.getTime()
  const tNow = nowMs / MIN
  const point = (ms: number): EnvPoint => {
    const r = reading(scene, cfg.roomId, ms / MIN)
    return {
      at: new Date(ms).toISOString(),
      ppm: has('co2') && !noScd ? Math.round(r.ppm) : null,
      temperatureC: has('temperature') && !noScd ? round1(r.temperatureC + shiftC) : null,
      humidityPct: has('humidity') && !noScd ? Math.round(r.humidityPct) : null,
      ...(has('door') ? { doorOpen: r.doorOpen ?? false } : {}),
      ...(has('light') ? { light: Math.max(0, Math.min(1023, Math.round(r.light))) } : {}),
      ...(has('presence') ? { occupied: occupiedAt(scene, ms) } : {}),
    }
  }
  // 1분 칸 값 + 마지막은 지금 값
  const lastMinute = Math.floor(tNow) * MIN
  const series: EnvPoint[] = []
  for (let i = minutes - 1; i >= 1; i--) series.push(point(lastMinute - i * MIN))
  series.push(point(nowMs))
  const live = series[series.length - 1]

  // 예약: 30분 칸 기준으로 지금 시각에 맞춰 만든다
  const slot = Math.floor(nowMs / HALF_HOUR) * HALF_HOUR
  const iso = (ms: number) => new Date(ms).toISOString()
  let current: RoomEnvironment['current'] = null
  let next: RoomEnvironment['next'] = null
  const occupied = occupiedAt(scene, nowMs)
  if (scene === 1) { current = { reservationId: 1041, startAt: iso(slot - HALF_HOUR), endAt: iso(slot + 3 * HALF_HOUR), people: 5 } }
  if (scene === 2) {
    // 6분 넘게 지난 30분 칸에서 끝난 예약에 사람이 남아 있다
    const end = Math.floor((nowMs - 6 * MIN) / HALF_HOUR) * HALF_HOUR
    current = { reservationId: 1042, startAt: iso(end - 3 * HALF_HOUR), endAt: iso(end), people: 3 }
  }
  if (scene === 3) next = { startAt: iso(slot + 2 * HALF_HOUR), people: 4 }
  const phase = (((nowMs / MIN) % CYCLE) + CYCLE) % CYCLE
  // 5번 뒤 45분은 예약 없이 누가 들어와 있다. 앞 45분은 예약이 있고 시작 8분 동안 아무도 없다(입실 안 함)
  if (scene >= 5 && !(scene === 5 && phase >= 45)) current = { reservationId: 1043, startAt: iso(slot), endAt: iso(slot + 4 * HALF_HOUR), people: 7 }

  return {
    roomId: cfg.roomId,
    roomName: cfg.name,
    presence: has('presence') ? (occupied ? 'OCCUPIED' : 'EMPTY') : 'UNKNOWN',
    lastSignalAt: iso(nowMs - 4_000),
    offline: false,
    co2: live.ppm === null ? null : { ppm: live.ppm, at: live.at },
    temperatureC: live.temperatureC ?? null,
    humidityPct: live.humidityPct ?? null,
    ...(has('light') ? { light: live.light ?? null } : {}),
    series,
    current,
    next,
    door: has('door') ? doorState(series) : undefined,
  }
}

/** 마지막 분부터 거꾸로 같은 문 상태가 이어진 처음 시각 */
function doorState(series: EnvPoint[]): RoomEnvironment['door'] {
  const last = series[series.length - 1]
  const open = last.doorOpen ?? false
  let i = series.length - 1
  while (i > 0 && (series[i - 1].doorOpen ?? false) === open) i--
  return { open, since: series[i].at }
}

/** shiftC: 시연 한파·폭염(?weather=cold|hot)일 때 실내 온도를 옮긴다 */
export function mockEnvironment(now: Date, minutes: number, rooms: readonly AdminRoomConfig[] = ADMIN_ROOMS, shiftC = demoIndoorShiftC()): RoomsEnvironment {
  return { now: now.toISOString(), rooms: rooms.map((cfg, i) => room(cfg, i + 1, now, Math.max(2, minutes), shiftC)) }
}
