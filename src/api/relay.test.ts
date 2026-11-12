import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import {
  _setRelayApiForTest, addWait, cancelWait, countdown, declineOffer, DEMO_HOLD_MS, DEMO_OFFER_AFTER_MS, demoAddWait, demoOffers, demoWaits,
  finishDemoOffer, getMyOffers, getMyWaits, isDemoOffer, offerPick, openOfferSlots, relayOn, takenRunEnd,
} from './relay'
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

describe('빈방 릴레이 core API (core #101)', () => {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    _setRelayApiForTest(true)
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), memberId: 1 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
    store.clear()
    _setRelayApiForTest(null)
  })
  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i] as [string, RequestInit]
    return { url, method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined }
  }

  it('api로 빌드하면 보통 학생 화면에도 보이고, 서버 번호는 예시로 보지 않는다', () => {
    expect(relayOn()).toBe(true)
    expect(isDemoOffer(-1)).toBe(false)
  })
  it('기다리기 걸기는 방·칸 시작만 보낸다(놓일 구간 흉내는 보내지 않음)', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { id: 3, roomId: 2, startAt: '2026-11-10T14:00:00+09:00', order: 1 }))
    const w = await addWait(1, 2, '2026-11-10T14:00:00+09:00', '2026-11-10T16:00:00+09:00')
    expect(w).toEqual({ id: 3, roomId: 2, startAt: '2026-11-10T14:00:00+09:00', order: 1 })
    expect(call()).toMatchObject({ method: 'POST', body: { roomId: 2, startAt: '2026-11-10T14:00:00+09:00' } })
    expect(call().url).toContain('/api/relay/waits')
    // 예시 저장소에는 아무것도 남지 않는다
    expect(store.size).toBe(0)
  })
  it('목록·그만두기·넘길게요는 core 주소로 간다', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, [{ id: 3, roomId: 2, startAt: '2026-11-10T14:00:00+09:00', order: 2 }]))
      .mockResolvedValueOnce(json(200, [{ id: 7, roomId: 2, startAt: '2026-11-10T14:00:00+09:00', endAt: '2026-11-10T15:00:00+09:00', expiresAt: '2026-11-10T13:05:00+09:00', order: 1 }]))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await getMyWaits(1))[0].order).toBe(2)
    expect((await getMyOffers(1))[0].id).toBe(7)
    await cancelWait(1, 3)
    await declineOffer(1, 7)
    expect(fetchMock.mock.calls.map((_, i) => `${call(i).method} ${new URL(call(i).url, 'http://x').pathname}`)).toEqual([
      'GET /api/relay/waits/me', 'GET /api/relay/offers/me', 'POST /api/relay/waits/3/cancel', 'POST /api/relay/offers/7/decline',
    ])
  })
  it('기다리기 3개 넘음 같은 서버 거절은 메시지와 함께 그대로 실패한다', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { code: 'RELAY_WAIT_LIMIT', message: '기다리기는 한 사람당 동시에 3개까지예요' }))
    await expect(addWait(1, 2, '2026-11-10T14:00:00+09:00', '')).rejects.toThrow('3개까지')
  })
  it('예시 화면(?demo=1)은 api 빌드에서도 예시를 쓴다', async () => {
    store.set('mspace:demo', '1')
    const w = await addWait(1, 2, '2026-11-10T14:00:00+09:00', '2026-11-10T15:00:00+09:00')
    expect(w.id).toBeLessThan(0)
    expect(isDemoOffer(w.id)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('릴레이를 쓰지 않는 빌드', () => {
  afterEach(() => { store.clear(); _setRelayApiForTest(null) })
  it('보통 화면에서는 숨기고, ?demo=1에서만 보인다', () => {
    _setRelayApiForTest(false)
    expect(relayOn()).toBe(false)
    store.set('mspace:demo', '1')
    expect(relayOn()).toBe(true)
  })
})
