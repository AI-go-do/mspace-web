import { ADMIN_ROOMS } from '../config/adminRooms'
import type { BlockReason } from './roomBlocks'
import { seoulDate } from './time'

/**
 * 공지 한 줄 → 기간 막기 초안 (웹 화면만, 11/8 재웅 승인).
 * 관리자가 교학팀 공지 문장("11/12(목) 9시~12시 5번 방 에어컨 점검")을 붙여 넣으면 날짜·시각·방·사유를 읽어 막기안을 만든다.
 * 지금은 규칙(정규식)으로 읽는다. 나중에 AI로 바꿀 때 parseNotice만 바꾸고 화면은 그대로 둔다.
 * 확실하지 않게 읽은 것은 notes에 적어 관리자가 확인하게 하고, 막기는 늘 관리자가 누른다
 */
export type SpanKind = 'date' | 'time' | 'room' | 'reason'

export interface Span { start: number; end: number; kind: SpanKind }

export interface DraftRow { roomId: number; startAt: string; endAt: string }

export interface NoticeDraft {
  rows: DraftRow[]
  reason: BlockReason
  memo: string
  /** 공지 글에서 읽은 곳 (화면에서 밑줄) */
  spans: Span[]
  /** 짐작한 것. 관리자가 꼭 확인해야 함 */
  notes: string[]
  /** 막기안을 못 만든 이유 (없으면 null) */
  problem: string | null
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']
const ROOM_IDS = ADMIN_ROOMS.map((r) => r.roomId)

interface YMD { y: number; m: number; d: number }

const ymd = (s: string): YMD => { const [y, m, d] = s.split('-').map(Number); return { y, m, d } }
const iso = (v: YMD) => `${v.y}-${String(v.m).padStart(2, '0')}-${String(v.d).padStart(2, '0')}`
const addDays = (v: YMD, n: number): YMD => {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d + n))
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() }
}
const weekday = (v: YMD) => new Date(Date.UTC(v.y, v.m - 1, v.d)).getUTCDay()
const cmp = (a: YMD, b: YMD) => iso(a).localeCompare(iso(b))

/** 연도가 없는 월·일: 올해로 두되, 오늘보다 두 달 넘게 앞이면 내년으로 (12월에 1월 공지를 붙여 넣는 경우) */
function withYear(m: number, d: number, today: YMD): YMD {
  const v = { y: today.y, m, d }
  return cmp(v, addDays(today, -60)) < 0 ? { ...v, y: today.y + 1 } : v
}

// 달마다 마지막 날(2월은 29일까지 받고, 해가 정해진 뒤 at()이 틀린 날을 Invalid Date로 거른다)
const MONTH_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
const validDay = (m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= MONTH_DAYS[m - 1]

interface Hit<T> { value: T; start: number; end: number }

/** 날짜 하나 (범위 앞쪽·뒤쪽에 다 쓴다). 찾은 위치와 값 */
function findDates(text: string, today: YMD): Hit<YMD>[] {
  const out: Hit<YMD>[] = []
  const push = (value: YMD, start: number, end: number) => {
    if (out.some((h) => start < h.end && h.start < end)) return
    out.push({ value, start, end })
  }
  // 11월 12일 / 11/12 / 11.12 (뒤에 요일 괄호가 붙어도)
  for (const m of text.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const mo = Number(m[1]); const d = Number(m[2])
    if (validDay(mo, d)) push(withYear(mo, d, today), m.index!, m.index! + m[0].length)
  }
  for (const m of text.matchAll(/(?<![\d:])(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d:]|\s*(?:시|번|분))\.?/g)) {
    const mo = Number(m[1]); const d = Number(m[2])
    if (validDay(mo, d)) push(withYear(mo, d, today), m.index!, m.index! + m[0].length)
  }
  // 오늘·내일·모레
  for (const m of text.matchAll(/오늘|내일|모레|글피/g)) {
    const n = { 오늘: 0, 내일: 1, 모레: 2, 글피: 3 }[m[0] as '오늘']
    push(addDays(today, n), m.index!, m.index! + m[0].length)
  }
  // (이번 주|다음 주|담주) X요일
  for (const m of text.matchAll(/(이번\s*주|다음\s*주|담주|차주)?\s*([일월화수목금토])요일/g)) {
    const want = WEEKDAYS.indexOf(m[2])
    const start = m.index! + (m[0].length - m[0].trimStart().length)
    let v: YMD
    if (m[1] && !m[1].startsWith('이번')) {
      // 다음 주 월요일부터 세서 그 요일
      const toMon = (8 - weekday(today)) % 7 || 7
      const mon = addDays(today, toMon)
      v = addDays(mon, (want + 6) % 7)
    } else {
      v = addDays(today, (want - weekday(today) + 7) % 7)
    }
    push(v, start, m.index! + m[0].length)
  }
  return out.sort((a, b) => a.start - b.start)
}

