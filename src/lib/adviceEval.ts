import type { RoomEnvironment } from '../api/environment'
import { ADMIN_ROOMS, ENV_RULES, type EnvRules } from '../config/adminRooms'
import { majorAdvice, roomAdvice, type Advice } from './roomAdvice'
import { toRoomView } from './roomHealth'

/**
 * 오디 판단 채점 (11/10 재웅 "기본부터 기준을 세워 다 맞는지 확인").
 * 정답이 정해진 방 상황(시나리오)마다 오디가 "나서야 할 일"과 "나서면 안 되는 일"을 적어 두고,
 * 규칙 숫자를 바꿀 때마다 같은 세트로 점수를 낸다. 한 번에 숫자 하나만 바꿔 비교한다
 */

export type Kind = 'co2Over' | 'co2Soon' | 'overtime' | 'noEntry' | 'offline' | 'stuck' | 'doorLeftOpen' | 'lightLeftOn' | 'unbooked' | 'nightDoor' | 'blockedOccupied' | 'reports'

/** 화면 문장에서 어떤 일인지 거꾸로 찾는다(roomAdvice가 kind를 따로 주지 않아서) */
export function kindOf(a: Advice): Kind | null {
  const t = a.title
  if (t.includes('신호가 끊겼')) return 'offline'
  if (t.includes('같은 값')) return 'stuck'
  if (t.includes('밤에 문이')) return 'nightDoor'
  if (t.includes('막아 둔 방')) return 'blockedOccupied'
  if (t.includes('판정 기다리는 신고')) return 'reports'
  if (t.includes('넘을 것 같아요')) return 'co2Soon'
  if (t.includes('기준') && t.includes('넘었어요')) return 'co2Over'
  if (t.includes('지났는데 사람이')) return 'overtime'
  if (t.includes('아무도 없어요')) return 'noEntry'
  if (t.includes('예약이 없는데')) return 'unbooked'
  if (t.includes('빈 방 문이')) return 'doorLeftOpen'
  if (t.includes('빈 방에 불이')) return 'lightLeftOn'
  return null
}

/** 학생에게 바로 불이익(경고)으로 이어지는 일. 잘못 나서면 심각 오류로 따로 센다 */
const PENALTY: Kind[] = ['overtime', 'noEntry']

export interface Scenario {
  id: string
  name: string
  env: (now: Date) => RoomEnvironment
  /** 이 시각 기준 (서울). 밤 시나리오 때문에 따로 둔다 */
  at: string
  /** 오디가 꼭 나서야 하는 일 */
  fire: Kind[]
  /** 오디가 나서면 안 되는 일 (fire에 없는 다른 일은 "헛나섬"으로 센다) */
  why: string
}

const DAY = '2026-11-10T14:00:00+09:00'
const NIGHT = '2026-11-10T23:30:00+09:00'

function base(now: Date, ppm: (minAgo: number) => number | null, extra: Partial<RoomEnvironment> = {}, n = 45): RoomEnvironment {
  const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
  const series = Array.from({ length: n }, (_, i) => ({ at: iso(n - 1 - i), ppm: ppm(n - 1 - i), temperatureC: 24, humidityPct: 45 }))
  const last = series[n - 1].ppm
  return {
    roomId: 1, roomName: '창작실 1', presence: 'OCCUPIED', lastSignalAt: iso(0), offline: false,
    co2: last === null ? null : { ppm: last, at: iso(0) }, temperatureC: 24, humidityPct: 45, series,
    current: null, next: null, ...extra,
  }
}
const ago = (now: Date, m: number) => new Date(now.getTime() - m * 60_000).toISOString()
const jitter = (m: number) => (m % 3) - 1
/** 지금 쓰는 예약: start분 전에 시작, end분 뒤에 끝 */
const booked = (now: Date, startAgo: number, endIn: number, id = 1001) => ({ reservationId: id, startAt: ago(now, startAgo), endAt: ago(now, -endIn), people: 4 })
/** 분마다 값(재실·조도)을 덧붙인다. f(minAgo) */
const perMin = (env: RoomEnvironment, f: (minAgo: number) => Partial<RoomEnvironment['series'][number]>): RoomEnvironment => {
  const n = env.series.length
  return { ...env, series: env.series.map((p, i) => ({ ...p, ...f(n - 1 - i) })) }
}

