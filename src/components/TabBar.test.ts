import { describe, expect, it } from 'vitest'
import { activeTabIndex } from './TabBar'

describe('아래 탭 바탕 위치', () => {
  it('홈은 정확히 / 일 때만 고른다', () => {
    expect(activeTabIndex('/')).toBe(0)
    expect(activeTabIndex('/rules')).toBe(-1)
  })
  it('하위 화면에서도 그 탭을 고른다', () => {
    expect(activeTabIndex('/me')).toBe(2)
    expect(activeTabIndex('/me/41')).toBe(2)
    expect(activeTabIndex('/assistant')).toBe(3)
  })
  it('이름만 비슷한 다른 경로는 고르지 않는다', () => {
    expect(activeTabIndex('/mention')).toBe(-1)
    expect(activeTabIndex('/alerts')).toBe(-1)
  })
})