/** 12일~14일, 11/12~11/14, 12일부터 14일까지 처럼 앞 날짜 바로 뒤의 끝 날짜 */
function rangeEnd(text: string, from: Hit<YMD>, dates: Hit<YMD>[], today: YMD): Hit<YMD> | null {
  const rest = text.slice(from.end)
  const sep = rest.match(/^\s*(?:\([^)]{1,3}\))?\s*(?:~|-|–|부터|에서)\s*/)
  if (!sep) return null
  const at = from.end + sep[0].length
  const next = dates.find((h) => h.start === at)
  if (next) return next
  const day = text.slice(at).match(/^(\d{1,2})\s*일/)
  if (day) {
    const d = Number(day[1])
    // "30일~2일"처럼 앞보다 작으면 다음 달
    const v = d >= from.value.d ? { ...from.value, d } : withYear(from.value.m % 12 + 1, d, today)
    if (!validDay(v.m, d)) return null
    return { value: v, start: at, end: at + day[0].length }
  }
  return null
}

interface Clock { h: number; min: number }

/** 시각들: 14:00 / 오후 2시 / 2시 반 / 9시 30분 */
function findTimes(text: string): Hit<Clock & { meridiem: string | null }>[] {
  const out: Hit<Clock & { meridiem: string | null }>[] = []
  for (const m of text.matchAll(/(오전|오후|낮|저녁|밤|아침)?\s*(\d{1,2})\s*(?::\s*(\d{2})|시\s*(?:(\d{1,2})\s*분|(반))?)/g)) {
    const h = Number(m[2])
    const min = m[3] ? Number(m[3]) : m[4] ? Number(m[4]) : m[5] ? 30 : 0
    if (h > 24 || min > 59 || (h === 24 && min > 0)) continue
    const start = m.index! + (m[0].length - m[0].trimStart().length)
    out.push({ value: { h, min, meridiem: m[1] ?? null }, start, end: m.index! + m[0].length })
  }
  return out
}

function to24(t: Clock & { meridiem: string | null }, notes: string[]): Clock {
  const { h, min, meridiem } = t
  if (meridiem && /오후|저녁|밤/.test(meridiem) && h < 12) return { h: h + 12, min }
  if (meridiem && /낮/.test(meridiem) && h < 7) return { h: h + 12, min }
  if (meridiem && /오전|아침/.test(meridiem) && h === 12) return { h: 0, min }
  if (!meridiem && h >= 1 && h <= 7) {
    notes.push(`"${h}시"는 오후 ${h}시로 읽었어요.`)
    return { h: h + 12, min }
  }
  return { h, min }
}

/** 방: "1·2번 방", "1, 3번 방", "1~3번 방", "창작실 3", "전체 방" */
function findRooms(text: string): { ids: number[]; unknown: number[]; spans: Span[]; all: boolean } {
  const ids = new Set<number>()
  const spans: Span[] = []
  let all = false
  const take = (list: string) => {
    for (const part of list.split(/\s*[,·/와과및]\s*/)) {
      const r = part.match(/^(\d)\s*[~\-–]\s*(\d)$/)
      if (r) { for (let i = Number(r[1]); i <= Number(r[2]); i++) ids.add(i); continue }
      const n = Number(part.trim())
      if (Number.isInteger(n)) ids.add(n)
    }
  }
  for (const m of text.matchAll(/((?:\d\s*(?:[,·/와과및~\-–]|,\s)\s*)*\d)\s*번\s*(?:방|실|창작실)|(?:창작실|방)\s*((?:\d\s*[,·/~\-–]\s*)*\d)(?!\s*[시:일월분])/g)) {
    take(m[1] ?? m[2])
    spans.push({ start: m.index!, end: m.index! + m[0].length, kind: 'room' })
  }
  for (const m of text.matchAll(/(?:전체|모든|전|M-?space\s*전체)\s*(?:방|호실|창작실)|M-?space\s*전체/gi)) {
    all = true
    spans.push({ start: m.index!, end: m.index! + m[0].length, kind: 'room' })
  }
  const sorted = [...ids].sort((a, b) => a - b)
  return { ids: sorted.filter((i) => ROOM_IDS.includes(i)), unknown: sorted.filter((i) => !ROOM_IDS.includes(i)), spans, all }
}

