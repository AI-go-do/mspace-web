import type { ChatConfirmation } from '../api/agent'

/**
 * 비서 대화 기록. 탭을 옮겼다 돌아와도 이어지게 화면 밖(메모리)에 둔다.
 * 확인 토큰이 들어 있어서 브라우저 저장소에는 넣지 않는다(새로고침하면 사라진다).
 * 회원이 바뀌면 비운다.
 */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** 오류 안내(대화 기록으로 비서에게 다시 보내지 않는다) */
  error?: boolean
  confirmations?: ChatConfirmation[]
  accessCodeCards?: { reservationId: number }[]
}

export interface ChatState {
  memberId: number | null
  messages: ChatMessage[]
  /** 답을 기다리는 접수 번호. 화면을 떠났다 오면 이어서 조회한다 */
  pending: { jobId: string; startedAt: number; pollAfterMs?: number } | null
}

let state: ChatState = { memberId: null, messages: [], pending: null }
let nextId = 1

export function loadChat(memberId: number | null): ChatState {
  if (state.memberId !== memberId) state = { memberId, messages: [], pending: null }
  return state
}

export function saveChat(next: ChatState): void {
  state = next
}

type Submission = Promise<{ jobId: string; pollAfterMs?: number }>

/** 접수 요청이 아직 안 끝났을 때 그 결과(접수 번호). 화면을 떠났다 와도 같은 접수를 이어 받는다. 보낸 회원만 이어 받는다 */
let submitting: { memberId: number | null; promise: Submission } | null = null

export function setSubmitting(memberId: number | null, promise: Submission): void {
  submitting = { memberId, promise }
}

/** 그 접수일 때만 비운다(다른 회원·다음 접수의 것을 지우지 않게) */
export function clearSubmitting(promise: Submission): void {
  if (submitting?.promise === promise) submitting = null
}

export function currentSubmitting(memberId: number | null): Submission | null {
  return submitting && submitting.memberId === memberId ? submitting.promise : null
}

export function newMessageId(): number {
  return nextId++
}

/** 비서에게 함께 보낼 앞 대화. 오류 안내는 빼고, 최근 것만(서버도 8개로 자른다) */
export function historyOf(messages: ChatMessage[], max = 8): { role: 'user' | 'assistant'; text: string }[] {
  return messages
    .filter((m) => !m.error && m.text.trim())
    .slice(-max)
    .map((m) => ({ role: m.role, text: m.text }))
}
