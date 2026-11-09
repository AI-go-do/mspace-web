/**
 * 벌점 해명 카드 (웹 화면만, 11/8 재웅 승인). 학생이 경고 옆에서 "왜 받았는지"와 근거 기록을 보고 해명을 적어 보낸다.
 * core에 경고 내역·해명 API가 아직 없어서 지금은 주소에 ?demo=1일 때만 예시로 보여 준다(api/appeal.ts).
 * 화면과 예시 저장소가 같이 쓰는 순수 함수만 둔다(시각은 밖에서 받는다)
 */
import { seoulClock } from './time'

/** 경고 종류. 노쇼는 따로 세고(30일 2번이면 정지), 나머지는 신고 판정으로 받은 위반 경고 */
export type WarningKind = 'NO_SHOW' | 'MESSY' | 'WINDOW_OPEN' | 'BROKEN' | 'NOISE'

export const WARNING_LABEL: Record<WarningKind, string> = {
  NO_SHOW: '노쇼',
  MESSY: '어질러짐',
  WINDOW_OPEN: '창문 열림',
  BROKEN: '비품 고장',
  NOISE: '소란',
}

/** 근거 기록 한 줄. for=학생에게 유리한 기록(해명에 쓸 만함), neutral=판정에 쓰인 기록 */
export interface Evidence {
  at: string
  /** 어디서 남은 기록인지 ("문 장치", "예약", "신고", "관리자") */
  source: string
  text: string
  tone: 'for' | 'neutral'
}

export type AppealStatus = 'SENT' | 'ACCEPTED' | 'REJECTED'

export interface Appeal {
  status: AppealStatus
  text: string
  sentAt: string
  /** 같이 보낸 근거 (Evidence 순서 번호) */
  evidence: number[]
  /** 관리자 답 (받아들임·거절일 때) */
  answer: string | null
}

export interface WarningRecord {
  id: number
  kind: WarningKind
  roomId: number
  /** 경고가 걸린 예약 시간 */
  startAt: string
  endAt: string
  issuedAt: string
  /** 한 줄 이유 ("14:15까지 입실 기록이 없었어요") */
  why: string
  evidence: Evidence[]
  appeal: Appeal | null
}

export const APPEAL_RULES = {
  /** 경고를 받은 뒤 며칠 안에 해명할 수 있는지 (가짜 단계 가정. core가 정하면 그 값을 쓴다) */
  days: 7,
  minChars: 10,
  maxChars: 500,
}

/** 해명할 수 있는지: 아직 안 보냈고, 받은 지 정해진 날 안 */
export function canAppeal(w: WarningRecord, now: Date, rules = APPEAL_RULES): boolean {
  if (w.appeal) return false
  return now.getTime() - Date.parse(w.issuedAt) < rules.days * 86_400_000
}

/** 해명 마감까지 남은 날 (오늘 마감이면 0). 이미 지났으면 null */
export function daysLeft(w: WarningRecord, now: Date, rules = APPEAL_RULES): number | null {
  const left = Date.parse(w.issuedAt) + rules.days * 86_400_000 - now.getTime()
  if (left <= 0) return null
  return Math.floor(left / 86_400_000)
}

const clock = (iso: string) => seoulClock(new Date(iso))

/**
 * 기록에서 고른 근거로 해명 초안을 쓴다(지금은 규칙으로 문장을 잇는다. 나중에 비서가 쓰면 이 함수만 바꾼다).
 * 숫자·시각은 근거 기록에 있는 것만 쓰고, 이름·학번은 넣지 않는다
 */
export function draftAppeal(w: WarningRecord, picked: number[] = forEvidence(w)): string {
  const lines = picked.map((i) => w.evidence[i]).filter((e): e is Evidence => !!e)
  const room = `${w.roomId}번 방`
  const head = `${room} ${clock(w.startAt)}–${clock(w.endAt)} 예약의 ${WARNING_LABEL[w.kind]} 경고를 다시 봐 주세요.`
  if (lines.length === 0) return `${head}\n`
  const body = lines.map((e) => `${clock(e.at)}에 ${e.text.replace(/[.。]$/, '')}`).join(', ')
  const tail = w.kind === 'NO_SHOW' ? '제때 왔지만 문이 열리지 않아 못 들어갔어요.' : '제가 쓴 시간에 생긴 일이 아니에요.'
  return `${head}\n기록을 보면 ${body}. ${tail}`
}

/** 학생에게 유리한 근거 번호 (초안·같이 보낼 기록 기본값) */
export function forEvidence(w: WarningRecord): number[] {
  return w.evidence.flatMap((e, i) => (e.tone === 'for' ? [i] : []))
}

const PHONE = /01[016789][-\s.]?\d{3,4}[-\s.]?\d{4}/
const LONG_NUMBER = /\d{8,}/
/** 2026-11-06 같은 온전한 날짜만 학번으로 보지 않는다(2023-12-3456처럼 뒤에 숫자가 더 붙거나 없는 달·날은 빼지 않음) */
const DATE = /(?<!\d)(\d{4})[-./](0?[1-9]|1[0-2])[-./](0?[1-9]|[12]\d|3[01])(?!\d)/g
/** 달력에 있는 날짜만 지운다(2023-02-30처럼 없는 날은 남겨서 학번 검사에 걸리게) */
const dropRealDates = (t: string) =>
  t.replace(DATE, (m, y: string, mo: string, d: string) => (Number(d) <= new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate() ? ' ' : m))

/** 보내기 전에 막을 것. 문제가 없으면 null */
export function appealProblem(text: string, rules = APPEAL_RULES): string | null {
  const t = text.trim()
  if (t.length < rules.minChars) return `${rules.minChars}자 넘게 적어 주세요.`
  if (t.length > rules.maxChars) return `${rules.maxChars}자까지 쓸 수 있어요.`
  // 관리자는 예약 번호로 찾는다. 전화번호·학번은 적지 않게 막는다(개인정보를 남기지 않는 원칙)
  if (PHONE.test(t) || LONG_NUMBER.test(dropRealDates(t).replace(/[-\s]/g, ''))) return '전화번호·학번은 빼고 적어 주세요. 관리자는 예약 번호로 찾아요.'
  return null
}

/** 카드에 붙는 상태 글 */
export function statusLabel(w: WarningRecord, now: Date, rules = APPEAL_RULES): { text: string; tone: 'open' | 'wait' | 'done' | 'no' | 'closed' } {
  if (w.appeal?.status === 'SENT') return { text: '검토 중', tone: 'wait' }
  if (w.appeal?.status === 'ACCEPTED') return { text: '무름', tone: 'done' }
  if (w.appeal?.status === 'REJECTED') return { text: '그대로', tone: 'no' }
  const left = daysLeft(w, now, rules)
  if (left === null) return { text: '해명 기간 끝남', tone: 'closed' }
  return { text: left === 0 ? '오늘까지 해명' : `${left}일 안 해명`, tone: 'open' }
}

/** 해명 진행 세 칸: 보냄 → 관리자 확인 → 결과 (몇 칸까지 찼는지) */
export function appealStep(a: Appeal | null): 0 | 1 | 2 | 3 {
  if (!a) return 0
  return a.status === 'SENT' ? 1 : 3
}
