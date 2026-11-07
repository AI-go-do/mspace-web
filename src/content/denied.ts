/** 예약이 안 될 때 안내 (FR-WEB-006). 서버 오류 code마다 제목과 다음 행동을 정한다 */
export type NextStep = 'time' | 'date' | 'members' | 'mine' | 'retry'

export interface Denied {
  title: string
  /** 무엇을 하면 되는지. 없으면 서버 메시지를 보여 준다 */
  hint?: string
  action: string
  next: NextStep
  /** 서버에서 처리됐는지 모를 때(연결 끊김·응답 늦음). 시트가 [홈으로] 대신 [내 예약 확인]을 보여 준다 */
  unsure?: boolean
}

/**
 * 연결이 끊기거나 응답이 늦은 경우. 서버에는 예약이 들어갔을 수 있어서 "못 했어요"라고 단정하지 않는다
 * (믿고 떠나면 즉시 시작 예약이 노쇼가 될 수 있다). 다시 시도는 같은 멱등 키로 보내 두 번 생기지 않는다
 */
const UNSURE: Denied = {
  title: '예약이 됐는지 확인하지 못했어요',
  hint: '연결이 끊겼거나 응답이 늦어요. 서버에는 들어갔을 수도 있어요. 같은 내용으로 다시 보내도 두 번 예약되지 않아요.',
  action: '같은 내용으로 다시 시도',
  next: 'retry',
  unsure: true,
}

const BY_CODE: Record<string, Denied> = {
  RESERVATION_TIME_TAKEN: { title: '방금 다른 팀이 이 시간을 예약했어요', hint: '같은 방의 다른 시간이나 다른 방을 골라 주세요.', action: '다른 시간 보기', next: 'time' },
  OWNER_HAS_ACTIVE_RESERVATION: { title: '이미 끝나지 않은 예약이 있어요', hint: '대표자든 참여자든 끝나지 않은 예약은 1건만 가질 수 있어요. 지금 예약이 끝나거나 취소된 뒤 다시 예약해 주세요.', action: '내 예약 보기', next: 'mine' },
  PARTICIPANT_HAS_ACTIVE_RESERVATION: { title: '함께 쓸 사람 중 이미 다른 예약에 들어 있는 사람이 있어요', hint: '한 사람은 끝나지 않은 예약에 한 번만 들어갈 수 있어요. 그 사람을 빼거나 다른 사람으로 바꿔 주세요. 그 예약이 끝난 뒤에는 다시 예약할 수 있어요.', action: '함께 쓸 사람 고치기', next: 'members' },
  PARTICIPANT_TIME_TAKEN: { title: '같은 시간에 다른 방에 있는 사람이 있어요', hint: '그 사람을 빼고 다시 예약해 주세요.', action: '함께 쓸 사람 고치기', next: 'members' },
  USER_SUSPENDED: { title: '지금은 이용이 정지되어 있어요', hint: '노쇼나 경고가 쌓여 정지 기간 동안은 예약·연장을 할 수 없어요. 정지가 끝나면 다시 예약할 수 있어요.', action: '내 예약 보기', next: 'mine' },
  PARTICIPANT_SUSPENDED: { title: '함께 쓸 사람 중 이용 정지 중인 사람이 있어요', hint: '그 사람을 빼고 다시 예약해 주세요. 누구인지는 개인 기록이라 알려 드리지 않아요.', action: '함께 쓸 사람 고치기', next: 'members' },
  HEADCOUNT_OUT_OF_RANGE: { title: '이 방의 인원에 맞지 않아요', action: '함께 쓸 사람 고치기', next: 'members' },
  PARTICIPANT_NOT_FOUND: { title: '찾을 수 없는 학번이 있어요', action: '함께 쓸 사람 고치기', next: 'members' },
  PARTICIPANT_NOT_FRIEND: { title: '친구가 아닌 사람이 있어요', hint: '서로 친구 요청을 수락한 사람만 함께 넣을 수 있어요. 내 예약 > 친구에서 먼저 친구를 맺어 주세요.', action: '함께 쓸 사람 고치기', next: 'members' },
  PARTICIPANT_DUPLICATE: { title: '같은 사람이 두 번 들어 있어요', action: '함께 쓸 사람 고치기', next: 'members' },
  RESERVATION_INVALID_LENGTH: { title: '한 번에 2시간까지 예약할 수 있어요', hint: '30분 칸으로 최대 4칸까지 고를 수 있어요.', action: '시간 다시 고르기', next: 'time' },
  RESERVATION_NOT_ON_SLOT: { title: '30분 단위로만 예약할 수 있어요', action: '시간 다시 고르기', next: 'time' },
  RESERVATION_IN_PAST: { title: '이미 지난 시간이에요', hint: '지금 이후의 칸을 골라 주세요.', action: '시간 다시 고르기', next: 'time' },
  RESERVATION_OUT_OF_RANGE: { title: '7일 뒤까지만 예약할 수 있어요', hint: '오늘부터 7일 안의 날짜를 골라 주세요.', action: '날짜 다시 고르기', next: 'date' },
  NETWORK: UNSURE,
  TIMEOUT: UNSURE,
}

/** 모르는 code면 서버 메시지를 그대로 보여 주고 다시 시도하게 한다 */
export function deniedFor(code: string): Denied {
  return BY_CODE[code] ?? { title: '예약하지 못했어요', action: '다시 시도', next: 'retry' }
}

/** 확인 카드처럼 한 줄로만 보여 줄 때. 아는 code면 제목+할 일, 모르면 서버 메시지 */
export function deniedLine(code: string, fallback: string): string {
  // 확인 카드는 예약·취소·퇴실을 다 하므로 예약이라고 하지 않는다
  if (code === 'NETWORK' || code === 'TIMEOUT') return '처리됐는지 확인하지 못했어요. 내 예약에서 확인한 뒤 다시 눌러 주세요.'
  const d = BY_CODE[code]
  if (!d) return fallback
  return d.hint ? `${d.title}. ${d.hint}` : d.title
}
