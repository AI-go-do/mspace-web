import { beforeEach, describe, expect, it } from 'vitest'
import { _resetAppealsForTest, demoWarnings, resetAppeals, sendAppeal, useWarnings } from './appeal'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const base = Date.parse('2026-11-08T22:00:00+09:00')

describe('벌점 해명 예시 저장소', () => {
  beforeEach(() => { store.clear(); _resetAppealsForTest() })

  it('예시 경고 3건은 서울 날짜 기준으로 만들고, 이름·학번이 없다', () => {
    const list = demoWarnings(base)
    expect(list.map((w) => w.id)).toEqual([-1, -2, -3])
    expect(list[0].startAt).toBe('2026-11-06T05:00:00.000Z') // 11/6 14:00 KST
    expect(list[0].appeal).toBeNull()
    expect(list[1].appeal?.status).toBe('SENT')
    expect(list[2].appeal?.status).toBe('ACCEPTED')
    expect(JSON.stringify(list)).not.toMatch(/\d{8,}/)
  })

  it('해명을 보내면 검토 중이 되고 탭 저장소에 남는다', () => {
    expect(sendAppeal(-1, '14:03에 QR을 세 번 찍었는데 문이 안 열렸어요', [0, 1])).toBeNull()
    const saved = JSON.parse(store.get('mspace:demo:appeals')!)
    expect(saved.appeals['-1'].status).toBe('SENT')
    expect(saved.appeals['-1'].evidence).toEqual([0, 1])
    // 다시 읽어도 그대로
    _resetAppealsForTest()
    expect(sendAppeal(-1, '한 번 더 보내 볼게요 열 자 넘게', [])).toBe('이미 해명을 보냈어요.')
  })

  it('보낼 수 없는 글은 저장하지 않는다', () => {
    expect(sendAppeal(-1, '짧아요', [])).toMatch(/10자/)
    expect(store.has('mspace:demo:appeals')).toBe(false)
    expect(sendAppeal(-9, '없는 경고에 해명을 보내 봐요', [])).toBe('이 경고를 찾지 못했어요.')
  })

  it('처음으로 되돌리면 보낸 해명이 사라진다', () => {
    sendAppeal(-1, '14:03에 QR을 세 번 찍었는데 문이 안 열렸어요', [0])
    resetAppeals()
    expect(JSON.parse(store.get('mspace:demo:appeals')!).appeals).toEqual({})
    expect(typeof useWarnings).toBe('function')
  })
})
