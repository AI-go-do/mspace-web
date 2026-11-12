import { useSyncExternalStore } from 'react'
import { appealProblem, demoDecision, type Appeal, type WarningRecord } from '../lib/appeal'
import { currentMemberId } from './client'
import { seoulDate } from '../lib/time'

/**
 * 경고 철회 요청 데이터 창구 (FR-RPT-105, 웹 화면만 가짜 단계). core #111(경고 목록·철회 요청 API)이 생기면 이 파일 안쪽만 바꾼다
 * (요청한 모양: GET /api/penalties/me/warnings, POST /api/warnings/{id}/appeal). 지금은 ?demo=1일 때만 예시 경고 3건을 보여 주고,
 * 보낸 요청은 이 탭에만 남는다(sessionStorage). AI 판단도 예시 규칙(demoDecision)으로 몇 초 뒤 나온다
 */
const KEY = 'mspace:demo:appeals'
/** 예시에서 AI가 다시 비교하는 데 걸리는 척하는 시간 */
export const DEMO_REVIEW_MS = 4_000

interface State {
  /** 예시를 처음 켠 시각. 날짜를 이 시각 기준으로 만들어 "이틀 전"이 계속 이틀 전으로 보이게 */
  seededAt: number
  appeals: Record<string, Appeal>
}

