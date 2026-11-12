import { describe, expect, it } from 'vitest'
import { sparkPoints } from './sparkLive'

const T0 = Date.parse('2026-11-12T12:00:00Z')
const times = [0, 1, 2, 3].map((i) => new Date(T0 + i * 60_000).toISOString())
const tick = (sec: number, co2: number | null) => ({ t: T0 + sec * 1000, co2, temp: 22, hum: 40 })

describe('sparkPoints', () => {
  it('초 값이 2개 미만이면 분 기록 그래프 그대로(null)', () => {
    expect(sparkPoints(times, [500, 510, 520, 530], undefined, 'co2', T0 + 200_000)).toBeNull()
    expect(sparkPoints(times, [500, 510, 520, 530], [tick(150, 600)], 'co2', T0 + 200_000)).toBeNull()
  })

  it('초 값이 시작된 뒤의 분 기록은 초 값으로 갈음한다', () => {
    const pts = sparkPoints(times, [500, 510, 520, 530], [tick(150, 600), tick(151, 605)], 'co2', T0 + 200_000)!
    expect(pts.map((p) => p.v)).toEqual([500, 510, 520, 600, 605])
  })

  it('지난 10분보다 오래된 초 값과 값이 없는 초는 뺀다', () => {
    const pts = sparkPoints([], [], [tick(0, 500), tick(700, null), tick(800, 510), tick(801, 512)], 'co2', T0 + 900_000)!
    expect(pts.map((p) => p.v)).toEqual([510, 512])
  })

  it('조도는 초 값이 없어 분 기록 그대로', () => {
    expect(sparkPoints(times, [1, 2, 3, 4], [tick(1, 500), tick(2, 501)], 'light', T0 + 10_000)).toBeNull()
  })
})
