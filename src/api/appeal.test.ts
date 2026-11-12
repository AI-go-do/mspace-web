import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetAppealsForTest, DEMO_REVIEW_MS, demoWarnings, resetAppeals, sendAppeal, useWarnings } from './appeal'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const base = Date.parse('2026-11-08T22:00:00+09:00')

describe('경고 철회 요청 예시 저장소', () => {
  beforeEach(() => { store.clear(); _resetAppealsForTest(() => 7) })
  afterEach(() => { vi.useRealTimers() })

  it('예시 경고 3건은 서울 날짜 기준으로 만들고, 이름·학번이 없고, 노쇼가 아니라 경고(AI가 준)다', () => {
    const list = demoWarnings(base)
    expect(list.map((w) => w.id)).toEqual([-1, -2, -3])
    expect(list[0].startAt).toBe('2026-11-06T05:00:00.000Z') // 11/6 14:00 KST
    expect(list[0].appeal).toBeNull()
    expect(list[1].appeal?.status).toBe('SENT')
    expect(list[2].appeal?.status).toBe('ACCEPTED')
    expect(JSON.stringify(list)).not.toMatch(/\d{8,}/)
    expect(list.every((w) => w.kind !== 'NO_SHOW' && w.reservationId === null)).toBe(true)
    expect(list.flatMap((w) => w.evidence.map((e) => e.source))).not.toContain('관리자')
    expect(list[2].appeal?.confidence).toBeGreaterThan(0.8)
  })

  it('철회 요청을 보내면 AI가 다시 보는 중이 되고 탭 저장소에 남는다', () => {
    expect(sendAppeal(-1, '14:03에 QR을 세 번 찍었는데 문이 안 열렸어요', [0, 1])).toBeNull()
    const saved = JSON.parse(store.get('mspace:demo:appeals:7')!)
    expect(saved.appeals['-1'].status).toBe('SENT')
    expect(saved.appeals['-1'].evidence).toEqual([0, 1])
    // 다시 읽어도 그대로
    _resetAppealsForTest(() => 7)
    expect(sendAppeal(-1, '한 번 더 보내 볼게요 열 자 넘게', [])).toBe('이미 철회 요청을 보냈어요.')
  })

  it('보낼 수 없는 글은 저장하지 않는다', () => {
    expect(sendAppeal(-1, '짧아요', [])).toMatch(/10자/)
    expect(store.has('mspace:demo:appeals:7')).toBe(false)
    expect(sendAppeal(-9, '없는 경고에 요청을 보내 봐요', [])).toBe('이 경고를 찾지 못했어요.')
  })

  it('처음으로 되돌리면 보낸 요청이 사라진다', () => {
    sendAppeal(-1, '14:03에 QR을 세 번 찍었는데 문이 안 열렸어요', [0])
    resetAppeals()
    expect(JSON.parse(store.get('mspace:demo:appeals:7')!).appeals).toEqual({})
    expect(typeof useWarnings).toBe('function')
  })
  it('다른 계정으로 바꾸면 앞 사람이 보낸 요청이 보이지 않고, 돌아오면 다시 보인다', () => {
    let me: number | null = 7
    _resetAppealsForTest(() => me)
    sendAppeal(-1, '14:03에 QR을 세 번 찍었는데 문이 안 열렸어요', [0])
    me = 8
    expect(sendAppeal(-1, '저는 이 경고를 처음 요청해요 열 자 넘게', [])).toBeNull()
    expect(JSON.parse(store.get('mspace:demo:appeals:8')!).appeals['-1'].text).toContain('처음 요청')
    me = 7
    expect(JSON.parse(store.get('mspace:demo:appeals:7')!).appeals['-1'].text).toContain('QR을 세 번')
    expect(sendAppeal(-1, '한 번 더 보내 볼게요 열 자 넘게', [])).toBe('이미 철회 요청을 보냈어요.')
  })

  it('보낸 뒤 조금 지나면 예시 AI 판단이 붙는다: 유리한 기록을 같이 보내면 철회', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T22:00:00+09:00'))
    _resetAppealsForTest(() => 7)
    expect(sendAppeal(-1, '들어올 때 이미 컵이 있었어요. 입실 사진을 봐 주세요', [0])).toBeNull()
    vi.advanceTimersByTime(DEMO_REVIEW_MS + 100)
    _resetAppealsForTest(() => 7)
    const settled = demoWarnings(Date.now(), JSON.parse(store.get('mspace:demo:appeals:7')!).appeals)
    expect(settled[0].appeal?.status).toBe('ACCEPTED')
    expect(settled[0].appeal?.answer).toContain('입실 사진')
  })

  it('유리한 기록 없이 보내면 예시 AI 판단은 경고 유지', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-08T22:00:00+09:00'))
    _resetAppealsForTest(() => 7)
    expect(sendAppeal(-1, '제가 어지른 게 아니에요. 다시 봐 주세요', [1])).toBeNull()
    vi.advanceTimersByTime(DEMO_REVIEW_MS + 100)
    expect(JSON.parse(store.get('mspace:demo:appeals:7')!).appeals['-1'].status).toBe('REJECTED')
  })
})