const REASONS: { reason: BlockReason; words: RegExp }[] = [
  { reason: 'CONSTRUCTION', words: /공사|보수|리모델링|교체|설치|철거|도색/ },
  { reason: 'INSPECTION', words: /점검|청소|소독|방역|정비|수리|검사/ },
  { reason: 'RENTAL', words: /대관|행사|특강|설명회|세미나|시험|면접|워크숍|회의/ },
]

/** 사유와 메모 ("에어컨 점검"): 사유 낱말과 그 앞 낱말 하나 */
function findReason(text: string): { reason: BlockReason; memo: string; span: Span | null } {
  for (const r of REASONS) {
    const m = text.match(r.words)
    if (!m) continue
    const at = m.index!
    const before = text.slice(0, at).match(/([가-힣A-Za-z0-9]+)\s*$/)
    const word = text.slice(at).match(/^[가-힣]+/)![0].replace(/(으로|로|를|을|이|가|은|는|때문에|관계로|및|과|와|에)$/, '')
    const lead = before && !/^\d|[일시분방실]$/.test(before[1]) ? `${before[1]} ` : ''
    const start = before && lead ? at - before[0].length : at
    return { reason: r.reason, memo: `${lead}${word}`.trim(), span: { start, end: at + word.length, kind: 'reason' } }
  }
  return { reason: 'OTHER', memo: '', span: null }
}

/** 해까지 정해진 뒤 실제로 있는 날인지(2027-02-29 같은 날은 Date가 다음 달로 넘겨 버린다) */
const realDay = (v: YMD) => {
  const t = new Date(Date.UTC(v.y, v.m - 1, v.d))
  return t.getUTCMonth() === v.m - 1 && t.getUTCDate() === v.d
}
/** 서울 시각. 없는 날은 Invalid Date */
const at = (v: YMD, c: Clock) => {
  if (!realDay(v)) return new Date(NaN)
  return new Date(`${iso(v)}T${String(c.h).padStart(2, '0')}:${String(c.min).padStart(2, '0')}:00+09:00`)
}
const SLOT = 30 * 60_000
const floorSlot = (d: Date) => new Date(Math.floor(d.getTime() / SLOT) * SLOT)
const ceilSlot = (d: Date) => new Date(Math.ceil(d.getTime() / SLOT) * SLOT)