export const SCENARIOS: Scenario[] = [
  // 평소: 아무것도 하지 않아야 한다
  { id: 'S01', name: '사용 중, 공기 좋음', at: DAY, fire: [], why: '할 일 없음', env: (n) => base(n, (m) => 650 + jitter(m), { current: booked(n, 30, 60) }) },
  { id: 'S02', name: '빈 방, 예약 없음', at: DAY, fire: [], why: '할 일 없음', env: (n) => base(n, (m) => 480 + jitter(m), { presence: 'EMPTY' }) },
  { id: 'S03', name: '사용 중, 천천히 오르지만 한참 남음', at: DAY, fire: [], why: '15분 안에 안 넘음', env: (n) => base(n, (m) => 700 - m * 2, { current: booked(n, 30, 60) }) },
  { id: 'S04', name: '끝나기 직전, 아직 시간 안', at: DAY, fire: [], why: '끝나기 전은 시간 넘김 아님', env: (n) => base(n, (m) => 650 + jitter(m), { current: booked(n, 118, 2) }) },
  { id: 'S05', name: '끝나고 3분 남아 있음', at: DAY, fire: [], why: '짐 챙기는 시간(5분 안)', env: (n) => base(n, (m) => 650 + jitter(m), { current: booked(n, 123, -3) }) },
  { id: 'S06', name: '시작 3분, 아직 안 옴', at: DAY, fire: [], why: '5분 전엔 기다림', env: (n) => base(n, (m) => 480 + jitter(m), { presence: 'EMPTY', current: booked(n, 3, 117) }) },
  { id: 'S07', name: '사용 중 문 열고 환기', at: DAY, fire: [], why: '사람이 있으면 문 열림은 환기', env: (n) => ({ ...base(n, (m) => 700 + jitter(m), { current: booked(n, 30, 60) }), door: { open: true, since: ago(n, 20) } }) },
  { id: 'S08', name: '빈 방 문 5분 열림', at: DAY, fire: [], why: '10분 전엔 안 나섬', env: (n) => ({ ...base(n, (m) => 480 + jitter(m), { presence: 'EMPTY' }), door: { open: true, since: ago(n, 5) } }) },
  // CO2
  { id: 'C01', name: 'CO2 1050 계속', at: DAY, fire: ['co2Over'], why: '기준 넘음 → 방 사용자에게 환기', env: (n) => base(n, (m) => (m < 6 ? 1050 + jitter(m) : 950 - m * 2), { current: booked(n, 40, 60) }) },
  { id: 'C02', name: 'CO2 10분 뒤 넘을 기세', at: DAY, fire: ['co2Soon'], why: '넘기 전에 미리', env: (n) => base(n, (m) => 900 - m * 10, { current: booked(n, 40, 60) }) },
  { id: 'C03', name: 'CO2 한 번 튐(1180) 뒤 바로 정상', at: DAY, fire: [], why: '순간 튄 값(숨 한 번)에는 안 나섬', env: (n) => base(n, (m) => (m === 0 ? 1180 : 720 + jitter(m)), { current: booked(n, 40, 60) }) },
  { id: 'C04', name: 'CO2 1000 정확히 2분째', at: DAY, fire: ['co2Over'], why: '기준값 이상이 이어짐', env: (n) => base(n, (m) => (m < 3 ? 1000 : 960), { current: booked(n, 40, 60) }) },
  // 시간 넘김·입실
  { id: 'T01', name: '끝나고 9분 남아 있음', at: DAY, fire: ['overtime'], why: '5분 넘음 → 퇴실 안내', env: (n) => base(n, (m) => 650 + jitter(m), { current: booked(n, 129, -9) }) },
  { id: 'T02', name: '끝나고 20분 남아 있음', at: DAY, fire: ['overtime'], why: '경고 단계까지', env: (n) => base(n, (m) => 650 + jitter(m), { current: booked(n, 140, -20) }) },
  { id: 'T03', name: '끝나고 9분, 이미 나감', at: DAY, fire: [], why: '비었으면 시간 넘김 아님', env: (n) => base(n, (m) => 520 + jitter(m), { presence: 'EMPTY', current: booked(n, 129, -9) }) },
  { id: 'T04', name: '시작 7분, 아무도 없음', at: DAY, fire: ['noEntry'], why: '5분 넘음 → 대표자 알림', env: (n) => base(n, (m) => 480 + jitter(m), { presence: 'EMPTY', current: booked(n, 7, 113) }) },
  { id: 'T05', name: '시작 7분, 재실 모름(신호 끊김)', at: DAY, fire: ['offline'], why: '모르면 입실 안 함으로 몰지 않음', env: (n) => base(n, (m) => 480 + jitter(m), { presence: 'UNKNOWN', offline: true, lastSignalAt: ago(n, 12), current: booked(n, 7, 113) }) },
  // 장치
  { id: 'D01', name: '신호 끊김', at: DAY, fire: ['offline'], why: '장치 담당에게', env: (n) => base(n, (m) => 600 + jitter(m), { offline: true, presence: 'UNKNOWN', lastSignalAt: ago(n, 15) }) },
  { id: 'D02', name: 'CO2 30분째 같은 값', at: DAY, fire: ['stuck'], why: '센서 멈춤 의심', env: (n) => base(n, (m) => (m < 30 ? 612 : 600 + jitter(m)), { current: booked(n, 40, 60) }) },
  { id: 'D03', name: 'CO2 10분째 같은 값', at: DAY, fire: [], why: '20분 전엔 우연일 수 있음', env: (n) => base(n, (m) => (m < 10 ? 612 : 600 + jitter(m)), { current: booked(n, 40, 60) }) },
  // 빈 방
  { id: 'E01', name: '빈 방 문 15분 열림', at: DAY, fire: ['doorLeftOpen'], why: '마지막 대표자에게', env: (n) => ({ ...base(n, (m) => 480 + jitter(m), { presence: 'EMPTY' }), door: { open: true, since: ago(n, 15) } }) },
  { id: 'E02', name: '예약 없는데 CO2 오름', at: DAY, fire: ['unbooked'], why: '예약 없이 쓰는 사람', env: (n) => base(n, (m) => 700 - m * 6, { presence: 'OCCUPIED' }) },
  { id: 'E03', name: '밤 23:30 문 열림', at: NIGHT, fire: ['nightDoor', 'doorLeftOpen'], why: '밤엔 바로 + 빈 방 문', env: (n) => ({ ...base(n, (m) => 460 + jitter(m), { presence: 'EMPTY' }), door: { open: true, since: ago(n, 12) } }) },
  // 2차(11/10): 헷갈리기 쉬운 상황. 센서 한 번 깜빡임·빈 방·겹친 일
  { id: 'P01', name: '끝나고 9분, 재실이 방금 한 번 "있음"으로 깜빡', at: DAY, fire: [], why: '센서 한 번에 학생 경고로 몰지 않음', env: (n) => perMin(base(n, (m) => 520 + jitter(m), { current: booked(n, 129, -9) }), (m) => ({ occupied: m === 0 })) },
  { id: 'P02', name: '시작 7분, 계속 있다가 방금 한 번 "없음"으로 깜빡', at: DAY, fire: [], why: '있던 팀을 입실 안 함으로 몰지 않음', env: (n) => perMin(base(n, (m) => 700 + jitter(m), { presence: 'EMPTY', current: booked(n, 7, 113) }), (m) => ({ occupied: m !== 0 })) },
  { id: 'P03', name: '끝나고 9분, 재실이 계속 "있음"', at: DAY, fire: ['overtime'], why: '이어서 있으면 시간 넘김 맞음', env: (n) => perMin(base(n, (m) => 650 + jitter(m), { current: booked(n, 129, -9) }), () => ({ occupied: true })) },
  { id: 'C05', name: '방금 나간 빈 방, CO2 1050에서 내려가는 중', at: DAY, fire: [], why: '알릴 사람이 없음(다음 팀 전에 빠짐)', env: (n) => base(n, (m) => 1050 + m * 8 + jitter(m), { presence: 'EMPTY' }) },
  { id: 'T06', name: '끝나고 9분, 신호 끊김', at: DAY, fire: ['offline'], why: '모르면 시간 넘김으로 몰지 않음', env: (n) => base(n, (m) => 650 + jitter(m), { presence: 'UNKNOWN', offline: true, lastSignalAt: ago(n, 12), current: booked(n, 129, -9) }) },
  { id: 'N01', name: '예약 없는데 재실 "있음", CO2는 평평', at: DAY, fire: [], why: '재실만으로는 무단 사용으로 안 봄', env: (n) => base(n, (m) => 480 + jitter(m), { presence: 'OCCUPIED' }) },
  { id: 'L01', name: '빈 방 불 15분 켜짐', at: DAY, fire: ['lightLeftOn'], why: '기록·아침 보고', env: (n) => perMin(base(n, (m) => 480 + jitter(m), { presence: 'EMPTY', light: 800, lightAt: ago(n, 0) }), (m) => ({ light: m < 15 ? 800 : 100, occupied: m >= 15 && m < 40 })) },
  { id: 'L02', name: '빈 방 불 5분 켜짐', at: DAY, fire: [], why: '10분 전엔 안 나섬', env: (n) => perMin(base(n, (m) => 480 + jitter(m), { presence: 'EMPTY', light: 800, lightAt: ago(n, 0) }), (m) => ({ light: m < 5 ? 800 : 100, occupied: m >= 5 && m < 40 })) },
  { id: 'D04', name: '밤에 신호 끊김 + 문 열림 기록', at: NIGHT, fire: ['offline'], why: '끊긴 값으로는 문을 믿지 않음', env: (n) => ({ ...base(n, (m) => 460 + jitter(m), { presence: 'UNKNOWN', offline: true, lastSignalAt: ago(n, 15) }), door: { open: true, since: ago(n, 20) } }) },
]

