import { describe, expect, it } from 'vitest'
import { ADAPTIVE_RULES } from '../config/adminRooms'
import { adaptive, findSpikes } from './adaptiveBand'

const flat = (n: number, v: number, wobble = 0) => Array.from({ length: n }, (_, i) => v + (i % 2 ? wobble : -wobble))
const none = (n: number) => Array.from({ length: n }, () => null as boolean | null)

describe('튐 거르기', () => {
  it('앞뒤와 둘 다 크게 다르고 같은 쪽으로 혼자 뛴 값만 튐으로 본다', () => {
    expect(findSpikes([450, 452, 900, 451, 450], 150)).toEqual([false, false, true, false, false])
  })
  it('계단처럼 올라가 그대로 있는 값은 튐이 아니다', () => {
    expect(findSpikes([450, 450, 800, 805, 810], 150)).toEqual([false, false, false, false, false])
  })
  it('맨 끝 값은 다음 값이 와야 알 수 있어 튐으로 보지 않는다', () => {
    expect(findSpikes([450, 450, 900], 150)[2]).toBe(false)
  })
})

describe('자동 기준', () => {
  it('값이 모자라면 기준을 정하지 않는다(배우는 중)', () => {
    const r = adaptive('co2', flat(20, 450), none(20), null, ADAPTIVE_RULES)
    expect(r.band).toBeNull()
    expect(r.deviation).toBeNull()
  })

  it('가운데값 ± 최소 폭으로 선을 긋는다', () => {
    const r = adaptive('co2', flat(60, 450), none(60), null, ADAPTIVE_RULES)
    expect(r.band?.median).toBe(450)
    expect(r.band?.lo).toBe(350)
    expect(r.band?.hi).toBe(550)
  })

  it('선 밖에 5분 넘게 있으면 알리고, 몇 분 높은지 준다', () => {
    const values = [...flat(60, 450, 5), 700, 710, 720, 730, 740]
    const r = adaptive('co2', values, none(65), null, ADAPTIVE_RULES)
    expect(r.deviation).toEqual({ dir: 'high', diff: 290, minutes: 5 })
  })

  it('한 번 튄 값은 알리지 않는다', () => {
    const values = [...flat(60, 450, 5), 900, 450, 452]
    const r = adaptive('co2', values, none(63), null, ADAPTIVE_RULES)
    expect(r.spikes[60]).toBe(true)
    expect(r.deviation).toBeNull()
  })

  it('튄 값은 평소 값 계산에서 빠진다', () => {
    const values = flat(60, 450)
    values[10] = 2000; values[30] = 2000
    const r = adaptive('co2', values, none(60), null, ADAPTIVE_RULES)
    expect(r.band?.median).toBe(450)
  })

  it('사람이 있을 때와 없을 때를 따로 배운다', () => {
    // 빈 방 40분 450, 사람 있음 40분 800
    const values = [...flat(40, 450), ...flat(40, 800)]
    const occ = [...Array(40).fill(false), ...Array(40).fill(true)]
    const empty = adaptive('co2', values, occ, false, ADAPTIVE_RULES)
    const used = adaptive('co2', values, occ, true, ADAPTIVE_RULES)
    expect(empty.band?.basis).toBe('empty')
    expect(empty.band?.median).toBe(450)
    expect(used.band?.basis).toBe('occupied')
    expect(used.band?.median).toBe(800)
  })

  it('조도·습도 선은 0~100 밖으로 나가지 않는다', () => {
    const r = adaptive('light', flat(60, 5, 1), none(60), null, ADAPTIVE_RULES)
    expect(r.band?.lo).toBe(0)
  })

  it('낮은 쪽으로 오래 벗어나도 알린다', () => {
    const values = [...flat(60, 24, 0.1), 20, 20, 20, 20, 20, 20]
    const r = adaptive('temp', values, none(66), null, ADAPTIVE_RULES)
    expect(r.deviation?.dir).toBe('low')
    expect(r.deviation?.minutes).toBe(6)
  })
})