/** 공지 글 → 막기안. now는 "내일"·"수요일"을 셀 기준(서울 날짜) */
export function parseNotice(text: string, now: Date): NoticeDraft {
  const notes: string[] = []
  const spans: Span[] = []
  const t = text.replace(/\r/g, '')
  const today = ymd(seoulDate(now))
  const empty = (problem: string): NoticeDraft => ({ rows: [], reason: 'OTHER', memo: '', spans, notes, problem })
  if (!t.trim()) return empty('공지 문장을 붙여 넣어 주세요.')

  // 날짜
  // "방 1/2"처럼 방 이름 바로 뒤 한 자리 숫자 목록은 날짜(1월 2일)가 아니라 방 번호로 본다
  // "방 1/12"처럼 목록 뒤에 /·. 와 숫자가 더 붙으면 날짜이므로 앞부분(방 1)만 따로 가리지 않는다
  const roomLists = [...t.matchAll(/(?:창작실|방)\s*\d(?:\s*[,·/~\-–]\s*\d)*(?!\d|\s*[/.]\s*\d)/g)].map((m) => ({ start: m.index!, end: m.index! + m[0].length }))
  const dates = findDates(t, today).filter((d) => !roomLists.some((r) => d.start < r.end && r.start < d.end))
  if (dates.length === 0) {
    const r = findRooms(t); spans.push(...r.spans)
    return empty('날짜를 못 찾았어요. "11월 12일", "11/12", "내일", "다음 주 수요일"처럼 적어 주세요.')
  }
  const first = dates[0]
  const end = rangeEnd(t, first, dates, today)
  // 범위 끝이 없는 날(2027년 2월 29일 등)이면 addDays가 3월로 넘겨 하루를 빠뜨리므로 여기서 되묻는다
  if (!realDay(first.value) || (end && !realDay(end.value))) {
    return empty('없는 날짜예요. 공지의 날짜를 확인해 주세요.')
  }
  const lastDay = end && cmp(end.value, first.value) > 0 ? end.value : first.value
  spans.push({ start: first.start, end: first.end, kind: 'date' })
  if (end) spans.push({ start: end.start, end: end.end, kind: 'date' })
  // "11월 12일 목요일"처럼 같은 날을 두 번 적은 것은 다른 날짜로 세지 않는다
  const readDays = new Set([iso(first.value), ...(end ? [iso(end.value)] : [])])
  const otherDates = dates.filter((d) => d !== first && d.start !== end?.start && !readDays.has(iso(d.value)))
  if (otherDates.length) notes.push(`날짜가 여러 개라 첫 날짜${end ? '(범위)' : ''}만 읽었어요. 나머지는 따로 막아 주세요.`)

  // 시각: 날짜 안에 들어간 숫자는 빼고, 처음 두 개를 시작·끝으로
  const dateSpans = spans.filter((s) => s.kind === 'date')
  const times = findTimes(t).filter((h) => !dateSpans.some((s) => h.start < s.end && s.start < h.end)
    && !dates.some((d) => h.start < d.end && d.start < h.end))
  const allDay = /종일|하루\s*(?:동안|내내)|전일/.test(t)
  let startClock: Clock = { h: 0, min: 0 }
  let endClock: Clock | null = null
  if (times.length >= 1 && !allDay) {
    startClock = to24(times[0].value, notes)
    spans.push({ start: times[0].start, end: times[0].end, kind: 'time' })
    if (times.length >= 2) {
      const e = times[1].value
      // "오후 2시~5시"는 끝도 오후
      const inherit = !e.meridiem && times[0].value.meridiem ? { ...e, meridiem: times[0].value.meridiem } : e
      const quiet: string[] = []
      endClock = to24(inherit, e.meridiem || times[0].value.meridiem ? quiet : notes)
      if (endClock.h < startClock.h && endClock.h + 12 <= 24 && !e.meridiem) endClock = { ...endClock, h: endClock.h + 12 }
      spans.push({ start: times[1].start, end: times[1].end, kind: 'time' })
    } else {
      notes.push('끝 시각이 없어 그날 밤 12시까지로 읽었어요.')
    }
  } else if (!allDay) {
    notes.push('시각이 없어 하루 종일로 읽었어요.')
  }

  // 방
  // 날짜·시각 안의 숫자(11/12, 13:05)를 방 번호로 읽지 않게 같은 길이의 공백으로 가린다(위치는 그대로)
  const masked = [...dates, ...findTimes(t)].reduce((acc, h) => acc.slice(0, h.start) + ' '.repeat(h.end - h.start) + acc.slice(h.end), t)
  const rooms = findRooms(masked)
  spans.push(...rooms.spans)
  let ids = rooms.all ? [...ROOM_IDS] : rooms.ids
  // 공지가 방 번호를 적었는데 모두 없는 방이면 모든 방으로 넘겨짚지 않고 되묻는다
  if (!rooms.all && rooms.spans.length > 0 && ids.length === 0) {
    const which = rooms.unknown.length > 0 ? `${rooms.unknown.join(', ')}번 방은 없어요` : '방 번호를 읽지 못했어요'
    return empty(`${which}(1~${ROOM_IDS.length}번). 공지의 방 번호를 확인해 주세요.`)
  }
  if (!rooms.all && rooms.unknown.length > 0) {
    notes.push(`${rooms.unknown.join(', ')}번 방은 없어요(1~${ROOM_IDS.length}번). 그 방은 빼고 읽었어요.`)
  }
  if (ids.length === 0) {
    ids = [...ROOM_IDS]
    notes.push('방 번호가 없어 모든 방으로 읽었어요. 맞는지 꼭 확인해 주세요.')
  }

  // 사유
  const r = findReason(t)
  if (r.span) spans.push(r.span)
  else notes.push('사유 낱말(공사·점검·대관)이 없어 "기타"로 읽었어요.')
  const memo = (r.memo || t.trim().replace(/\s+/g, ' ')).slice(0, 40)

  // 기간: 시각이 있고 여러 날이면 날마다 같은 시각, 아니면 첫날 시작부터 끝날 끝까지 한 번에
  const rows: DraftRow[] = []
  const days: YMD[] = []
  for (let d = first.value; cmp(d, lastDay) <= 0 && days.length < 32; d = addDays(d, 1)) days.push(d)
  // 시각이 있는 기간은 날마다 한 줄이라 32일에서 자른다. 잘린 날이 막히지 않은 채 "막았어요"가 되지 않게 되묻는다
  if (endClock !== null && cmp(days[days.length - 1], lastDay) < 0) {
    return { ...empty('시각이 있는 기간은 32일까지 읽을 수 있어요. 공지를 나누어 넣어 주세요.'), reason: r.reason, memo }
  }
  const daily = endClock !== null && days.length > 1
  const spansOf: [Date, Date][] = daily
    ? days.map((d) => [at(d, startClock), at(d, endClock!)])
    : [[at(days[0], startClock), endClock ? at(lastDay, endClock) : at(addDays(lastDay, 1), { h: 0, min: 0 })]]
  // 2월 30일 같은 없는 날·시각은 Date가 넘겨 버리거나 Invalid Date가 되니 여기서 멈춘다
  if (spansOf.some(([s, e]) => Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()))) {
    return { ...empty('날짜나 시각을 읽을 수 없어요. 공지의 날짜와 시각을 확인해 주세요.'), reason: r.reason, memo }
  }
  for (const [s0, e0] of spansOf) {
    const s = floorSlot(s0); const e = ceilSlot(e0)
    if (s.getTime() !== s0.getTime() || e.getTime() !== e0.getTime()) {
      const note = '30분 칸에 맞춰 시작은 앞으로, 끝은 뒤로 넓혔어요.'
      if (!notes.includes(note)) notes.push(note)
    }
    for (const roomId of ids) rows.push({ roomId, startAt: s.toISOString(), endAt: e.toISOString() })
  }
  if (daily) notes.push(`${days.length}일 동안 날마다 같은 시각으로 막아요.`)
  if (spansOf.some(([s, e]) => e.getTime() <= s.getTime())) return { ...empty('끝 시각이 시작보다 앞이에요. 공지의 시각을 확인해 주세요.'), reason: r.reason, memo }

  spans.sort((a, b) => a.start - b.start)
  return { rows, reason: r.reason, memo, spans, notes, problem: null }
}

/** 화면 밑줄용: 공지 글을 읽은 곳과 아닌 곳으로 자른다(겹치면 앞의 것) */
export function splitBySpans(text: string, spans: Span[]): { text: string; kind: SpanKind | null }[] {
  const out: { text: string; kind: SpanKind | null }[] = []
  let i = 0
  for (const s of [...spans].sort((a, b) => a.start - b.start)) {
    if (s.start < i) continue
    if (s.start > i) out.push({ text: text.slice(i, s.start), kind: null })
    out.push({ text: text.slice(s.start, s.end), kind: s.kind })
    i = s.end
  }
  if (i < text.length) out.push({ text: text.slice(i), kind: null })
  return out
}

/** 붙여 넣기 예시 (화면의 예시 칩) */
export const NOTICE_EXAMPLES = [
  '[교학팀] 11월 12일(목) 오전 9시~12시 5번 방 에어컨 점검으로 사용할 수 없습니다.',
  '다음 주 화요일 2시부터 5시까지 1·2번 방 학과 특강 대관 예정',
  '11/16~11/17 M-space 전체 바닥 공사로 이용 불가',
]
