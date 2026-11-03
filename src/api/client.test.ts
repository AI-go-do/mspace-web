import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, readTokens, saveTokens } from '../auth/tokens'
import { api, onSessionEnd } from './client'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const later = (min: number) => new Date(Date.now() + min * 60_000).toISOString()

describe('api 자동 로그인 (FR-AUTH-002)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
  })

  it('액세스 토큰이 끝났으면 동시에 여러 요청이 와도 refresh는 한 번만 부른다', async () => {
    saveTokens({ accessToken: 'old', expiresAt: later(-1) })
    fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/refresh') {
        return json(200, { accessToken: 'new', expiresAt: later(60) })
      }
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer new')
      return json(200, { ok: true })
    })

    await Promise.all([api('/api/a'), api('/api/b'), api('/api/c')])

    const refreshCalls = fetchMock.mock.calls.filter(([p]) => p === '/api/auth/refresh')
    expect(refreshCalls).toHaveLength(1)
    // refresh 토큰은 쿠키로 가서 본문이 없다
    expect(refreshCalls[0][1].body).toBeUndefined()
    expect(readTokens()?.accessToken).toBe('new')
  })

  it('서버가 401을 주면 새 토큰을 받아 한 번 다시 보낸다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(30) })
    let first = true
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/refresh') return json(200, { accessToken: 'a2', expiresAt: later(60) })
      if (first) {
        first = false
        return json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다' })
      }
      return json(200, [1])
    })
    await expect(api('/api/reservations/me')).resolves.toEqual([1])
  })

  it('refresh가 401이면 토큰을 지우고 로그인 끝을 알린다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(-1) })
    const ended = vi.fn()
    const off = onSessionEnd(ended)
    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/auth/refresh'
        ? json(401, { code: 'REFRESH_TOKEN_INVALID', message: '로그인이 만료되었습니다' })
        : json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다' }),
    )
    await expect(api('/api/reservations/me')).rejects.toMatchObject({ status: 401 })
    expect(readTokens()).toBeNull()
    expect(ended).toHaveBeenCalled()
    off()
  })

  it('refresh가 500이면(배포 중 등) 토큰을 지우지 않고 오류만 던진다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(-1) })
    const ended = vi.fn()
    const off = onSessionEnd(ended)
    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/auth/refresh' ? new Response('Bad Gateway', { status: 502 }) : json(200, {}),
    )
    await expect(api('/api/reservations/me')).rejects.toMatchObject({ status: 502 })
    expect(readTokens()?.accessToken).toBe('a1')
    expect(ended).not.toHaveBeenCalled()
    expect(fetchMock.mock.calls.filter(([p]) => p === '/api/reservations/me')).toHaveLength(0)
    off()
  })

  it('401 뒤 다시 받기에서 500이 나도 로그아웃하지 않는다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(30) })
    const ended = vi.fn()
    const off = onSessionEnd(ended)
    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/auth/refresh'
        ? json(500, { code: 'UNKNOWN', message: '서버 오류' })
        : json(401, { code: 'UNAUTHORIZED', message: '로그인이 필요합니다' }),
    )
    await expect(api('/api/reservations/me')).rejects.toMatchObject({ status: 500 })
    expect(readTokens()).not.toBeNull()
    expect(ended).not.toHaveBeenCalled()
    off()
  })

  it('새로고침해서 메모리에 토큰이 없으면 먼저 쿠키로 refresh하고 보낸다', async () => {
    fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/refresh') return json(200, { accessToken: 'fresh', expiresAt: later(60) })
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fresh')
      return json(200, { ok: true })
    })
    await expect(api('/api/rooms')).resolves.toEqual({ ok: true })
  })

  it('오류는 서버의 code·message를 그대로 던진다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(30) })
    fetchMock.mockResolvedValue(json(409, { code: 'RESERVATION_TIME_TAKEN', message: '이미 예약된 시간입니다' }))
    await expect(api('/api/reservations', { method: 'POST', body: '{}' })).rejects.toMatchObject({
      status: 409,
      code: 'RESERVATION_TIME_TAKEN',
      message: '이미 예약된 시간입니다',
    })
  })
})
