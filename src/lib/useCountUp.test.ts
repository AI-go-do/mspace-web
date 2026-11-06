import { describe, expect, it } from 'vitest'
import { easeOutCubic } from './useCountUp'

describe('세어 올라가는 곡선', () => {
  it('처음은 0, 끝은 1이고 범위 밖은 자른다', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBe(1)
    expect(easeOutCubic(-1)).toBe(0)
    expect(easeOutCubic(2)).toBe(1)
  })
  it('앞쪽에서 빨리 오른다', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
  })
})
