import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, onMemberChange, saveTokens } from './tokens'

const tok = (memberId?: number) => ({ accessToken: 'a', expiresAt: '2099-01-01T00:00:00+09:00', memberId })

describe('onMemberChange', () => {
  afterEach(() => clearTokens())

  it('회원 번호가 바뀔 때만 알린다', () => {
    const fn = vi.fn()
    const stop = onMemberChange(fn)
    saveTokens(tok(1))
    saveTokens(tok(1)) // 같은 회원 토큰 갱신은 알리지 않는다
    saveTokens(tok(2))
    clearTokens()
    stop()
    saveTokens(tok(3))
    expect(fn).toHaveBeenCalledTimes(3)
  })
})
