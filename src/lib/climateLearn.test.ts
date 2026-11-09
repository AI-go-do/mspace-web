import { describe, expect, it } from 'vitest'
import type { ApplianceState } from '../api/appliances'
import type { RoomEnvironment } from '../api/environment'
import { MOCK_OFFS, MOCK_RUNS } from '../api/climateLearnData'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { CLIMATE_RULES } from '../config/appliances'
import { climateTips, roomTargets, type TipRules } from './climate'
import { learnAll, learnedPrecool, learnRoom, median, rateLabel, type ManualOff, type RunSample } from './climateLearn'
import { toRoomView } from './roomHealth'

const now = new Date('2026-11-09T14:00:00+09:00')
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
const off = (id: string): ApplianceState => ({ applianceId: id, power: 'OFF', changedAt: null, by: null })

/** 빈 방, 온도 temp, 다음 예약이 minutes분 뒤 */
function emptyRoom(roomId: number, temp: number, minutes: number) {
  const series = Array.from({ length: 30 }, (_, i) => ({ at: iso(29 - i), ppm: 500 + (i % 2), temperatureC: temp, humidityPct: 45 }))
  const env: RoomEnvironment = {
    roomId, roomName: `창작실 ${roomId}`, presence: 'EMPTY', lastSignalAt: iso(0), offline: false,
    co2: { ppm: 500, at: iso(0) }, temperatureC: temp, humidityPct: 45, series,
    current: null, next: { startAt: iso(-minutes), people: 4 },
  }
  return toRoomView(env, ADMIN_ROOMS.find((r) => r.roomId === roomId), now)
}

const runs = (roomId: number, mode: 'HEAT' | 'COOL', minPerC: number[]): RunSample[] =>
  minPerC.map((m) => ({ roomId, mode, fromC: mode === 'HEAT' ? 15 : 30, toC: mode === 'HEAT' ? 20 : 26, minutes: m * (mode === 'HEAT' ? 5 : 4) }))
const offs = (roomId: number, mode: 'HEAT' | 'COOL', temps: number[]): ManualOff[] =>
  temps.map((roomC) => ({ roomId, mode, roomC, at: iso(60) }))

describe('AI 학습: 데워지는·식는 속도', () => {
  it('가운데값을 써서 이상한 기록 하나에 흔들리지 않는다', () => {
    expect(median([8, 9, 60])).toBe(9)
    expect(learnRoom(1, runs(1, 'HEAT', [8, 9, 60]), []).HEAT.minutesPerC).toBe(9)
  })
  it('기록이 3개보다 적으면 배우지 않는다 (기본 규칙 그대로)', () => {
    expect(learnRoom(1, runs(1, 'HEAT', [8, 9]), []).HEAT.minutesPerC).toBeNull()
  })
  it('너무 짧거나 거꾸로 간 기록은 뺀다', () => {
    const bad: RunSample[] = [
      { roomId: 1, mode: 'HEAT', fromC: 15, toC: 20, minutes: 5 },
      { roomId: 1, mode: 'HEAT', fromC: 18, toC: 17, minutes: 30 },
    ]
    expect(learnRoom(1, [...bad, ...runs(1, 'HEAT', [8, 8])], []).HEAT.runs).toBe(2)
  })
  it('미리 켜기 = 목표까지 온도 차 × 1°C당 분 + 여유 10분, 15–120분 안', () => {
    const l = learnRoom(1, runs(1, 'HEAT', [9, 9, 9]), []).HEAT
    expect(learnedPrecool(l, 15, 20)).toBe(55)
    expect(learnedPrecool(l, 19.8, 20)).toBe(15)
    expect(learnedPrecool(learnRoom(5, runs(5, 'HEAT', [30, 30, 30]), []).HEAT, 10, 20)).toBe(120)
  })
  it('한파·폭염인 날은 1.3배 느리다고 본다', () => {
    const l = learnRoom(1, runs(1, 'HEAT', [9, 9, 9]), []).HEAT
    expect(learnedPrecool(l, 15, 20, 'COLD_WAVE')).toBe(Math.round(5 * 9 * 1.3 + 10))
  })
  it('"1°C에 약 9분" 같은 말로 보여 준다', () => {
    expect(rateLabel(9)).toBe('1°C에 약 9분')
    expect(rateLabel(8.5)).toBe('1°C에 약 8.5분')
    expect(rateLabel(16.2)).toBe('1°C에 약 16분')
  })
})

