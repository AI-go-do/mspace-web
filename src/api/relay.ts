import { demoOn } from '../lib/demo'
import { seoulDate } from '../lib/time'
import { api } from './client'
import type { Slot } from './rooms'

/**
 * 빈방 릴레이 (Q-18, core #101 머지, core docs/결정.md 23번).
 * 원하는 칸이 차 있으면 그 칸을 "기다리기"로 걸어 둔다 → 그 예약이 놓이면(취소) core가 기다린 순서대로 한 사람씩 넘긴다
 * → 받은 사람은 5분 안에 [받을게요]를 누르고 함께 쓸 사람을 확인해 예약한다(방 인원·대표자 1건 규칙은 core가 그대로 본다).
 * 기다리기는 한 사람 동시에 3개, 시작 30분 전부터는 걸 수도 넘기지도 않는다(core 설정값)
 *
 * GET  /api/relay/waits/me            내 기다리기 목록
 * POST /api/relay/waits               { roomId, startAt } → RelayWait (409 RELAY_SLOT_FREE·RELAY_WAIT_LIMIT·RELAY_TOO_LATE)
 * POST /api/relay/waits/{id}/cancel   그만 기다리기 (204)
 * GET  /api/relay/offers/me           나에게 넘어온 칸(받을 시간이 남은 것만)
 * POST /api/relay/offers/{id}/decline 넘길게요(다음 사람에게, 204)
 * 받기: POST /api/reservations 본문에 relayOfferId를 같이 보낸다(늦으면 409 RELAY_OFFER_INVALID, 남이 잡아 둔 칸은 409 RELAY_HELD)
 *
 * 빌드 때 VITE_RELAY_SOURCE=api면 core API를 쓴다(개발 서버만). 아니면 예시 화면(?demo=1)에서만 보인다
 * (core 운영 서버에 릴레이가 들어가기 전 학생 화면에 아무 일도 안 일어나는 버튼을 내지 않게). ?demo=1은 늘 예시
 */
export interface RelayWait {
  id: number
  roomId: number
  /** 기다리는 30분 칸의 시작 */
  startAt: string
  /** 기다린 순서(1 = 맨 앞) */
  order: number
}

export interface RelayOffer {
  id: number
  roomId: number
  /** 놓인 예약 구간 */
  startAt: string
  endAt: string
  /** 이 시각까지 안 받으면 다음 사람에게 넘어간다 */
  expiresAt: string
  order: number
}

/** 이 빌드가 core 릴레이 API를 쓰는지 */
const BUILD_API = import.meta.env.VITE_RELAY_SOURCE === 'api'
let apiOverride: boolean | null = null

/** 이 빌드(또는 테스트)가 core 릴레이 API를 켰는지. 화면 보이기와 요청 길이 같은 값을 보게 한 곳에서만 정한다 */
const apiEnabled = () => apiOverride ?? BUILD_API

/** core API를 부를지. 예시 화면(?demo=1)은 늘 예시 */
const callsApi = () => !demoOn() && apiEnabled()

/** 릴레이 화면을 보일지. core API를 쓰는 빌드이거나 예시 화면이면 보인다 */
export const relayOn = () => demoOn() || apiEnabled()

/** 테스트에서 빌드 값을 바꾼다. null이면 빌드 값으로 */
export function _setRelayApiForTest(on: boolean | null): void {
  apiOverride = on
}

/** 내 기다리기 목록(기다린 순서 포함) */
export function getMyWaits(member: number): Promise<RelayWait[]> {
  if (!callsApi()) return Promise.resolve(demoWaits(member))
  return api('/api/relay/waits/me', { member })
}

/** 기다리기 걸기. endHint는 예시에서만 쓴다(놓일 구간을 core가 알기 전 흉내) */
export function addWait(member: number, roomId: number, startAt: string, endHint: string): Promise<RelayWait> {
  if (!callsApi()) return Promise.resolve(demoAddWait(member, roomId, startAt, endHint))
  return api('/api/relay/waits', { method: 'POST', member, body: JSON.stringify({ roomId, startAt }) })
}

/** 그만 기다리기 */
export function cancelWait(member: number, id: number): Promise<void> {
  if (!callsApi()) return Promise.resolve(demoDrop(member, id))
  return api(`/api/relay/waits/${id}/cancel`, { method: 'POST', member })
}

/** 나에게 넘어온 칸 중 받을 시간이 남은 것 */
export function getMyOffers(member: number, signal?: AbortSignal): Promise<RelayOffer[]> {
  if (!callsApi()) return Promise.resolve(demoOffers(member))
  return api('/api/relay/offers/me', { member, signal })
}

/** 넘길게요: 다음으로 기다린 사람에게 넘긴다 */
export function declineOffer(member: number, id: number): Promise<void> {
  if (!callsApi()) return Promise.resolve(demoDrop(member, id))
  return api(`/api/relay/offers/${id}/decline`, { method: 'POST', member })
}

/** 예시 받기(?demo=1): 실제 예약은 만들지 않고 기다리기만 지운다 */
export const isDemoOffer = (id: number) => !callsApi() && id < 0
export function finishDemoOffer(member: number, id: number): void {
  demoDrop(member, id)
}

