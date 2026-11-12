import { describe, expect, it } from 'vitest'
import { rangeOf } from './chartRange'

describe('방 칸 작은 그래프 범위', () => {
  it('값 둘레로 확대한다: CO2 520 안팎이면 기준 1000은 범위 밖', () => {
    const [lo, hi] = rangeOf('co2', [515, 520, 528, 531], 1000)
    expect(lo).toBeGreaterThanOrEqual(380)
    expect(hi - lo).toBeGreaterThanOrEqual(160)
    expect(hi).toBeLessThan(1000)
  })

  it('기준이 가까워지면 기준선이 보이게 넓힌다', () => {
    const [, hi] = rangeOf('co2', [880, 900, 930, 950], 1000)
    expect(hi).toBeGreaterThan(1000)
  })

  it('습도는 아래 기준이 가까우면 아래로 넓힌다', () => {
    const [lo] = rangeOf('hum', [33, 34, 35], 30)
    expect(lo).toBeLessThan(30)
  })

  it('조도는 늘 0~100', () => {
    expect(rangeOf('light', [10, 90], 50)).toEqual([0, 100])
  })
})
