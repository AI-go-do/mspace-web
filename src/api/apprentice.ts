import { useEffect, useSyncExternalStore } from 'react'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import {
  actsAlone, initialTrainees, proposalKey, proposalsFromRooms, score, undoScore,
  type AutoDone, type Proposal, type ScoreResult, type TaskKind, type Trainee,
} from '../lib/apprentice'
import { toRoomView } from '../lib/roomHealth'
import { ENV_SOURCE } from './environment'
import { mockEnvironment } from './environmentMock'

/**
 * AI 수습사원 데이터 창구 (가짜 단계). 화면은 useApprentice()와 아래 함수만 쓴다.
 * core #94(처리안 저장·채점·레벨)가 생기면 이 파일 안쪽만 API 호출로 바꾼다.
 * 지금은 이 브라우저에만 기록하고, [맞아요]를 눌러도 학생에게 아무것도 보내지 않는다(실제 판정·강제 퇴실 API를 부르지 않음)
 */
export interface ApprenticeState {
  trainees: Trainee[]
  inbox: Proposal[]
  done: AutoDone[]
  /** 지금 올라와 있는(또는 처리한) 상황. 상황이 끝나야 같은 방·같은 일을 다시 올린다 */
  activeKeys: string[]
  stats: { auto: number; human: number; undone: number }
  seq: number
}

const KEY = 'mspace.admin.apprentice.v1'
const MAX_DONE = 50

function seed(now: Date): ApprenticeState {
  const ago = (min: number) => new Date(now.getTime() - min * 60_000).toISOString()
  const inbox: Proposal[] = [
    { id: 's1', kind: 'noshow', roomId: 3, createdAt: ago(25), title: '노쇼 처리된 예약 #1037: 그 시각 문 앞 키패드가 꺼져 있었어요',
      plan: '노쇼 벌점을 무르고, 방이 먼저 "제 잘못이에요" 사과 카드를 보내요',
      reasons: ['예약 시작 뒤 15분 동안 입실 없음 → 노쇼', '같은 시각 키패드 신호가 6분 끊김', '입실 번호를 넣은 기록이 오기 전에 끊김'] },
    { id: 's2', kind: 'report', roomId: 2, createdAt: ago(12), title: '어질러짐 신고 #31: 앞 팀 퇴실 사진에 컵이 남아 있어요',
      plan: '"사실"로 판정하자고 제안해요. 바로 전 대표자에게 경고 1회가 가요',
      reasons: ['앞 팀(#1038) 퇴실 사진: 책상 위 컵 3개·종이', '신고자 입실 사진도 같은 모습', '두 사진 사이 다른 예약 없음'] },
  ]
  const done: AutoDone[] = [
    { id: 's3', kind: 'vent', roomId: 1, level: 2, createdAt: ago(16 * 60), doneAt: ago(16 * 60), undone: false,
      title: '9분 뒤 CO2가 1000ppm을 넘을 것 같아요', plan: '대표자에게 "10분 안에 창문을 잠깐 열어 주세요"를 미리 보냈어요', reasons: ['밤 10시 예약 · 예약 5명'] },
    { id: 's4', kind: 'vent', roomId: 5, level: 2, createdAt: ago(13 * 60), doneAt: ago(13 * 60), undone: false,
      title: '12분 뒤 CO2가 1000ppm을 넘을 것 같아요', plan: '대표자에게 "10분 안에 창문을 잠깐 열어 주세요"를 미리 보냈어요', reasons: ['새벽 1시 예약 · 예약 6명'] },
  ]
  return { trainees: initialTrainees(), inbox, done, activeKeys: [], stats: { auto: 0, human: 0, undone: 0 }, seq: 0 }
}

