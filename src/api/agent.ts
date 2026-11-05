import { api, ApiError } from './client'

/**
 * 비서 스페이시 (FR-AGT-101). docs api 7장.
 * 비서는 답을 만드는 데 몇 초~45초가 걸려서, 말을 보내면 바로 접수 번호(jobId)를 받고
 * 화면이 pollAfterMs(1초)마다 결과를 조회한다. 끝난 결과는 서버가 5분만 맡아 둔다.
 */

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

/** 확인 카드. 쓰기(예약·취소·퇴실)는 학생이 [확인]을 눌러야 한다 */
export interface ChatConfirmation {
  /** create_reservation · cancel_reservation · checkout_reservation */
  tool: string
  token: string
  summary: string
  notes: string[]
  /** 예약 만들기일 때 받아야 할 참여자 학번 수(대표자 빼고). 그 밖에는 0 */
  needsParticipants: number
  expiresAt: string
}

export interface ChatResult {
  reply: string
  confirmations: ChatConfirmation[]
  /** 입실 번호는 모델에 보내지 않아 예약 id만 온다 */
  accessCodeCards: { reservationId: number }[]
  toolCalls: number
  stoppedByLimit: boolean
}

export type ChatStatus = 'PENDING' | 'DONE' | 'FAILED'

export interface ChatJob {
  jobId: string
  status: ChatStatus
  pollAfterMs?: number
  result?: ChatResult | null
  error?: { code: string; message: string } | null
}

/** 대화 접수. 202 + { jobId, status: PENDING, pollAfterMs }. 응답이 SUBMIT_TIMEOUT_MS 안에 안 오면 요청을 끊는다 */
export async function submitChat(message: string, history: ChatTurn[], signal?: AbortSignal, member?: number | null): Promise<ChatJob> {
  const d = deadline(SUBMIT_TIMEOUT_MS, signal)
  try {
    return await api('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message, history }), signal: d.signal, member })
  } catch (e) {
    if (d.timedOut()) throw new ApiError(0, 'CHAT_TIMEOUT', '보내는 데 너무 오래 걸려요. 잠시 뒤 다시 보내 주세요.')
    throw e
  } finally {
    d.done()
  }
}

/** 결과 조회. 남의 번호·없는 번호·5분 지난 번호는 404 CHAT_JOB_NOT_FOUND */
export function getChatJob(jobId: string, signal?: AbortSignal, member?: number | null): Promise<ChatJob> {
  return api(`/api/agent/chat/${encodeURIComponent(jobId)}`, { signal, member })
}

/** 접수(POST)를 기다리는 최대 시간. 접수는 바로 202가 와야 해서 짧게 둔다 */
export const SUBMIT_TIMEOUT_MS = 15_000

/**
 * 부르는 쪽 signal을 그대로 따르면서, ms가 지나면 스스로 끊는 signal을 만든다.
 * (AbortSignal.any·timeout은 오래된 Safari에 없어서 직접 묶는다)
 */
export function deadline(ms: number, outer?: AbortSignal) {
  const ctrl = new AbortController()
  let timedOut = false
  const onAbort = () => ctrl.abort()
  if (outer?.aborted) ctrl.abort()
  else outer?.addEventListener('abort', onAbort, { once: true })
  const t = setTimeout(() => {
    timedOut = true
    ctrl.abort()
  }, Math.max(0, ms))
  return {
    signal: ctrl.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(t)
      outer?.removeEventListener('abort', onAbort)
    },
  }
}

/** 서버가 pollAfterMs를 안 주면 1초 */
export const DEFAULT_POLL_MS = 1000
/** 90초 넘게 PENDING이면 조회를 멈추고 다시 보내 달라고 한다 (비서 기한 45초 + 여유) */
export const MAX_WAIT_MS = 90_000

