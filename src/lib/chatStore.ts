import type { ChatConfirmation, ConfirmResult } from '../api/agent'
import { onSessionEnd } from '../api/client'

/**
 * 비서 대화 기록. 탭을 옮겼다 돌아와도 이어지게 화면 밖(메모리)에 둔다.
 * 새로고침해도 이어지게 이 탭의 sessionStorage에도 남긴다(탭을 닫으면 사라짐).
 * 단, 확인 토큰·입실 번호는 저장소에 넣지 않는다. 확인 카드는 "지난 카드"(요약·결과만)로 바꿔 남긴다.
 * 회원이 바뀌면 비우고, 로그인이 끝나면(로그아웃·refresh 실패) 저장소도 지운다.
 */
export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  /** 오류 안내(대화 기록으로 비서에게 다시 보내지 않는다) */
  error?: boolean
  confirmations?: ChatConfirmation[]
  accessCodeCards?: { reservationId: number }[]
  /** 새로고침 전에 받은 확인 카드. 토큰이 없어 다시 누를 수 없다 */
  pastCards?: PastCard[]
}

/** 저장소에서 되살린 확인 카드. 눌러서 끝난 카드면 결과(입실 번호 빼고)를 함께 둔다 */
export interface PastCard {
  summary: string
  result?: Pick<ConfirmResult, 'action' | 'reservationId' | 'message'>
}

export interface ChatState {
  memberId: number | null
  messages: ChatMessage[]
  /** 답을 기다리는 접수 번호. 화면을 떠났다 오면 이어서 조회한다 */
  pending: { jobId: string; startedAt: number; pollAfterMs?: number } | null
}

let state: ChatState = { memberId: null, messages: [], pending: null }
let nextId = 1

/** 그 회원의 대화를 꺼낸다. 회원이 바뀌었으면 앞 회원 대화와 카드 결과를 비우고, 이 탭에 저장된 그 회원 대화가 있으면 되살린다 */
export function loadChat(memberId: number | null): ChatState {
  if (state.memberId !== memberId) {
    const saved = readSaved()
    state = restoreChat(saved, memberId, Date.now()) ?? { memberId, messages: [], pending: null }
    // 다른 회원이 들어왔으면 앞 회원 기록을 저장소에서도 지운다(null은 잠깐 refresh 실패일 수 있어 남겨 둔다)
    if (memberId !== null && saved && typeof saved === 'object' && (saved as Partial<SavedChat>).memberId !== memberId) writeSaved(null)
    cardOutcomes = new Map()
    nextId = Math.max(nextId, ...state.messages.map((m) => m.id + 1))
  }
  return state
}

/** 화면이 바꾼 대화를 저장한다 */
export function saveChat(next: ChatState): void {
  state = next
  persist()
}

/** "새 대화": 그 회원의 화면 기록·카드 결과·저장소를 비운다(서버 기억은 화면이 먼저 지운다) */
export function resetChat(memberId: number | null): ChatState {
  state = { memberId, messages: [], pending: null }
  cardOutcomes = new Map()
  writeSaved(null)
  return state
}

// ---- 이 탭 저장소(sessionStorage) ----

const STORAGE_KEY = 'mspace.agent.chat.v1'
/** 서버가 대화를 기억하는 시간(24시간)과 맞춘다. 더 오래된 화면 기록은 버린다 */
export const SAVED_TTL_MS = 24 * 60 * 60 * 1000
/** 저장소에 남길 최근 메시지 수 */
const MAX_SAVED = 60
/** 기다리던 답을 이어서 조회할 수 있는 시간(화면의 90초 기한과 같음) */
const RESUME_MS = 90_000

export interface SavedChat {
  memberId: number
  savedAt: number
  messages: ChatMessage[]
  pending: ChatState['pending']
}

/** 이 탭 저장소. 막힌 브라우저(사생활 모드 등)·테스트 환경이면 null */
function storage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