describe('AI 학습: 손으로 끈 온도로 목표 고치기', () => {
  it('난방을 20°C 전에 3번 넘게 끄면 그 가운데값에서 반 도 내림', () => {
    expect(learnRoom(2, [], offs(2, 'HEAT', [19.6, 19.8, 19.5, 19.9])).HEAT.targetC).toBe(19.5)
  })
  it('목표에 닿은 뒤 끈 것은 "일찍 끔"이 아니다', () => {
    expect(learnRoom(2, [], offs(2, 'HEAT', [20, 20.5, 21])).HEAT.targetC).toBeNull()
  })
  it('냉방을 26°C 전에 자주 끄면 목표를 올린다', () => {
    expect(learnRoom(4, [], offs(4, 'COOL', [26.6, 26.8, 26.7])).COOL.targetC).toBe(27)
  })
  it('아무리 일찍 꺼도 난방은 추움 기준 위·18°C 이상, 냉방은 더움 기준 아래에서만', () => {
    const l = learnAll([2], [], offs(2, 'HEAT', [16, 16.2, 16.1]))
    const rules: TipRules = { ...CLIMATE_RULES, learned: l }
    expect(roomTargets(rules, 2).heatTargetC).toBe(18.5)
    const winter: TipRules = { ...rules, coldC: 19 }
    expect(roomTargets(winter, 2).heatTargetC).toBe(19.5)
    const hot = learnAll([4], [], offs(4, 'COOL', [27.9, 28, 27.8]))
    expect(roomTargets({ ...CLIMATE_RULES, hotC: 27, learned: hot }, 4).coolTargetC).toBe(26.5)
  })
})

describe('AI 학습을 권유에 쓰기', () => {
  const learned = learnAll(ADMIN_ROOMS.map((r) => r.roomId), MOCK_RUNS, MOCK_OFFS)
  const rules: TipRules = { ...CLIMATE_RULES, learned }

  it('작은 방(1°C에 8분)은 40분 뒤 예약이면 아직 안 켠다. 큰 5번 방(16분)은 벌써 켠다', () => {
    // 15°C → 20°C: 1번 방 약 50분 전, 5번 방 약 90분 전
    expect(climateTips(emptyRoom(1, 15, 70), now, off, rules)).toEqual([])
    const big = climateTips(emptyRoom(5, 15, 70), now, off, rules)
    expect(big.map((t) => t.why)).toEqual(['heat'])
    expect(big[0].ai).toMatch(/이 방은 1°C에 약 \d+분\(지난 5번\) → \d+분 전부터 켜요/)
  })
  it('배운 게 없으면 예전처럼 60분 전부터 (규칙 그대로)', () => {
    expect(climateTips(emptyRoom(1, 15, 55), now, off).map((t) => t.why)).toEqual(['heat'])
    expect(climateTips(emptyRoom(1, 15, 70), now, off)).toEqual([])
  })
  it('2번 방은 학생들이 일찍 꺼서 난방 19.5°C로 켜고, 그 이유를 같이 보여 준다', () => {
    const tips = climateTips(emptyRoom(2, 15, 30), now, off, rules)
    expect(tips[0].command).toEqual({ power: 'ON', mode: 'HEAT', targetC: 19.5 })
    expect(tips[0].ai).toContain('19.7°C쯤에서 4번 꺼서 19.5°C로')
  })
  it('사람이 있으면 미리 켜기 설명은 빼고 목표 온도 이유만', () => {
    const v = { ...emptyRoom(2, 16, 30), presence: 'OCCUPIED' as const }
    const tips = climateTips(v, now, off, rules)
    expect(tips[0].ai).not.toContain('전부터')
    expect(tips[0].ai).toContain('19.5°C로')
  })
})