export interface WaitOptions {
  signal?: AbortSignal
  /** 테스트에서 시간을 바꿔 끼우려고 받는다 */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  now?: () => number
  /** 접수한 시각(이어서 조회할 때 처음 접수 시각부터 90초를 센다) */
  startedAt?: number
  /** 보낸 회원. 주면 그 회원 토큰으로만 조회한다 */
  member?: number | null
}

function abortError(): DOMException {
  return new DOMException('aborted', 'AbortError')
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * 접수한 일의 결과를 끝날 때까지 조회한다. 조회는 앞 조회가 끝난 뒤 pollAfterMs 기다렸다가 한다(겹치지 않음).
 * DONE이면 결과를, FAILED면 서버 문장 그대로 ApiError를, 90초가 넘으면 CHAT_TIMEOUT을 던진다.
 */
export async function waitForChat(first: ChatJob, opts: WaitOptions = {}): Promise<ChatResult> {
  const pause = opts.sleep ?? sleep
  const now = opts.now ?? Date.now
  const startedAt = opts.startedAt ?? now()
  let job = first
  for (;;) {
    if (job.status === 'DONE' && job.result) return job.result
    if (job.status === 'FAILED' || job.status === 'DONE') {
      throw new ApiError(200, job.error?.code ?? 'AGENT_FAILED', job.error?.message ?? '비서가 답하지 못했어요. 다시 보내 주세요.')
    }
    const wait = job.pollAfterMs ?? DEFAULT_POLL_MS
    if (now() - startedAt + wait > MAX_WAIT_MS) {
      throw new ApiError(0, 'CHAT_TIMEOUT', '답이 너무 늦어요. 잠시 뒤 다시 보내 주세요.')
    }
    await pause(wait, opts.signal)
    // 조회 요청도 90초 기한에서 끊는다(응답이 안 오는 요청 하나에 화면이 묶이지 않게)
    const d = deadline(startedAt + MAX_WAIT_MS - now(), opts.signal)
    try {
      job = await getChatJob(first.jobId, d.signal, opts.member)
    } catch (e) {
      if (d.timedOut()) throw new ApiError(0, 'CHAT_TIMEOUT', '답이 너무 늦어요. 잠시 뒤 다시 보내 주세요.')
      throw e
    } finally {
      d.done()
    }
  }
}

// ---- 확인 카드 [확인] ----

export interface ConfirmResult {
  action: 'CREATE' | 'CANCEL' | 'CHECKOUT'
  reservationId: number
  status: string
  /** 예약 만들기일 때만 */
  accessCode: string | null
  replayed: boolean
  message: string
}

/**
 * "새 대화": 서버가 기억한 앞선 대화(24시간)를 지운다. 204.
 * 답을 만드는 중이면 409 CHAT_IN_PROGRESS(끝나면서 옛 대화를 다시 저장하기 때문)
 */
export async function clearChatHistory(member?: number | null, timeoutMs = CLEAR_TIMEOUT_MS): Promise<void> {
  // 응답이 끝내 안 오면 "지우는 중"이 풀리지 않아 보내기가 계속 막히므로 기한을 둔다
  const d = deadline(timeoutMs)
  try {
    await api('/api/agent/chat/history', { method: 'DELETE', signal: d.signal, member })
  } catch (e) {
    if (d.timedOut()) throw new ApiError(0, 'CLEAR_TIMEOUT', '대화를 지우는 데 너무 오래 걸려요. 잠시 뒤 다시 눌러 주세요.')
    throw e
  } finally {
    d.done()
  }
}

/** 대화 지우기(DELETE)를 기다리는 최대 시간 */
export const CLEAR_TIMEOUT_MS = 15_000

/** 예약 만들기 카드만 참여자 학번을 보낸다. 취소·퇴실은 본문 없음 */
export function confirmCard(token: string, participantStudentIds?: string[], member?: number | null): Promise<ConfirmResult> {
  return api(`/api/agent/confirmations/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: participantStudentIds ? JSON.stringify({ participantStudentIds }) : undefined,
    member,
  })
}