// ---- 화면 계산 ----

const SLOT_MS = 30 * 60_000

/** 넘겨받은 칸을 예약 화면이 골라 둘 날짜·칸. 예약 화면 홈 비서 카드와 같은 모양(SuggestPick) */
export function offerPick(o: Pick<RelayOffer, 'startAt' | 'endAt'>): { date: string; start: number; len: number } {
  const date = seoulDate(new Date(o.startAt))
  const day0 = Date.parse(`${date}T00:00:00+09:00`)
  return {
    date,
    start: Math.round((Date.parse(o.startAt) - day0) / SLOT_MS),
    len: Math.max(1, Math.round((Date.parse(o.endAt) - Date.parse(o.startAt)) / SLOT_MS)),
  }
}

/** 넘겨받은 사람에게만: 놓인 구간의 칸을 빈 칸으로 본다(다른 학생에게는 core가 잡아 둔 칸이라 예약됨으로 보인다) */
export function openOfferSlots(slots: Slot[], o: Pick<RelayOffer, 'startAt' | 'endAt'> | null): Slot[] {
  if (!o) return slots
  const a = Date.parse(o.startAt)
  const b = Date.parse(o.endAt)
  return slots.map((s) => {
    const t = Date.parse(s.startAt)
    return t >= a && t < b && !s.available ? { ...s, available: true } : s
  })
}

/** 눌린 예약 칸부터 이어진 예약 칸의 끝(최대 2시간). 예시에서 "놓일 구간"을 흉내 낼 때만 쓴다 */
export function takenRunEnd(slots: Slot[], i: number): string {
  let j = i
  while (j + 1 < slots.length && j - i + 1 < 4 && !slots[j + 1].available) j++
  return slots[j].endAt
}

/** "4:52" (남은 받을 시간) */
export function countdown(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---- 예시 데이터 (?demo=1, 또는 core API를 쓰지 않는 빌드) ----
// 이 탭(sessionStorage)·회원별로 둔다. 기다리기를 걸고 20초 뒤 앞 팀이 놓은 것처럼 넘어오고, 5분 안에 안 받으면 사라진다

/** 기다리기를 건 뒤 넘어오기까지(예시) */
export const DEMO_OFFER_AFTER_MS = 20_000
/** 받을 시간(예시). 실제 값은 core 설정 */
export const DEMO_HOLD_MS = 5 * 60_000

interface DemoWait { id: number; roomId: number; startAt: string; endAt: string; at: number }

const demoKey = (member: number) => `mspace:demo:relay:${member}`

function readDemo(member: number): DemoWait[] {
  try {
    const raw = sessionStorage.getItem(demoKey(member))
    const list = raw ? (JSON.parse(raw) as DemoWait[]) : []
    return Array.isArray(list) ? list.filter((w) => typeof w?.id === 'number' && typeof w.startAt === 'string') : []
  } catch {
    return []
  }
}

function writeDemo(member: number, list: DemoWait[]): void {
  try { sessionStorage.setItem(demoKey(member), JSON.stringify(list)) } catch { /* 이 화면에서만 */ }
}

/** 지난 칸·받을 시간이 지난 것은 지운다 */
function liveDemo(member: number, now: number): DemoWait[] {
  const list = readDemo(member)
  const live = list.filter((w) => Date.parse(w.startAt) > now && now < w.at + DEMO_OFFER_AFTER_MS + DEMO_HOLD_MS)
  if (live.length !== list.length) writeDemo(member, live)
  return live
}

/** 예시: 아직 넘어오지 않은 기다리기 */
export function demoWaits(member: number, now = Date.now()): RelayWait[] {
  return liveDemo(member, now)
    .filter((w) => now < w.at + DEMO_OFFER_AFTER_MS)
    .map((w) => ({ id: w.id, roomId: w.roomId, startAt: w.startAt, order: 1 }))
}

/** 예시: 걸고 20초가 지나 넘어온 칸(받을 시간 5분) */
export function demoOffers(member: number, now = Date.now()): RelayOffer[] {
  return liveDemo(member, now)
    .filter((w) => now >= w.at + DEMO_OFFER_AFTER_MS)
    .map((w) => ({ id: w.id, roomId: w.roomId, startAt: w.startAt, endAt: w.endAt, expiresAt: new Date(w.at + DEMO_OFFER_AFTER_MS + DEMO_HOLD_MS).toISOString(), order: 1 }))
}

/** 예시: 기다리기 걸기(같은 칸은 하나) */
export function demoAddWait(member: number, roomId: number, startAt: string, endAt: string, now = Date.now()): RelayWait {
  const list = liveDemo(member, now)
  const same = list.find((w) => w.roomId === roomId && w.startAt === startAt)
  if (same) return { id: same.id, roomId, startAt, order: 1 }
  // 예시 번호는 음수(서버 번호와 겹치지 않게)
  const id = Math.min(0, ...list.map((w) => w.id)) - 1
  writeDemo(member, [...list, { id, roomId, startAt, endAt, at: now }])
  return { id, roomId, startAt, order: 1 }
}

function demoDrop(member: number, id: number): void {
  writeDemo(member, readDemo(member).filter((w) => w.id !== id))
}
