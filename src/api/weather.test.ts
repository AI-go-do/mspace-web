import { describe, expect, it } from 'vitest'
import { alertOf, demoIndoorShiftC, GWANGJU_NORMAL_C, mockWeather, weatherLabel } from './weather'

describe('바깥 날씨', () => {
  const nov = new Date('2026-11-09T14:00:00+09:00')

  it('기상청 특보 기준을 흉내 낸다: 최저 -12°C 이하 한파, 최고 33°C 이상 폭염', () => {
    expect(alertOf(-12, -3)).toBe('COLD_WAVE')
    expect(alertOf(-11.9, -3)).toBeNull()
    expect(alertOf(25, 33)).toBe('HEAT_WAVE')
    expect(alertOf(25, 32.9)).toBeNull()
  })

  it('평년값으로 오늘 값을 만든다: 같은 시각은 같은 값, 새벽이 가장 춥고 오후가 가장 덥다', () => {
    const w = mockWeather(nov, null)
    expect(w).toEqual(mockWeather(nov, null))
    expect(w.normalC).toBe(GWANGJU_NORMAL_C[10])
    expect(w.alert).toBeNull()
    const dawn = mockWeather(new Date('2026-11-09T05:00:00+09:00'), null)
    const noon3 = mockWeather(new Date('2026-11-09T15:00:00+09:00'), null)
    expect(dawn.tempC).toBeLessThan(noon3.tempC)
    expect(dawn.tempC).toBeCloseTo(w.minC, 0)
  })

  it('시연 한파·폭염', () => {
    expect(mockWeather(nov, 'cold').alert).toBe('COLD_WAVE')
    expect(mockWeather(nov, 'hot').alert).toBe('HEAT_WAVE')
    expect(weatherLabel(mockWeather(nov, 'cold'))).toBe('바깥 -9.5°C · 한파')
    expect(weatherLabel(mockWeather(nov, null))).toMatch(/^바깥 .+°C · 평년 10°C$/)
    expect(demoIndoorShiftC('cold')).toBeLessThan(0)
    expect(demoIndoorShiftC(null)).toBe(0)
  })
})
