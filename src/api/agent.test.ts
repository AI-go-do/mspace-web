import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import { clearSubmitting, currentSubmitting, historyOf, setSubmitting } from '../lib/chatStore'
import { MAX_WAIT_MS, confirmCard, submitChat, waitForChat } from './agent'
import { ApiError } from './client'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const RESULT = { reply: '3번 방이 비어 있어요', confirmations: [], accessCodeCards: [], toolCalls: 1, stoppedByLimit: false }

describe('비서 채팅: 접수 → 결과 조회 (docs api 7장)', () => {
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

  it('보내면 202로 접수 번호를 받는다(말과 앞 대화를 함께 보낸다)', async () => {
    fetchMock.mockResolvedValue(json(202, { jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }))
    const job = await submitChat('빈 방?', [{ role: 'user', text: '안녕' }])
    expect(job.jobId).toBe('j_1')
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/agent/chat')
    expect(JSON.parse(init.body)).toEqual({ message: '빈 방?', history: [{ role: 'user', text: '안녕' }] })
  })

  it('PENDING이면 pollAfterMs마다 조회하고, DONE이면 결과를 준다', async () => {
    const answers = [
      json(200, { jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }),
      json(200, { jobId: 'j_1', status: 'DONE', result: RESULT, error: null }),
    ]
    fetchMock.mockImplementation(async () => answers.shift())
    const waits: number[] = []
    const result = await waitForChat({ jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }, {
      sleep: async (ms) => { waits.push(ms) },
    })
    expect(result.reply).toBe('3번 방이 비어 있어요')
    expect(waits).toEqual([1000, 1000])
    expect(fetchMock.mock.calls.map(([p]) => p)).toEqual(['/api/agent/chat/j_1', '/api/agent/chat/j_1'])
  })

  it('FAILED면 서버 문장을 그대로 오류로 던진다', async () => {
    fetchMock.mockResolvedValue(json(200, { jobId: 'j_1', status: 'FAILED', result: null,
      error: { code: 'LLM_RATE_LIMITED', message: '오늘 무료 한도를 다 썼어요' } }))
    await expect(waitForChat({ jobId: 'j_1', status: 'PENDING' }, { sleep: async () => {} }))
      .rejects.toMatchObject({ code: 'LLM_RATE_LIMITED', message: '오늘 무료 한도를 다 썼어요' })
  })

  it('90초 넘게 PENDING이면 조회를 멈추고 다시 보내 달라고 한다', async () => {
    fetchMock.mockImplementation(async () => json(200, { jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }))
    let t = 0
    const err = await waitForChat({ jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }, {
      now: () => t,
      startedAt: 0,
      sleep: async (ms) => { t += ms },
    }).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err.code).toBe('CHAT_TIMEOUT')
    expect(t).toBeLessThanOrEqual(MAX_WAIT_MS)
  })

  it('조회 요청이 기한까지 안 끝나면 그 요청을 끊고 CHAT_TIMEOUT', async () => {
    let aborted = false
    fetchMock.mockImplementation((_p: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('aborted', 'AbortError')) })
    }))
    let t = 89_950
    const err = await waitForChat({ jobId: 'j_1', status: 'PENDING', pollAfterMs: 10 }, {
      now: () => t, startedAt: 0, sleep: async (ms) => { t += ms },
    }).catch((e) => e)
    expect(aborted).toBe(true)
    expect(err).toMatchObject({ code: 'CHAT_TIMEOUT' })
  })

  it('보관 시간이 지난 번호(404)는 서버 문장 그대로 알린다', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'CHAT_JOB_NOT_FOUND', message: '대화 결과를 찾지 못했어요. 다시 보내 주세요.' }))
    await expect(waitForChat({ jobId: 'j_old', status: 'PENDING' }, { sleep: async () => {} }))
      .rejects.toMatchObject({ code: 'CHAT_JOB_NOT_FOUND' })
  })

  it('화면을 떠나 조회를 끊으면 더 조회하지 않는다', async () => {
    const ctrl = new AbortController()
    fetchMock.mockImplementation(async () => json(200, { jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }))
    const p = waitForChat({ jobId: 'j_1', status: 'PENDING', pollAfterMs: 1000 }, { signal: ctrl.signal })
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('확인 카드: 예약 만들기만 참여자 학번을 보내고, 취소·퇴실은 본문 없이 보낸다', async () => {
    fetchMock.mockImplementation(async () => json(200, { action: 'CREATE', reservationId: 12, status: 'BOOKED', accessCode: '482913', replayed: false, message: '예약했어요.' }))
    await confirmCard('c_1', ['20230002'])
    await confirmCard('c_2')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/agent/confirmations/c_1')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ participantStudentIds: ['20230002'] })
    expect(fetchMock.mock.calls[1][1].body).toBeUndefined()
  })
})

describe('historyOf', () => {
  it('오류 안내는 빼고 최근 것만 보낸다', () => {
    const msgs = [
      { id: 1, role: 'user' as const, text: '안녕' },
      { id: 2, role: 'assistant' as const, text: '보내지 못했어요', error: true },
      { id: 3, role: 'user' as const, text: '빈 방?' },
      { id: 4, role: 'assistant' as const, text: '1번 방이요' },
    ]
    expect(historyOf(msgs)).toEqual([
      { role: 'user', text: '안녕' }, { role: 'user', text: '빈 방?' }, { role: 'assistant', text: '1번 방이요' },
    ])
    expect(historyOf(msgs, 2)).toHaveLength(2)
  })
})

describe('접수 중인 요청', () => {
  it('보낸 회원만 이어 받고, 다른 접수는 지우지 않는다', () => {
    const a = Promise.resolve({ jobId: 'a' })
    const b = Promise.resolve({ jobId: 'b' })
    setSubmitting(1, a)
    expect(currentSubmitting(1)).toBe(a)
    expect(currentSubmitting(2)).toBeNull()
    setSubmitting(2, b)
    clearSubmitting(a)
    expect(currentSubmitting(2)).toBe(b)
    clearSubmitting(b)
    expect(currentSubmitting(2)).toBeNull()
  })
})
