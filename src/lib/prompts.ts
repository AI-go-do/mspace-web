/**
 * 비서 화면의 "추천 말" 버튼(클릭만으로 이어 가기).
 * 누르면 message를 그대로 채팅으로 보낸다. next가 있으면 보내지 않고 다음 단계 버튼을 펼친다(화면 안에서만, 서버 안 부름).
 * 보낸 뒤 이어지는 버튼은 서버 답의 suggestions(빠른 답장, assistant #73)가 정한다 → 확인 카드 → [확인].
 * 문장은 서버 지름길·도구와 맞춘다:
 * - "브리핑"이 들어가면 모델 없이 바로 답한다(assistant #82)
 * - "지난번처럼"은 끝난 예약을 보고 같은 조건으로 잡는다(#79)
 * - "이번 주 수업 끝나고"는 week_plan(#76)
 */
export interface PromptChip {
  /** 버튼 글 */
  label: string
  /** 보낼 말. next가 있으면 없음 */
  message?: string
  /** 한 단계 더 고르는 버튼 */
  next?: PromptChip[]
}

export const BOOK_STEPS: PromptChip[] = [
  { label: '지금 바로 1시간', message: '지금 바로 1시간 쓸게' },
  { label: '오늘 저녁 6시', message: '오늘 저녁 6시에 2시간 빈 방 있어?' },
  { label: '내일 오후 2시', message: '내일 오후 2시에 2시간 빈 방 있어?' },
  { label: '수업 끝나고', message: '오늘 수업 끝나고 쓸 수 있는 빈 방 찾아 줘' },
  { label: '지난번처럼', message: '지난번처럼 잡아 줘' },
]

export const SCHEDULE_STEPS: PromptChip[] = [
  { label: '오늘 수업', message: '오늘 내 시간표 보여 줘' },
  { label: '내일 수업', message: '내일 내 시간표 보여 줘' },
  { label: '이번 주 수업 뒤 빈 칸', message: '이번 주 수업 끝나고 쓸 수 있는 빈 칸 알려 줘' },
]

export const MY_STEPS: PromptChip[] = [
  { label: '내 예약 보기', message: '내 예약 보여 줘' },
  { label: '입실 QR', message: '입실 QR 보여 줘' },
  { label: '예약 취소', message: '내 예약 취소해 줘' },
  { label: '연장하기', message: '지금 예약 30분 연장해 줘' },
  { label: '퇴실하기', message: '지금 퇴실할게' },
]

/** 첫 화면·입력 칸 위에 늘 있는 큰 메뉴 */
export const MAIN_PROMPTS: PromptChip[] = [
  { label: '오늘 브리핑', message: '오늘 브리핑 해 줘' },
  { label: '방 예약', next: BOOK_STEPS },
  { label: '지금 빈 방', message: '지금 빈 방 있어?' },
  { label: '시간표', next: SCHEDULE_STEPS },
  { label: '내 예약', next: MY_STEPS },
  { label: '사용 규칙', message: '방 사용 규칙 알려 줘' },
]

/** 펼친 단계에서 앞으로 돌아가는 버튼 글 */
export const BACK_LABEL = '‹ 처음'

/** 모든 보낼 말(테스트·측정용) */
export function allMessages(chips: PromptChip[] = MAIN_PROMPTS): string[] {
  return chips.flatMap((c) => [...(c.message ? [c.message] : []), ...allMessages(c.next ?? [])])
}

/** 입력 칸을 눌렀는데 아직 아무것도 안 쳤을 때 보여 줄 말 */
export const STARTERS: string[] = ['오늘 브리핑 해 줘', '지금 빈 방 있어?', '오늘 수업 끝나고 쓸 수 있는 빈 방 찾아 줘', '내 예약 보여 줘']

