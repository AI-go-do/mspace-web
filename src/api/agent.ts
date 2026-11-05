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

/** 대화 접수. 202 + { jobId, status: PENDING, pollAfterMs } */
export function submitChat(message: string, history: ChatTurn[], signal?: AbortSignal): Promise<ChatJob> {
  return api('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message, history }), signal })
}

/** 결과 조회. 남의 번호·없는 번호·5분 지난 번호는 404 CHAT_JOB_NOT_FOUND */
export function getChatJob(jobId: string, signal?: AbortSignal): Promise<ChatJob> {
  return api(`/api/agent/chat/${encodeURIComponent(jobId)}`, { signal })
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
    job = await getChatJob(first.jobId, opts.signal)
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

/** 예약 만들기 카드만 참여자 학번을 보낸다. 취소·퇴실은 본문 없음 */
export function confirmCard(token: string, participantStudentIds?: string[]): Promise<ConfirmResult> {
  return api(`/api/agent/confirmations/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: participantStudentIds ? JSON.stringify({ participantStudentIds }) : undefined,
  })
}
