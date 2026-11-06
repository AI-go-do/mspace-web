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
export function agreeRules(noShowAt: string, instant = false): Rule[] {
  const noShow = instant
    ? { tag: '10분', title: '노쇼면 자동 취소', body: `지금부터 10분(${noShowAt}) 안에 키패드로 입실하지 않으면 예약이 취소되고 방이 풀려요.`, strong: true }
    : { tag: '15분', title: '노쇼면 자동 취소', body: `시작 후 15분(${noShowAt}) 안에 키패드로 입실하지 않으면 예약이 취소되고 방이 풀려요.`, strong: true }
  return [
    noShow,
    { tag: '소음', title: '대화는 괜찮아요', body: '옆 방에 들릴 만큼 떠들거나 장난치지 않아요.' },
    { tag: '음식', title: '음식물 반입 금지', body: '먹을 것과 마실 것 모두 가져올 수 없어요. 어기면 경고가 남고, 기기가 고장 나면 배상해요.' },
    { tag: '정리', title: '나갈 때 깨끗하게', body: '퇴실 전에 쓰레기를 버리고 자리를 정리해요.' },
    { tag: '사진', title: '방 사진은 증거가 돼요', body: '입실·퇴실 때 찍어 두면 신고나 분쟁 때 내 편이 돼요. (선택)' },
  ]
}

export const SANCTION = '어기면 경고 1회가 남아요. 30일 안에 경고 3번이면 14일 동안 예약·참여를 할 수 없어요.'

import { currentMemberId } from '../api/client'

/** 회원마다 따로 기억한다. 같은 폰에서 다른 사람이 로그인하면 그 사람에게 다시 묻는다 */
function agreedKey(): string | null {
  const id = currentMemberId()
  return id == null ? null : `mspace.rulesAgreed.${id}`
}

/**
 * 동의한 수칙 버전. 요구사항은 회원(users.rules_agreed_version)에 저장하라고 하지만
 * core에 아직 API가 없어 이 브라우저에 회원별로 기억한다(다른 폰에서는 한 번 더 묻는다).
 */
export function hasAgreed(): boolean {
  try {
    const key = agreedKey()
    return key != null && localStorage.getItem(key) === RULES_VERSION
  } catch {
    return false
  }
}

export function saveAgreed(): void {
  try {
    const key = agreedKey()
    if (key) localStorage.setItem(key, RULES_VERSION)
  } catch {
    /* 저장 못 하면 다음에 한 번 더 묻는다 */
  }
}

/** 이용 규칙 화면(FR-WEB-003)의 예약 규칙 칸 */
export const BOOKING_FACTS: { big: string; small: string; strong?: boolean }[] = [
  { big: '7일', small: '오늘부터 7일 안' },
  { big: '2시간', small: '한 번에 최대' },
  { big: '30분', small: '시간 단위' },
  { big: '1건', small: '대표자당 진행 중' },
  { big: '15분', small: '안에 입실, 아니면 노쇼', strong: true },
  { big: '3–5명', small: '창작실 1–4 · 5번은 5–8명' },
]

/** 이용 규칙 화면의 "방에서 지킬 것" (요구사항 3.1 전체) */
export const ROOM_RULES: { tag: string; text: string; lead?: string }[] = [
  { tag: '소음', text: '대화는 괜찮아요. 옆 방에 들릴 만큼 떠들거나 장난치지 않아요.' },
  { tag: '음식', lead: '음식물 반입 금지.', text: '음료도 가져올 수 없어요. 기기·비품이 고장 나면 배상해요.' },
  { tag: '정리', text: '나갈 때 쓰레기를 버리고 자리를 정리해요.' },
  { tag: '자리', text: '짐만 두고 자리를 맡아 두지 않아요. 비어 있는 게 10분이면 알림, 15분이면 자동 퇴실돼요. 30일 안에 3번이면 노쇼 1번으로 세요.' },
  { tag: '문', text: '나갈 때 문이 닫혔는지 확인해요. 문을 괴어 두거나 번호를 예약자 밖 사람에게 알려 주지 않아요.' },
  { tag: '소지품', text: '퇴실 전에 챙겨요. 예약이 끝나 문이 잠기면 다시 예약해야 들어갈 수 있어요.' },
  { tag: '사진', text: '입실·퇴실 사진은 신고·분쟁 때 내 증거가 돼요. (선택)' },
]