/** 저장된 값이 손으로 고쳐졌거나 모양이 바뀌었으면 쓰지 않는다(아래 함수들이 읽는 칸을 모두 확인) */
function isState(s: ApprenticeState | null): s is ApprenticeState {
  const kinds: string[] = initialTrainees().map((t) => t.kind)
  const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  const isTrainee = (t: Trainee) => !!t && typeof t === 'object' && kinds.includes(t.kind) && typeof t.name === 'string'
    && isNum(t.level) && isNum(t.maxLevel) && isNum(t.streak) && isNum(t.right) && isNum(t.total) && typeof t.locked === 'boolean'
  const isProposal = (p: Proposal) => !!p && typeof p === 'object' && typeof p.id === 'string' && kinds.includes(p.kind)
    && isNum(p.roomId) && typeof p.title === 'string' && typeof p.plan === 'string' && typeof p.createdAt === 'string'
    && Array.isArray(p.reasons) && p.reasons.every((r) => typeof r === 'string')
  const isDone = (d: AutoDone) => isProposal(d) && isNum(d.level) && typeof d.doneAt === 'string' && typeof d.undone === 'boolean'
  return !!s && typeof s === 'object'
    && Array.isArray(s.trainees) && Array.isArray(s.inbox) && Array.isArray(s.done) && Array.isArray(s.activeKeys)
    && isNum(s.seq) && !!s.stats
    && isNum(s.stats.auto) && isNum(s.stats.human) && isNum(s.stats.undone)
    && s.trainees.every(isTrainee) && s.inbox.every(isProposal) && s.done.every(isDone)
    && s.activeKeys.every((k) => typeof k === 'string')
    && kinds.every((k) => s.trainees.some((t) => t.kind === k))
}

function load(): ApprenticeState {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const s = JSON.parse(raw) as ApprenticeState
      // 가짜 방에서 만든 처리안(p…)은 실제 센서 모드에서 되살리지 않는다. 처음 넣어 둔 예시(s…)만 남긴다
      if (isState(s)) return ENV_SOURCE === 'mock' ? s : { ...s, inbox: s.inbox.filter((p) => !p.id.startsWith('p')) }
    }
  } catch {
    /* 저장소 없음·깨짐: 처음부터 */
  }
  return seed(new Date())
}

let state: ApprenticeState | null = null
const listeners = new Set<() => void>()
/** 마지막으로 한 일의 결과 (화면 안내 한 줄) */
export interface ApprenticeNotice { text: string; kind?: TaskKind; result?: ScoreResult }
let notice: ApprenticeNotice | null = null

function get(): ApprenticeState {
  if (!state) state = load()
  return state
}

function set(next: ApprenticeState, n?: ApprenticeNotice) {
  state = next
  if (n) notice = n
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 저장 못 해도 화면은 그대로 */ }
  listeners.forEach((fn) => fn())
}

function subscribe(fn: () => void) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

const trainee = (s: ApprenticeState, kind: TaskKind) => s.trainees.find((t) => t.kind === kind)!
const replaceTrainee = (s: ApprenticeState, t: Trainee) => s.trainees.map((x) => (x.kind === t.kind ? t : x))

/** 방 상태를 보고 새 처리안을 만든다. 레벨 2 이상인 일은 AI가 먼저 처리하고 기록만 남긴다 */
export function refreshApprentice(now = new Date()): void {
  // 실제 센서 값(api)을 쓸 때 가짜 방에서 만든 처리안을 옆에 띄우지 않는다. 처리안은 core #94가 생기면 그쪽에서 받는다
  if (ENV_SOURCE !== 'mock') return
  const s = get()
  const env = mockEnvironment(now, ENV_RULES.historyMinutes)
  const views = env.rooms.map((r) => toRoomView(r, ADMIN_ROOMS.find((c) => c.roomId === r.roomId), now))
  const found = proposalsFromRooms(views, now)
  const foundKeys = new Set(found.map((p) => proposalKey(p.kind, p.roomId)))
  // 상황이 끝난 것은 다시 올릴 수 있게 지운다. 아직 사람이 안 본 처리안은 남긴다
  const waiting = new Set(s.inbox.map((p) => proposalKey(p.kind, p.roomId)))
  const activeKeys = s.activeKeys.filter((k) => foundKeys.has(k) || waiting.has(k))
  let { inbox, done, trainees, seq } = s
  let auto = 0
  let first: string | null = null
  for (const p of found) {
    const key = proposalKey(p.kind, p.roomId)
    if (activeKeys.includes(key)) continue
    activeKeys.push(key)
    const id = `p${++seq}`
    const t = trainees.find((x) => x.kind === p.kind)!
    if (actsAlone(t)) {
      done = [{ ...p, id, level: t.level as 2 | 3, doneAt: p.createdAt, undone: false }, ...done].slice(0, MAX_DONE)
      auto++
      first ??= `AI가 먼저 처리했어요 · 창작실 ${p.roomId} ${t.name}`
    } else {
      inbox = [...inbox, { ...p, id }]
    }
  }
  if (seq === s.seq && activeKeys.join() === s.activeKeys.join()) return
  set({ ...s, inbox, done, trainees, activeKeys, seq, stats: { ...s.stats, auto: s.stats.auto + auto } }, first ? { text: first } : undefined)
}