/** 서울 날짜 n일 전의 h시 m분 */
function dayAt(base: number, daysAgo: number, h: number, m = 0): string {
  const date = seoulDate(new Date(base - daysAgo * 86_400_000))
  return new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`).toISOString()
}

/**
 * 예시 경고 3건 (11/10 무인 방향: 경고도 AI가 준다): 요청할 수 있는 어질러짐(입실 사진에 이미 컵이 있었음),
 * 요청을 보내 AI가 다시 보는 중인 창문 열림, AI가 철회한 어질러짐
 */
export function demoWarnings(base: number, appeals: Record<string, Appeal> = {}): WarningRecord[] {
  const list: WarningRecord[] = [
    {
      id: -1, kind: 'MESSY', roomId: 3, reservationId: null,
      startAt: dayAt(base, 2, 14), endAt: dayAt(base, 2, 16), issuedAt: dayAt(base, 2, 16, 12),
      why: '퇴실 뒤 방 카메라가 "정리 필요"로 봐서 AI가 경고를 정했어요',
      evidence: [
        { at: dayAt(base, 2, 14, 2), source: '입실 사진', text: '들어올 때 책상 위에 컵 2개가 이미 있었어요', tone: 'for' },
        { at: dayAt(base, 2, 15, 58), source: '예약', text: '퇴실 버튼을 눌렀어요', tone: 'neutral' },
        { at: dayAt(base, 2, 16, 5), source: '방 카메라', text: '사람 0명을 확인한 뒤 책상 위 컵 2개를 봤어요', tone: 'neutral' },
        { at: dayAt(base, 2, 16, 12), source: 'AI', text: '정리 확인 결과로 경고 1회를 정했어요', tone: 'neutral' },
      ],
      appeal: null,
    },
    {
      id: -2, kind: 'WINDOW_OPEN', roomId: 4, reservationId: null,
      startAt: dayAt(base, 4, 16), endAt: dayAt(base, 4, 18), issuedAt: dayAt(base, 4, 18, 20),
      why: '다음 팀이 창문 열림을 신고했고, AI가 신고 사진과 퇴실 기록을 비교해 정했어요',
      evidence: [
        { at: dayAt(base, 4, 17, 58), source: '예약', text: '퇴실 버튼을 눌렀어요', tone: 'neutral' },
        { at: dayAt(base, 4, 17, 59), source: '퇴실 사진', text: '나갈 때 찍은 사진에 창문이 닫혀 있어요', tone: 'for' },
        { at: dayAt(base, 4, 18, 5), source: '신고', text: '다음 팀이 사진 1장과 "창문 열림"을 신고했어요', tone: 'neutral' },
        { at: dayAt(base, 4, 18, 20), source: 'AI', text: '신고 사진을 보고 경고 1회를 정했어요', tone: 'neutral' },
      ],
      appeal: {
        status: 'SENT', sentAt: dayAt(base, 3, 10, 12), evidence: [1],
        text: '나갈 때 창문을 닫고 퇴실 사진도 찍었어요. 17:59 사진을 다시 봐 주세요.',
        answer: null,
      },
    },
    {
      id: -3, kind: 'MESSY', roomId: 1, reservationId: null,
      startAt: dayAt(base, 9, 10), endAt: dayAt(base, 9, 12), issuedAt: dayAt(base, 9, 12, 10),
      why: '퇴실 뒤 방 카메라가 "정리 필요"로 봐서 AI가 경고를 정했어요',
      evidence: [
        { at: dayAt(base, 9, 11, 56), source: '퇴실 사진', text: '나갈 때 찍은 사진에 바닥·책상이 깨끗해요', tone: 'for' },
        { at: dayAt(base, 9, 12, 3), source: '방 카메라', text: '바닥에 종이컵 1개를 봤어요', tone: 'neutral' },
        { at: dayAt(base, 9, 12, 10), source: 'AI', text: '정리 확인 결과로 경고 1회를 정했어요', tone: 'neutral' },
      ],
      appeal: {
        status: 'ACCEPTED', sentAt: dayAt(base, 8, 9, 40), evidence: [0],
        text: '나갈 때 바닥까지 치우고 퇴실 사진을 찍었어요. 다시 봐 주세요.',
        answer: '11:56 퇴실 사진과 12:03 방 카메라 결과를 다시 비교했어요. 종이컵이 퇴실 사진에는 없어서 이 예약 탓으로 보기 어려워 철회했어요.',
        confidence: 0.93,
      },
    },
  ]
  return list.map((w) => (appeals[String(w.id)] ? { ...w, appeal: appeals[String(w.id)] } : w))
}

// 회원마다 따로 기억한다(같은 탭에서 다른 계정으로 바꿔도 앞 사람 해명이 보이지 않게)
let whoAmI: () => number | null = currentMemberId
const keyOf = (member: number | null) => `${KEY}:${member ?? 'guest'}`
let state: State | null = null
let stateKey: string | null = null
let snapshot: WarningRecord[] = []
const listeners = new Set<() => void>()

function read(key: string): State {
  try {
    const raw = sessionStorage.getItem(key)
    const s = raw ? (JSON.parse(raw) as Partial<State>) : null
    if (s && typeof s.seededAt === 'number' && s.appeals && typeof s.appeals === 'object') return { seededAt: s.seededAt, appeals: s.appeals }
  } catch { /* 처음이거나 저장소를 못 씀 */ }
  return { seededAt: Date.now(), appeals: {} }
}

/** 보낸 지 DEMO_REVIEW_MS가 지난 요청에 예시 AI 판단을 붙인다. 바뀐 것이 없으면 그대로 돌려준다 */
function settle(s: State, now: number): State {
  let changed = false
  const appeals = { ...s.appeals }
  const base = demoWarnings(s.seededAt)
  for (const [id, a] of Object.entries(s.appeals)) {
    if (a.status !== 'SENT' || now - Date.parse(a.sentAt) < DEMO_REVIEW_MS) continue
    const w = base.find((x) => String(x.id) === id)
    if (!w) continue
    appeals[id] = { ...a, ...demoDecision(w, a.evidence) }
    changed = true
  }
  return changed ? { ...s, appeals } : s
}

function get(): State {
  const key = keyOf(whoAmI())
  if (!state || stateKey !== key) {
    state = settle(read(key), Date.now())
    stateKey = key
    snapshot = demoWarnings(state.seededAt, state.appeals)
  }
  return state
}

function set(next: State) {
  get()
  state = next
  snapshot = demoWarnings(next.seededAt, next.appeals)
  try { sessionStorage.setItem(stateKey!, JSON.stringify(next)) } catch { /* 이 화면에서만 기억 */ }
  listeners.forEach((fn) => fn())
}

const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const getSnapshot = () => { get(); return snapshot }

/** 화면용: 철회 요청을 보내거나 AI 판단이 나오면 다시 그린다 */
export function useWarnings(): WarningRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 철회 요청 보내기. 틀리면 화면에 보일 문장. 예시에서는 DEMO_REVIEW_MS 뒤 AI 판단이 붙는다 */
export function sendAppeal(id: number, text: string, evidence: number[], now = new Date()): string | null {
  const problem = appealProblem(text)
  if (problem) return problem
  const s = get()
  const w = snapshot.find((x) => x.id === id)
  if (!w) return '이 경고를 찾지 못했어요.'
  if (w.withdrawnAt) return '이미 철회된 경고예요.'
  if (w.appeal) return '이미 철회 요청을 보냈어요.'
  const member = stateKey
  set({ ...s, appeals: { ...s.appeals, [String(id)]: { status: 'SENT', text: text.trim(), sentAt: now.toISOString(), evidence, answer: null } } })
  // 같은 회원 화면일 때만 판단을 붙인다(그새 다른 계정으로 바뀌었으면 그 사람 것은 다음에 읽을 때 붙는다)
  setTimeout(() => { if (state && stateKey === member) { const next = settle(state, Date.now()); if (next !== state) set(next) } }, DEMO_REVIEW_MS + 50)
  return null
}

/** 예시를 처음 상태로 */
export function resetAppeals(): void {
  set({ seededAt: Date.now(), appeals: {} })
}

/** 테스트용 */
export function _resetAppealsForTest(member: () => number | null = currentMemberId): void {
  whoAmI = member
  state = null
  stateKey = null
  snapshot = []
}
