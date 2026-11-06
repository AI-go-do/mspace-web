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
  { label: '입실 번호', message: '입실 번호 보여 줘' },
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
