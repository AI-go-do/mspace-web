import { useSyncExternalStore } from 'react'
import { appealProblem, type Appeal, type WarningRecord } from '../lib/appeal'
import { currentMemberId } from './client'
import { seoulDate } from '../lib/time'

/**
 * 벌점 해명 데이터 창구 (웹 화면만, 가짜 단계). core에 경고 내역·해명 API가 생기면 이 파일 안쪽만 바꾼다
 * (예상: GET /api/penalties/me/history, POST /api/penalties/{id}/appeal). 지금은 ?demo=1일 때만 예시 경고 3건을 보여 주고,
 * 보낸 해명은 이 탭에만 남는다(sessionStorage). 관리자에게 실제로 가지 않는다
 */
const KEY = 'mspace:demo:appeals'

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

/** 예시 경고 3건: 해명할 수 있는 억울한 노쇼, 해명을 보내 검토 중인 창문 열림, 받아들여 무른 노쇼 */
export function demoWarnings(base: number, appeals: Record<string, Appeal> = {}): WarningRecord[] {
  const list: WarningRecord[] = [
    {
      id: -1, kind: 'NO_SHOW', roomId: 2,
      startAt: dayAt(base, 2, 14), endAt: dayAt(base, 2, 16), issuedAt: dayAt(base, 2, 14, 15),
      why: '시작하고 15분 안에 입실 기록이 없었어요',
      evidence: [
        { at: dayAt(base, 2, 14, 3), source: '문 장치', text: '문 앞에서 QR을 3번 찍었지만 문이 열리지 않았어요', tone: 'for' },
        { at: dayAt(base, 2, 14, 9), source: '문 장치', text: '문 장치 와이파이가 6분 동안 끊겼어요', tone: 'for' },
        { at: dayAt(base, 2, 14, 15), source: '예약', text: '입실 기록이 없어 노쇼로 바뀌었어요', tone: 'neutral' },
      ],
      appeal: null,
    },
    {
      id: -2, kind: 'WINDOW_OPEN', roomId: 4,
      startAt: dayAt(base, 4, 16), endAt: dayAt(base, 4, 18), issuedAt: dayAt(base, 4, 19, 20),
      why: '다음 팀이 창문이 열려 있다고 신고했고, 관리자가 사진을 보고 정했어요',
      evidence: [
        { at: dayAt(base, 4, 17, 58), source: '예약', text: '퇴실 버튼을 눌렀어요', tone: 'neutral' },
        { at: dayAt(base, 4, 18, 5), source: '신고', text: '다음 팀이 사진 1장과 "창문 열림"을 신고했어요', tone: 'neutral' },
        { at: dayAt(base, 4, 19, 20), source: '관리자', text: '관리자가 사진을 보고 경고 1회를 정했어요', tone: 'neutral' },
      ],
      appeal: {
        status: 'SENT', sentAt: dayAt(base, 3, 10, 12), evidence: [0],
        text: '나갈 때 창문을 닫았어요. 퇴실 버튼을 누른 17:58 뒤에 다음 팀이 들어오기 전 누가 열었을 수도 있어요.',
        answer: null,
      },
    },
    {
      id: -3, kind: 'NO_SHOW', roomId: 1,
      startAt: dayAt(base, 9, 10), endAt: dayAt(base, 9, 12), issuedAt: dayAt(base, 9, 10, 15),
      why: '시작하고 15분 안에 입실 기록이 없었어요',
      evidence: [
        { at: dayAt(base, 9, 10, 2), source: '문 장치', text: '번호를 맞게 넣었지만 장치가 응답하지 않았어요', tone: 'for' },
        { at: dayAt(base, 9, 10, 15), source: '예약', text: '입실 기록이 없어 노쇼로 바뀌었어요', tone: 'neutral' },
      ],
      appeal: {
        status: 'ACCEPTED', sentAt: dayAt(base, 9, 11, 40), evidence: [0],
        text: '10:02에 번호를 맞게 넣었는데 문이 반응하지 않았어요. 다시 봐 주세요.',
        answer: '문 장치 기록을 확인했어요. 장치 문제가 맞아 경고를 물렀어요.',
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

function get(): State {
  const key = keyOf(whoAmI())
  if (!state || stateKey !== key) {
    state = read(key)
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

/** 화면용: 해명을 보내면 다시 그린다 */
export function useWarnings(): WarningRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** 해명 보내기. 틀리면 화면에 보일 문장 */
export function sendAppeal(id: number, text: string, evidence: number[], now = new Date()): string | null {
  const problem = appealProblem(text)
  if (problem) return problem
  const s = get()
  const w = snapshot.find((x) => x.id === id)
  if (!w) return '이 경고를 찾지 못했어요.'
  if (w.appeal) return '이미 해명을 보냈어요.'
  set({ ...s, appeals: { ...s.appeals, [String(id)]: { status: 'SENT', text: text.trim(), sentAt: now.toISOString(), evidence, answer: null } } })
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
