import { afterEach, describe, expect, it } from 'vitest'
import { countdown, DEMO_HOLD_MS, DEMO_OFFER_AFTER_MS, demoAddWait, demoOffers, demoWaits, finishDemoOffer, offerPick, openOfferSlots, takenRunEnd } from './relay'
import type { Slot } from './rooms'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const day0 = Date.parse('2026-11-10T00:00:00+09:00')
/** 하루 48칸, taken은 예약된 칸 번호 */
const slots = (taken: number[]): Slot[] => Array.from({ length: 48 }, (_, i) => ({
  startAt: new Date(day0 + i * 1_800_000).toISOString(),
  endAt: new Date(day0 + (i + 1) * 1_800_000).toISOString(),
  available: !taken.includes(i),
}))

describe('넘겨받은 칸 (Q-18)', () => {
  const offer = { startAt: '2026-11-10T14:00:00+09:00', endAt: '2026-11-10T16:00:00+09:00' }

  it('예약 화면이 골라 둘 날짜·칸으로 바꾼다(서울 날짜 기준)', () => {
    expect(offerPick(offer)).toEqual({ date: '2026-11-10', start: 28, len: 4 })
    // 자정 넘김 예약(23:00–01:00)은 시작 날짜에서 고른다
    expect(offerPick({ startAt: '2026-11-10T23:00:00+09:00', endAt: '2026-11-11T01:00:00+09:00' })).toEqual({ date: '2026-11-10', start: 46, len: 4 })
  })
  it('넘겨받은 사람에게만 그 구간을 빈 칸으로 보여 준다(다른 예약 칸은 그대로)', () => {
    const opened = openOfferSlots(slots([28, 29, 30, 31, 32]), offer)
    expect(opened.slice(28, 33).map((s) => s.available)).toEqual([true, true, true, true, false])
    expect(openOfferSlots(slots([28]), null)[28].available).toBe(false)
  })
  it('예시에서 놓일 구간은 눌린 칸부터 이어진 예약 칸(최대 2시간)', () => {
    const s = slots([28, 29, 30, 31, 32, 33])
    expect(takenRunEnd(s, 28)).toBe(s[31].endAt)
    expect(takenRunEnd(slots([28, 29]), 28)).toBe(s[29].endAt)
  })
  it('남은 받을 시간은 분:초, 지나면 0:00', () => {
    expect(countdown(4 * 60_000 + 52_000)).toBe('4:52')
    expect(countdown(-5)).toBe('0:00')
  })
})

describe('예시 릴레이 (?demo=1)', () => {
  afterEach(() => store.clear())
  const t0 = Date.parse('2026-11-10T10:00:00+09:00')
  const start = '2026-11-10T14:00:00+09:00'

  it('기다리기 → 20초 뒤 나에게 넘어옴 → 5분 지나면 사라진다', () => {
    const w = demoAddWait(1, 3, start, '2026-11-10T16:00:00+09:00', t0)
    expect(w.id).toBeLessThan(0)
    expect(demoWaits(1, t0 + 1000)).toHaveLength(1)
    expect(demoOffers(1, t0 + 1000)).toHaveLength(0)
    const [o] = demoOffers(1, t0 + DEMO_OFFER_AFTER_MS)
    expect(o).toMatchObject({ roomId: 3, startAt: start, endAt: '2026-11-10T16:00:00+09:00' })
    expect(Date.parse(o.expiresAt)).toBe(t0 + DEMO_OFFER_AFTER_MS + DEMO_HOLD_MS)
    expect(demoWaits(1, t0 + DEMO_OFFER_AFTER_MS)).toHaveLength(0)
    expect(demoOffers(1, t0 + DEMO_OFFER_AFTER_MS + DEMO_HOLD_MS)).toHaveLength(0)
  })
  it('같은 칸을 두 번 걸어도 하나, 다른 회원 목록과 섞이지 않는다', () => {
    const a = demoAddWait(1, 3, start, start, t0)
    expect(demoAddWait(1, 3, start, start, t0).id).toBe(a.id)
    expect(demoWaits(2, t0)).toHaveLength(0)
  })
  it('받거나 넘기면 목록에서 빠진다', () => {
    const a = demoAddWait(1, 3, start, start, t0)
    finishDemoOffer(1, a.id)
    expect(demoOffers(1, t0 + DEMO_OFFER_AFTER_MS)).toHaveLength(0)
  })
})
