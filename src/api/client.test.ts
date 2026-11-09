import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, readTokens, saveTokens } from '../auth/tokens'
import { ApiError, REFRESH_TIMEOUT_MS, WRITE_TIMEOUT_MS, api, login, logout, onSessionEnd, refreshTokens } from './client'

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

  it('보낼 회원을 정했는데 refresh가 다른 회원 토큰을 주면 보내지 않는다', async () => {
    saveTokens({ accessToken: 'old', expiresAt: later(-1), memberId: 1 })
    fetchMock.mockImplementation(async (path: string) =>
      path === '/api/auth/refresh' ? json(200, { accessToken: 'other', expiresAt: later(60), memberId: 2 }) : json(200, { ok: true }))
    await expect(api('/api/agent/chat', { method: 'POST', body: '{}', member: 1 })).rejects.toMatchObject({ code: 'SESSION_CHANGED' })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/refresh'])
  })

  it('새로고침해서 메모리에 토큰이 없으면 먼저 쿠키로 refresh하고 보낸다', async () => {
    fetchMock.mockImplementation(async (path: string, init: RequestInit) => {
      if (path === '/api/auth/refresh') return json(200, { accessToken: 'fresh', expiresAt: later(60) })
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer fresh')
      return json(200, { ok: true })
    })
    await expect(api('/api/rooms')).resolves.toEqual({ ok: true })
  })

  it('로그아웃이 서버에서 실패하면(쿠키가 남음) 로그인을 끝내지 않고 오류를 던진다', async () => {
    saveTokens({ accessToken: 'a1', expiresAt: later(30) })
    const ended = vi.fn()
    const off = onSessionEnd(ended)
    fetchMock.mockResolvedValueOnce(json(500, { code: 'UNKNOWN', message: '서버 오류' }))
    await expect(logout()).rejects.toMatchObject({ status: 500 })
    expect(readTokens()?.accessToken).toBe('a1')
    expect(ended).not.toHaveBeenCalled()

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await logout()
    expect(readTokens()).toBeNull()
    expect(ended).toHaveBeenCalled()
    off()
  })

  it('앱을 열 때 시작한 refresh가 끝나기 전에는 로그인 요청을 보내지 않는다(쿠키 덮어쓰기 방지)', async () => {
    let answer: (r: Response) => void = () => {}
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/refresh') return new Promise<Response>((r) => { answer = r })
      return json(200, { accessToken: 'login', expiresAt: later(60), memberId: 1, newMember: false })
    })
    const pending = refreshTokens()
    const loggingIn = login('a@chosun.ac.kr', '123456', true)
    await new Promise((r) => setTimeout(r, 0))
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/refresh'])
    answer(json(401, { code: 'REFRESH_TOKEN_INVALID', message: '만료' }))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    await loggingIn
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual(['/api/auth/refresh', '/api/auth/login'])
    expect(readTokens()?.accessToken).toBe('login')
  })

  it('refresh가 기다리는 사이 로그아웃하면 늦게 온 결과로 다시 로그인되지 않는다', async () => {
    let answer: (r: Response) => void = () => {}
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/auth/refresh') return new Promise<Response>((r) => { answer = r })
      return new Response(null, { status: 204 })
    })
    const pending = refreshTokens()
    await logout()
    answer(json(200, { accessToken: 'stale', expiresAt: later(60) }))
    await expect(pending).rejects.toMatchObject({ status: 401 })
    expect(readTokens()).toBeNull()
  })

  it('요청이 기다리는 사이 다른 계정으로 로그인했으면 401을 새 토큰으로 다시 보내지 않는다', async () => {
    saveTokens({ accessToken: 'old-user', expiresAt: later(30) })
    let answer: (r: Response) => void = () => {}
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/reservations/1') return new Promise<Response>((r) => { answer = r })
      if (path === '/api/auth/logout') return new Response(null, { status: 204 })
      return json(200, { accessToken: 'new-user', expiresAt: later(60), memberId: 2, newMember: false })
    })
    const ended = vi.fn()
    const off = onSessionEnd(ended)
    const cancel = api('/api/reservations/1', { method: 'DELETE' })
    await new Promise((r) => setTimeout(r, 0))
    await logout()
    ended.mockClear()
    await login('b@chosun.ac.kr', '123456', true)
    answer(json(401, { code: 'UNAUTHORIZED', message: '만료' }))
    await expect(cancel).rejects.toMatchObject({ status: 401 })
    const paths = fetchMock.mock.calls.map((c) => c[0])
    expect(paths.filter((p) => p === '/api/reservations/1')).toHaveLength(1)
    expect(paths).not.toContain('/api/auth/refresh')
    expect(ended).not.toHaveBeenCalled()
    expect(readTokens()?.accessToken).toBe('new-user')
    off()
  })

  it('refresh가 응답 없이 멈추면 시간 제한 뒤 요청을 끊고, 기다리던 로그인이 진행된다', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockImplementation((path: string, init: RequestInit) => {
        if (path === '/api/auth/refresh')
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
        return Promise.resolve(json(200, { accessToken: 'login', expiresAt: later(60), memberId: 1, newMember: false }))
      })
      const pending = refreshTokens()
      const pendingErr = pending.catch((e) => e)
      const loggingIn = login('a@chosun.ac.kr', '123456', true)
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
      expect(await pendingErr).toMatchObject({ code: 'REFRESH_TIMEOUT' })
      await loggingIn
      const refreshInit = fetchMock.mock.calls[0][1] as RequestInit
      expect(refreshInit.signal?.aborted).toBe(true)
      expect(readTokens()?.accessToken).toBe('login')
    } finally {
      vi.useRealTimers()
    }
  })

  it('다른 탭이 refresh 잠금을 오래 쥐고 있어도 시간 제한 뒤 끝나고, 다음 refresh는 새로 시작한다', async () => {
    vi.useFakeTimers()
    // 잠금을 끝내 못 받는 브라우저 흉내: signal이 끊기면 AbortError로 실패
    const request = vi.fn((_name: string, opts: unknown, _fn?: unknown) => new Promise((_, reject) => {
      const signal = (opts as { signal?: AbortSignal }).signal
      signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    try {
      const first = refreshTokens().catch((e) => e)
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
      expect(await first).toMatchObject({ code: 'REFRESH_TIMEOUT' })
      expect(fetchMock).not.toHaveBeenCalled()
      const second = refreshTokens().catch((e) => e)
      expect(request).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(REFRESH_TIMEOUT_MS)
      await second
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })

  it('잠금을 오래 기다렸어도 refresh 요청은 자기 시간을 처음부터 다 쓴다', async () => {
    vi.useFakeTimers()
    // 9초 뒤에야 잠금을 받는 브라우저 흉내
    const request = vi.fn((_name: string, _opts: unknown, fn: () => Promise<unknown>) =>
      new Promise((resolve, reject) => setTimeout(() => fn().then(resolve, reject), 9_000)))
    vi.stubGlobal('navigator', { ...navigator, locks: { request } })
    // 요청은 잠금을 받은 뒤 5초 걸린다(합치면 14초 > 제한 10초)
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) =>
      setTimeout(() => resolve(json(200, { accessToken: 'slow', expiresAt: later(60), memberId: 1, newMember: false })), 5_000)))
    try {
      const pending = refreshTokens().catch((e) => e)
      await vi.advanceTimersByTimeAsync(14_000)
      expect(await pending).toMatchObject({ accessToken: 'slow' })
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
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

describe('연결 끊김·응답 늦음 (FR-WEB-006)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveTokens({ accessToken: 'a1', expiresAt: later(30) })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearTokens()
  })

  it('서버에 닿지 못하면 브라우저 영어 문구 대신 NETWORK와 한국어 안내를 던진다', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = (await api('/api/reservations', { method: 'POST', body: '{}' }).catch((e: unknown) => e)) as ApiError
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' })
    expect(err.message).not.toContain('fetch')
  })

  it('바꾸는 요청은 15초가 지나면 끊고 TIMEOUT을 던진다', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_p: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    const p = api('/api/reservations/1/checkout', { method: 'POST' }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    expect(await p).toMatchObject({ code: 'TIMEOUT' })
  })

  it('머리글은 왔는데 본문이 안 오면 15초에 끊고 TIMEOUT을 던진다', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation(async (_p: string, init: RequestInit) => ({
      ok: true, status: 200,
      json: () => new Promise((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }),
    }))
    const p = api('/api/reservations', { method: 'POST', body: '{}' }).catch((e) => e)
    await vi.advanceTimersByTimeAsync(WRITE_TIMEOUT_MS)
    expect(await p).toMatchObject({ code: 'TIMEOUT' })
  })

  it('조회(GET)와 부른 쪽이 시간을 정한 요청은 끊지 않는다', async () => {
    fetchMock.mockImplementation(async () => json(200, { ok: true }))
    await api('/api/reservations/me')
    const own = new AbortController()
    await api('/api/agent/chat', { method: 'POST', body: '{}', signal: own.signal })
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined()
    expect(fetchMock.mock.calls[1][1].signal).toBe(own.signal)
  })

  it('부른 쪽이 끊은 요청은 NETWORK로 바꾸지 않는다', async () => {
    const own = new AbortController()
    own.abort()
    fetchMock.mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const err = await api('/api/reservations/me', { signal: own.signal }).catch((e) => e)
    expect(err).not.toBeInstanceOf(ApiError)
  })
})