export interface CaseResult { id: string; name: string; fire: Kind[]; got: Kind[]; missed: Kind[]; extra: Kind[]; severe: Kind[]; ok: boolean; why: string }
export interface EvalScore { cases: CaseResult[]; exact: number; recall: number; falseAlarms: number; severe: number; total: number }

/** 같은 시나리오 세트를 rules로 채점한다 */
export function runAdviceEval(rules: EnvRules = ENV_RULES, scenarios: Scenario[] = SCENARIOS): EvalScore {
  const cases = scenarios.map((s) => {
    const now = new Date(s.at)
    const v = toRoomView(s.env(now), ADMIN_ROOMS[0], now, rules)
    const got = [...new Set(majorAdvice(roomAdvice(v, now, {}, rules)).map(kindOf).filter((k): k is Kind => k !== null))]
    const missed = s.fire.filter((k) => !got.includes(k))
    const extra = got.filter((k) => !s.fire.includes(k))
    return { id: s.id, name: s.name, fire: s.fire, got, missed, extra, severe: extra.filter((k) => PENALTY.includes(k)), ok: missed.length === 0 && extra.length === 0, why: s.why }
  })
  const need = cases.reduce((n, c) => n + c.fire.length, 0)
  const hit = cases.reduce((n, c) => n + c.fire.length - c.missed.length, 0)
  return {
    cases,
    exact: cases.filter((c) => c.ok).length / cases.length,
    recall: need ? hit / need : 1,
    falseAlarms: cases.reduce((n, c) => n + c.extra.length, 0),
    severe: cases.reduce((n, c) => n + c.severe.length, 0),
    total: cases.length,
  }
}