/** [맞아요] / [아니에요]. 가짜 단계라 실제로 보내는 것은 없다 */
export function decideProposal(id: string, ok: boolean, reason?: string): void {
  const s = get()
  const p = s.inbox.find((x) => x.id === id)
  if (!p) return
  const before = trainee(s, p.kind)
  const { next, result } = score(before, ok)
  let text: string
  if (result === 'up') text = `${next.name} 레벨 ${next.level} · 이제 AI가 먼저 처리하고 아침에 보고해요`
  else if (!ok) text = `"${reason ?? '아니에요'}" 기록 · ${next.name} ${result === 'down' ? `레벨 ${before.level} → ${next.level}` : '연속 기록이 0으로'}`
  else if (next.locked) text = '처리했어요. 벌이 걸린 일이라 점수와 상관없이 늘 사람이 정해요'
  else if (next.level >= next.maxLevel) text = `처리했어요 · ${next.name} · 가장 높은 단계예요`
  else text = `처리했어요 · ${next.name} 연속 ${next.streak}/10`
  set({
    ...s,
    trainees: replaceTrainee(s, next),
    inbox: s.inbox.filter((x) => x.id !== id),
    stats: { ...s.stats, human: s.stats.human + 1 },
  }, { text, kind: p.kind, result })
}

/** AI가 먼저 처리한 일 되돌리기: 틀린 것과 같이 세어 그 일은 한 단계 내려간다 */
export function undoAutoDone(id: string): void {
  const s = get()
  const d = s.done.find((x) => x.id === id)
  if (!d || d.undone) return
  const before = trainee(s, d.kind)
  const { next, result } = undoScore(before)
  // 같은 일을 두 번 되돌리면 이미 레벨 1이라 연속 기록만 0이 된다
  const text = result === 'down'
    ? `되돌렸어요 · ${next.name} 레벨 ${before.level} → ${next.level}. 다음부터 다시 먼저 물어봐요`
    : `되돌렸어요 · ${next.name} 연속 기록이 0이 됐어요. 이미 레벨 ${next.level}이라 계속 먼저 물어봐요`
  set({
    ...s,
    trainees: replaceTrainee(s, next),
    done: s.done.map((x) => (x.id === id ? { ...x, undone: true } : x)),
    stats: { ...s.stats, undone: s.stats.undone + 1 },
  }, { text, kind: d.kind, result })
}

/** 시연용: 가짜 기록을 처음으로 */
export function resetApprentice(): void {
  set(seed(new Date()), { text: '가짜 기록을 처음으로 돌렸어요' })
}

export function useApprentice(): { state: ApprenticeState; notice: ApprenticeNotice | null } {
  const s = useSyncExternalStore(subscribe, get, get)
  return { state: s, notice }
}

/** 관리자 화면에 있는 동안 10초마다 새 처리안을 확인한다 */
export function useApprenticeFeed(): void {
  useEffect(() => {
    refreshApprentice()
    const t = setInterval(() => refreshApprentice(), ENV_RULES.pollMs)
    return () => clearInterval(t)
  }, [])
}

/** 테스트용: 지금 상태 */
export function _peekForTest(): ApprenticeState {
  return get()
}

/** 테스트용: 마지막 안내 한 줄 */
export function _noticeForTest(): ApprenticeNotice | null {
  return notice
}

/** 테스트용: 저장된 값 검사 */
export const _isStateForTest = isState

/** 테스트용: 모듈 상태를 비운다 */
export function _resetForTest(s?: ApprenticeState): void {
  state = s ?? null
  notice = null
}