/**
 * 친 말에서 날짜·시각·길이를 뽑아 문장을 만든다(정해진 목록 밖 말도 이어 주려고).
 * 예: "모레 4시" → "모레 오후 4시에 2시간 빈 방 있어?", "모레 오후 4시부터 2시간 예약해 줘".
 * 날짜만 있으면 그날 수업 뒤 빈 방·시간표. 오전·오후가 없고 1~8시면 오후로 본다(수업 뒤 쓰는 방이라)
 */
export function fillTemplates(query: string): string[] {
  const q = query.trim()
  const day = q.match(/(오늘|내일|모레|글피|이번\s*주\s*[월화수목금토일]요일|다음\s*주\s*[월화수목금토일]요일|[월화수목금토일]요일|\d{1,2}월\s*\d{1,2}일|\d{1,2}일)/)?.[0]
  const t = q.match(/(오전|오후|저녁|아침|밤)?\s*(\d{1,2})\s*시\s*(반|30분)?/)
  const dur = q.match(/(\d)\s*시간(\s*반)?|30분\s*(동안|만)/)?.[0]?.replace(/\s+/g, ' ')
  let time: string | null = null
  if (t) {
    const h = Number(t[2])
    if (h >= 0 && h <= 24) {
      const ampm = t[1] ?? (h >= 1 && h <= 8 ? '오후' : '')
      time = `${ampm ? `${ampm} ` : ''}${h}시${t[3] ? ` ${t[3]}` : ''}`
    }
  }
  const d = day ? `${day} ` : ''
  const len = dur && !/^30분/.test(dur) ? dur : dur ? '30분' : '2시간'
  if (time) return [`${d}${time}에 ${len} 빈 방 있어?`, `${d}${time}부터 ${len} 예약해 줘`]
  if (day) return [`${day} 수업 끝나고 쓸 수 있는 빈 방 찾아 줘`, `${day} 내 시간표 보여 줘`, `${day} 저녁 6시에 2시간 빈 방 있어?`]
  return []
}

/** 띄어쓰기·물음표를 빼고 비교한다("빈방"과 "빈 방"을 같게) */
const squash = (s: string) => s.replace(/[\s?!.,~]/g, '')

/**
 * 친 글자와 이어지는 추천 말(연관 검색). 임베딩 없이 정해진 목록에서 고른다.
 * 친 말을 띄어쓰기로 나눈 조각이 모두 들어 있는 문장만, 앞부분이 맞는 것 → 짧은 것 순으로 limit개.
 * 친 말과 똑같은 문장은 빼고, 아무것도 안 쳤으면 STARTERS.
 * recent(이 폰에서 내가 전에 보낸 말, 최근 것 먼저)가 있으면 맞는 것 중 그 말을 먼저 올린다
 */
export function suggest(query: string, limit = 4, pool: string[] = allMessages(), recent: string[] = []): string[] {
  const q = query.trim()
  if (!q) return [...new Set([...recent.slice(0, 2), ...STARTERS])].slice(0, limit)
  const made = fillTemplates(q)
  pool = [...recent, ...made, ...pool]
  const mine = new Set(recent)
  const built = new Set(made)
  const parts = q.split(/\s+/).map(squash).filter(Boolean)
  const whole = squash(q)
  const seen = new Set<string>()
  return pool
    .filter((m) => {
      if (seen.has(m)) return false
      seen.add(m)
      const s = squash(m)
      return s !== whole && parts.every((p) => s.includes(p))
    })
    .map((m, i) => ({ m, i, own: mine.has(m) ? 0 : built.has(m) ? 1 : 2, head: squash(m).startsWith(whole) ? 0 : 1 }))
    // 내가 쓴 말(최근 순) → 친 말로 만든 문장(만든 순) → 목록에서 앞부분이 맞는 것 → 짧은 것
    .sort((a, b) => a.own - b.own || (a.own < 2 ? a.i - b.i : a.head - b.head || a.m.length - b.m.length))
    .slice(0, limit)
    .map((x) => x.m)
}
