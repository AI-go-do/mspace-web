import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import { _setWatchApiForTest, getMyWatches, unwatchRoom, watchApiOn, watchRoom } from './roomWatches'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('빈방 알림 core API (core #109)', () => {
  const store = new Map<string, string>()
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), memberId: 1 })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
    store.clear()
    _setWatchApiForTest(null)
  })
  const paths = () => fetchMock.mock.calls.map(([url, init]) => `${(init as RequestInit | undefined)?.method ?? 'GET'} ${new URL(String(url), 'http://x').pathname}`)

  it('api 빌드에서만 core에 보내고, 예시 화면(?demo=1)은 이 폰에만 둔다', () => {
    _setWatchApiForTest(true)
    expect(watchApiOn()).toBe(true)
    store.set('mspace:demo', '1')
    expect(watchApiOn()).toBe(false)
    store.clear()
    _setWatchApiForTest(false)
    expect(watchApiOn()).toBe(false)
  })
  it('목록·켜기·끄기는 core 주소로 가고, 켜기는 방 번호만 보낸다', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, [{ roomId: 2, since: '2026-11-09T20:00:00+09:00' }]))
      .mockResolvedValueOnce(json(200, { roomId: 3, since: '2026-11-09T20:01:00+09:00' }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    expect((await getMyWatches(1))[0].roomId).toBe(2)
    expect((await watchRoom(1, 3)).roomId).toBe(3)
    await unwatchRoom(1, 3)
    expect(paths()).toEqual(['GET /api/room-watches/me', 'POST /api/room-watches', 'POST /api/room-watches/3/cancel'])
    expect(JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body))).toEqual({ roomId: 3 })
  })
  it('지금 비어 있으면 ROOM_WATCH_FREE로 실패한다(화면은 켠 채로 둔다)', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { code: 'ROOM_WATCH_FREE', message: '지금 비어 있어요. 바로 예약해 주세요' }))
    await expect(watchRoom(1, 2)).rejects.toMatchObject({ code: 'ROOM_WATCH_FREE' })
  })
})
