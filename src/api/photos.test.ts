import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import { ApiError } from './client'
import { photoErrorMessage, UPLOAD_TIMEOUT_MS, uploadPhoto } from './photos'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('입실·퇴실 사진 (FR-RPT-102)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
  })

  it('kind와 file을 multipart로 보내고 JSON 머리글은 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(json(201, { reservationId: 12, kind: 'CHECK_IN', uploadedAt: 'x', sizeBytes: 3 }))
    const res = await uploadPhoto(12, 'CHECK_IN', new Blob([new Uint8Array(3)], { type: 'image/jpeg' }))
    const [path, init] = fetchMock.mock.calls[0]
    expect([path, init.method]).toEqual(['/api/reservations/12/photos', 'POST'])
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('kind')).toBe('CHECK_IN')
    expect((init.body as FormData).get('file')).toBeInstanceOf(Blob)
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
    expect(res.sizeBytes).toBe(3)
  })

  it('오류 코드를 쉬운 문장으로 바꾼다', () => {
    const err = (status: number, code: string) => new ApiError(status, code, '서버 문장')
    expect(photoErrorMessage(err(409, 'PHOTO_NOT_ALLOWED_NOW'), 'CHECK_IN')).toContain('사용 중일 때만')
    expect(photoErrorMessage(err(409, 'PHOTO_NOT_ALLOWED_NOW'), 'CHECK_OUT')).toContain('30분')
    expect(photoErrorMessage(err(400, 'PHOTO_TOO_LARGE'), 'CHECK_IN')).toContain('너무 커요')
    expect(photoErrorMessage(err(413, ''), 'CHECK_OUT')).toContain('너무 커요')
    expect(photoErrorMessage(err(400, 'SOMETHING_NEW'), 'CHECK_IN')).toBe('서버 문장')
    expect(photoErrorMessage(new TypeError('fetch failed'), 'CHECK_IN')).toContain('연결')
  })
})

describe('사진 올리기 시간 제한', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearTokens()
  })

  it('응답이 오지 않으면 30초 뒤 끊어서 다시 시도할 수 있게 한다', async () => {
    vi.useFakeTimers()
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
    vi.stubGlobal('fetch', vi.fn((_p: string, init: RequestInit) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    })))
    const pending = uploadPhoto(12, 'CHECK_OUT', new Blob([new Uint8Array(3)]))
    const caught = pending.catch((e) => e)
    await vi.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS)
    const err = await caught
    expect(err).toBeInstanceOf(Error)
    expect(photoErrorMessage(err, 'CHECK_OUT')).toContain('연결')
  })
})
