import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, dropLegacyTokens, readTokens, saveTokens } from './tokens'

/** 테스트는 node 환경이라 브라우저 저장소를 흉내 낸다 */
class MemStorage {
  m = new Map<string, string>()
  getItem(k: string) { return this.m.get(k) ?? null }
  setItem(k: string, v: string) { this.m.set(k, String(v)) }
  removeItem(k: string) { this.m.delete(k) }
}

describe('토큰 보관 (FR-AUTH-002)', () => {
  let local: MemStorage
  let session: MemStorage
  beforeEach(() => {
    local = new MemStorage()
    session = new MemStorage()
    vi.stubGlobal('localStorage', local)
    vi.stubGlobal('sessionStorage', session)
  })
  afterEach(() => {
    clearTokens()
    vi.unstubAllGlobals()
  })

  it('액세스 토큰은 메모리에만 두고 브라우저 저장소에는 아무것도 쓰지 않는다', () => {
    saveTokens({ accessToken: 'a', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
    expect(readTokens()?.accessToken).toBe('a')
    expect(local.m.size).toBe(0)
    expect(session.m.size).toBe(0)
  })

  it('예전 버전이 남긴 저장소 토큰을 지운다', () => {
    local.setItem('mspace.tokens', '{"refreshToken":"old"}')
    session.setItem('mspace.tokens', '{"refreshToken":"old"}')
    local.setItem('mspace.lastEmail', 'a@chosun.ac.kr')
    dropLegacyTokens()
    expect(local.getItem('mspace.tokens')).toBeNull()
    expect(session.getItem('mspace.tokens')).toBeNull()
    expect(local.getItem('mspace.lastEmail')).toBe('a@chosun.ac.kr')
  })
})
