/**
 * 이용 수칙 (docs 요구사항 3.1). 요구사항은 서버(GET /api/rules)에서 받으라고 하지만
 * core에 아직 그 API가 없어서 여기 한 곳에 둔다. API가 생기면 이 파일만 바꾼다.
 * 내용이 바뀌면 RULES_VERSION을 올린다 → 모두에게 동의 화면이 다시 뜬다.
 */
export const RULES_VERSION = '2026-11-03'

export interface Rule {
  /** 왼쪽 칸에 크게 보이는 말 */
  tag: string
  title: string
  body: string
  /** 노랑으로 강조 (노쇼) */
  strong?: boolean
}

/** 예약 전 동의 화면(시안 Rules)에 보이는 수칙. 노쇼 시각은 화면이 채운다 */
export function agreeRules(noShowAt: string): Rule[] {
  return [
    { tag: '15분', title: '노쇼면 자동 취소', body: `시작 후 15분(${noShowAt}) 안에 키패드로 입실하지 않으면 예약이 취소되고 방이 풀려요.`, strong: true },
    { tag: '소음', title: '대화는 괜찮아요', body: '옆 방에 들릴 만큼 떠들거나 장난치지 않아요.' },
    { tag: '음식', title: '음식물 반입 금지', body: '먹을 것과 마실 것 모두 가져올 수 없어요. 어기면 경고가 남고, 기기가 고장 나면 배상해요.' },
    { tag: '정리', title: '나갈 때 깨끗하게', body: '퇴실 전에 쓰레기를 버리고 자리를 정리해요.' },
    { tag: '사진', title: '방 사진은 증거가 돼요', body: '입실·퇴실 때 찍어 두면 신고나 분쟁 때 내 편이 돼요. (선택)' },
  ]
}

export const SANCTION = '어기면 경고 1회가 남아요. 30일 안에 경고 3번이면 14일 동안 예약·참여를 할 수 없어요.'

const AGREED_KEY = 'mspace.rulesAgreed'

/**
 * 동의한 수칙 버전. 요구사항은 회원(users.rules_agreed_version)에 저장하라고 하지만
 * core에 아직 API가 없어 이 브라우저에만 기억한다(다른 폰에서는 한 번 더 묻는다).
 */
export function hasAgreed(): boolean {
  try {
    return localStorage.getItem(AGREED_KEY) === RULES_VERSION
  } catch {
    return false
  }
}

export function saveAgreed(): void {
  try {
    localStorage.setItem(AGREED_KEY, RULES_VERSION)
  } catch {
    /* 저장 못 하면 다음에 한 번 더 묻는다 */
  }
}
