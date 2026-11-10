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
    ? { tag: '10분', title: '노쇼면 자동 취소', body: `지금부터 10분(${noShowAt}) 안에 QR로 입실하지 않으면 예약이 취소되고 방이 풀려요.`, strong: true }
    : { tag: '15분', title: '노쇼면 자동 취소', body: `시작 후 15분(${noShowAt}) 안에 QR로 입실하지 않으면 예약이 취소되고 방이 풀려요.`, strong: true }
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
/** 이용 규칙 화면의 예약 숫자 (요구사항 3.2·4장). 그림과 문장이 모두 여기서 읽는다 */
export const BOOKING = {
  advanceDays: 7,
  slotMinutes: 30,
  maxMinutes: 120,
  noShowMinutes: 15,
  instantNoShowMinutes: 10,
  smallRoom: '3–5',
  bigRoom: '5–8',
  instantNote: '지금 바로 쓰기는 누른 때부터, 입실은 10분 안이에요.',
} as const

/** 표지판 그림 종류 (이용 규칙 화면) */
export type SignIcon = 'noise' | 'food' | 'trash' | 'seat' | 'door' | 'bag' | 'camera'

/**
 * 이용 규칙 화면의 "방에서 지킬 것" (요구사항 3.1 전체).
 * sign은 표지판에 크게 쓰는 말, text는 그 밑 작은 설명. ban이면 금지 표지(빨간 원·사선)
 */
export const ROOM_RULES: { tag: string; sign: string; text: string; icon: SignIcon; ban?: boolean }[] = [
  { tag: '음식', sign: '음식·음료', icon: 'food', ban: true, text: '기기·비품이 고장 나면 배상해요.' },
  { tag: '소음', sign: '큰 소리', icon: 'noise', ban: true, text: '대화는 괜찮아요. 떠들거나 장난치지 않아요.' },
  { tag: '자리', sign: '자리 맡기', icon: 'seat', ban: true, text: '비어 있는 게 10분이면 알림, 15분이면 자동 퇴실. 30일 안에 3번이면 노쇼 1번이에요.' },
  { tag: '문', sign: '문 닫기', icon: 'door', text: '문을 괴어 두거나 QR을 예약자 밖 사람에게 주지 않아요.' },
  { tag: '정리', sign: '쓰레기는 버리고', icon: 'trash', text: '나갈 때 자리를 정리해요.' },
  { tag: '소지품', sign: '짐 챙기기', icon: 'bag', text: '예약이 끝나 문이 잠기면 다시 예약해야 들어가요.' },
  { tag: '사진', sign: '입실·퇴실 사진', icon: 'camera', text: '신고·분쟁 때 내 증거가 돼요. (선택)' },
]
