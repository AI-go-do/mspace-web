import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, readTokens, saveTokens } from './tokens'

const t = (id: string) => ({ accessToken: `a-${id}`, expiresAt: new Date(Date.now() + 3_600_000).toISOString(), refreshToken: `r-${id}` })
const KEY = 'mspace.tokens'

/** 테스트는 node 환경이라 브라우저 저장소를 흉내 낸다 */
class MemStorage {
  private m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

describe('토큰 보관 (FR-AUTH-002)', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', new MemStorage())
    vi.stubGlobal('sessionStorage', new MemStorage())
  })
  afterEach(() => {
    clearTokens()
    vi.unstubAllGlobals()
  })

  it('임시 로그인 탭은 다른 탭이 localStorage에 쓴 토큰보다 자기 sessionStorage 토큰을 먼저 쓴다', () => {
    saveTokens(t('A'), false)
    localStorage.setItem(KEY, JSON.stringify(t('B'))) // 다른 탭이 자동 로그인
    expect(readTokens()?.accessToken).toBe('a-A')
  })

  it('임시 로그인 탭의 refresh는 다른 탭의 자동 로그인 토큰을 지우지 않는다', () => {
    saveTokens(t('A'), false)
    localStorage.setItem(KEY, JSON.stringify(t('B')))
    saveTokens(t('A2')) // refresh: 기본값은 지금 저장된 곳(sessionStorage)
    expect(sessionStorage.getItem(KEY)).toContain('a-A2')
    expect(localStorage.getItem(KEY)).toContain('a-B')
  })

  it('자동 로그인 → 임시 로그인으로 바꾸면 localStorage 토큰을 지운다', () => {
    saveTokens(t('A'), true)
    saveTokens(t('A2'), false)
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(readTokens()?.accessToken).toBe('a-A2')
  })

  it('임시 로그인 → 자동 로그인으로 바꾸면 sessionStorage 토큰을 지운다', () => {
    saveTokens(t('A'), false)
    saveTokens(t('A2'), true)
    expect(sessionStorage.getItem(KEY)).toBeNull()
    expect(localStorage.getItem(KEY)).toContain('a-A2')
  })
})
