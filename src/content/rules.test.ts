import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let member: number | null = null
vi.mock('../api/client', () => ({ currentMemberId: () => member }))

const { hasAgreed, saveAgreed } = await import('./rules')

describe('수칙 동의는 회원마다 따로', () => {
  beforeEach(() => {
    const store = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    })
    member = null
  })
  afterEach(() => vi.unstubAllGlobals())

  it('로그인 전에는 동의하지 않은 것으로 본다', () => {
    saveAgreed()
    expect(hasAgreed()).toBe(false)
  })

  it('A가 동의해도 같은 브라우저의 B에게는 다시 묻는다', () => {
    member = 1
    saveAgreed()
    expect(hasAgreed()).toBe(true)
    member = 2
    expect(hasAgreed()).toBe(false)
    member = 1
    expect(hasAgreed()).toBe(true)
  })
})