/** 저장된 값을 읽는다. 없거나 깨졌으면 null */
function readSaved(): unknown {
  try {
    const raw = storage()?.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** 저장하거나(메시지가 있을 때) 지운다(null·빈 대화) */
function writeSaved(saved: SavedChat | null): void {
  try {
    const s = storage()
    if (!s) return
    if (saved && saved.messages.length > 0) s.setItem(STORAGE_KEY, JSON.stringify(saved))
    else s.removeItem(STORAGE_KEY)
  } catch {
    // 저장소가 꽉 찼거나 막혀 있으면 새로고침 때만 사라진다(화면은 그대로 동작)
  }
}

/** 지금 대화를 저장소에 맞춘다. 회원을 모르면 건드리지 않는다 */
function persist(): void {
  if (state.memberId === null) return
  writeSaved(toSaved(state, cardOutcomes, Date.now()))
}

/**
 * 저장할 모양으로 바꾼다. 확인 토큰은 버리고 카드는 요약과(눌렀으면) 결과만 남긴다.
 * 결과의 입실 번호(accessCode)는 넣지 않는다. 접수 중(번호를 아직 못 받음)은 저장하지 않는다
 */
export function toSaved(s: ChatState, outcomes: Map<string, CardOutcome>, now: number): SavedChat | null {
  if (s.memberId === null) return null
  const messages = s.messages.slice(-MAX_SAVED).map((m): ChatMessage => {
    const { confirmations, ...rest } = m
    if (!confirmations?.length) return rest
    const past = confirmations.map((c): PastCard => {
      const o = outcomes.get(c.token)
      return o?.kind === 'done'
        ? { summary: c.summary, result: { action: o.result.action, reservationId: o.result.reservationId, message: o.result.message } }
        : { summary: c.summary }
    })
    return { ...rest, pastCards: [...(m.pastCards ?? []), ...past] }
  })
  const pending = s.pending?.jobId ? s.pending : null
  return { memberId: s.memberId, savedAt: now, messages, pending }
}

/** 저장소 값을 그 회원 대화로 되살린다. 다른 회원·24시간 지난 기록·깨진 값이면 null */
export function restoreChat(saved: unknown, memberId: number | null, now: number): ChatState | null {
  if (memberId === null || !saved || typeof saved !== 'object') return null
  const v = saved as Partial<SavedChat>
  if (v.memberId !== memberId || typeof v.savedAt !== 'number' || now - v.savedAt > SAVED_TTL_MS) return null
  if (!Array.isArray(v.messages)) return null
  const messages = v.messages.filter((m): m is ChatMessage =>
    !!m && typeof m === 'object' && typeof m.id === 'number' && (m.role === 'user' || m.role === 'assistant') && typeof m.text === 'string'
    && (m.pastCards === undefined || (Array.isArray(m.pastCards) && m.pastCards.every(isPastCard))))
  const p = v.pending
  const pending = p && typeof p.jobId === 'string' && p.jobId && typeof p.startedAt === 'number' && now - p.startedAt < RESUME_MS ? p : null
  return { memberId, messages, pending }
}

/** 지난 카드 하나의 모양 검사(요약 문자열, 결과가 있으면 종류·예약 id·안내 문장) */
function isPastCard(c: unknown): c is PastCard {
  if (!c || typeof c !== 'object') return false
  const { summary, result } = c as Partial<PastCard>
  if (typeof summary !== 'string') return false
  if (result === undefined) return true
  return !!result && typeof result === 'object'
    && typeof result.action === 'string' && typeof result.reservationId === 'number' && typeof result.message === 'string'
}

// 로그아웃·refresh 실패: 화면 기록과 이 탭 저장소를 비운다(같은 기기의 다음 사람이 보지 않게)
onSessionEnd(() => {
  state = { memberId: null, messages: [], pending: null }
  cardOutcomes = new Map()
  writeSaved(null)
})

type Submission = Promise<{ jobId: string; pollAfterMs?: number }>

/** 접수 요청이 아직 안 끝났을 때 그 결과(접수 번호). 화면을 떠났다 와도 같은 접수를 이어 받는다. 보낸 회원만 이어 받는다 */
let submitting: { memberId: number | null; promise: Submission } | null = null

/** 보내는 중인 접수를 기억한다 */
export function setSubmitting(memberId: number | null, promise: Submission): void {
  submitting = { memberId, promise }
}

/** 그 접수일 때만 비운다(다른 회원·다음 접수의 것을 지우지 않게) */
export function clearSubmitting(promise: Submission): void {
  if (submitting?.promise === promise) submitting = null
}

/** "새 대화"로 서버 기억을 지우는 중인 요청. 화면을 떠났다 와도 지우는 동안 보내지 않게 화면 밖에 둔다 */
let clearingChat: { memberId: number; promise: Promise<void> } | null = null

/** 지우기 요청을 기억하고, 끝나면(성공·실패 모두) 비운다 */
export function rememberClearing(memberId: number, promise: Promise<void>): void {
  const entry = { memberId, promise }
  clearingChat = entry
  const done = () => { if (clearingChat === entry) clearingChat = null }
  promise.then(done, done)
}

/** 그 회원의 대화를 지우는 중이면 그 요청. 아니면 null */
export function currentClearing(memberId: number | null): Promise<void> | null {
  return clearingChat && clearingChat.memberId === memberId ? clearingChat.promise : null
}

/** 그 회원이 보내는 중인 접수. 다른 회원이면 null */
export function currentSubmitting(memberId: number | null): Submission | null {
  return submitting && submitting.memberId === memberId ? submitting.promise : null
}

/**
 * 확인 카드 상태. 화면을 떠났다 와도 누른 카드가 다시 입력 상태로 돌아가지 않게 토큰별로 기억한다.
 * 보내는 중(sending)도 기억해서, 다시 그려진 카드가 같은 토큰을 한 번 더 보내지 않게 한다
 */
export type CardOutcome =
  | { kind: 'open'; error?: string }
  | { kind: 'sending' }
  | { kind: 'done'; result: ConfirmResult }
  | { kind: 'closed'; message: string }

/** 지금 대화 주인(loadChat의 회원) 것만 담는다. 회원이 바뀌면 loadChat이 비운다 */
let cardOutcomes = new Map<string, CardOutcome>()
const cardListeners = new Map<string, Set<(o: CardOutcome | undefined) => void>>()

/** 지금 대화 주인의 그 카드 결과. 다른 회원이 물으면 undefined */
export function cardOutcomeOf(memberId: number | null, token: string): CardOutcome | undefined {
  return state.memberId === memberId ? cardOutcomes.get(token) : undefined
}

/**
 * 결과를 기억하고 그 카드를 보고 있는 화면에 알린다. undefined면 지운다(다시 누를 수 있는 상태).
 * 보낸 회원이 지금 대화 주인이 아니면(그사이 로그아웃·다른 회원) 늦게 온 결과는 버린다
 */
export function saveCardOutcome(memberId: number | null, token: string, outcome: CardOutcome | undefined): void {
  if (state.memberId !== memberId) return
  if (outcome) cardOutcomes.set(token, outcome)
  else cardOutcomes.delete(token)
  // 눌러서 끝난 결과도 새로고침 뒤 "지난 카드"에 보이게 저장소를 맞춘다
  if (outcome?.kind === 'done') persist()
  cardListeners.get(token)?.forEach((fn) => fn(outcome))
}

/** 카드가 자기 토큰의 결과를 받아 보게 한다. 돌려준 함수로 그만 받는다 */
export function watchCardOutcome(token: string, fn: (o: CardOutcome | undefined) => void): () => void {
  const set = cardListeners.get(token) ?? new Set()
  set.add(fn)
  cardListeners.set(token, set)
  return () => {
    set.delete(fn)
    if (set.size === 0) cardListeners.delete(token)
  }
}

/** 대화 메시지에 붙일 새 번호 */
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
