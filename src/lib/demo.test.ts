import { afterEach, describe, expect, it } from 'vitest'
import { demoOn, syncDemoFromUrl } from './demo'

/** 테스트용 sessionStorage (node에는 없다) */
const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

describe('예시 화면 켜기', () => {
  afterEach(() => store.clear())

  it('주소에 demo가 없으면 꺼져 있다(보통 학생 화면)', () => {
    syncDemoFromUrl('?room=3')
    expect(demoOn()).toBe(false)
  })
  it('?demo=1로 켜고 ?demo=0으로 끈다', () => {
    syncDemoFromUrl('?demo=1')
    expect(demoOn()).toBe(true)
    // 다른 화면으로 옮겨 demo가 주소에서 빠져도 이 탭에서는 켜진 채로 둔다
    syncDemoFromUrl('')
    expect(demoOn()).toBe(true)
    syncDemoFromUrl('?demo=0')
    expect(demoOn()).toBe(false)
  })
})
