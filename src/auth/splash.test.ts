import { describe, expect, it } from 'vitest'
import { MIN_SPLASH_MS, splashLeftMs } from './Splash'

describe('자동 로그인 로딩 화면 최소 시간 (FR-AUTH-002)', () => {
  it('페이지를 연 직후 refresh가 끝나도 남은 시간만큼 로딩 화면을 더 보여 준다', () => {
    expect(splashLeftMs(100)).toBe(MIN_SPLASH_MS - 100)
  })

  it('이미 최소 시간이 지났으면(느린 와이파이) 더 기다리지 않는다', () => {
    expect(splashLeftMs(MIN_SPLASH_MS)).toBe(0)
    expect(splashLeftMs(5000)).toBe(0)
  })
})
