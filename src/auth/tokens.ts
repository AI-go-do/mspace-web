/**
 * 로그인 토큰 보관 (FR-AUTH-002).
 * - 액세스 토큰(1시간)은 **이 탭의 메모리에만** 둔다. 새로고침하면 사라지고, 쿠키로 다시 받는다.
 * - refresh 토큰(14일)은 core가 HttpOnly 쿠키로만 준다. 화면의 스크립트는 읽을 수도, 저장할 수도 없다.
 *   그래서 브라우저 저장소(localStorage·sessionStorage)에는 토큰을 하나도 넣지 않는다.
 */
export interface Tokens {
  accessToken: string
  /** ISO 시각 */
  expiresAt: string
  /** 로그인한 회원. 이 브라우저에만 두는 기록(수칙 동의 등)을 회원별로 나누는 데 쓴다 */
  memberId?: number
}

/** 예전 버전이 localStorage·sessionStorage에 넣던 토큰 키. 남아 있으면 지운다 */
const LEGACY_KEY = 'mspace.tokens'
const LAST_EMAIL = 'mspace.lastEmail'

let memory: Tokens | null = null
/** 로그인한 회원이 바뀔 때(다른 회원 토큰으로 바뀜·로그아웃) 부르는 함수들 */
const memberListeners = new Set<() => void>()

export function readTokens(): Tokens | null {
  return memory
}

/** 회원 번호가 달라졌으면 구독한 화면에 알린다 */
function setMemory(next: Tokens | null): void {
  const before = memory?.memberId ?? null
  memory = next
  if ((next?.memberId ?? null) !== before) memberListeners.forEach((fn) => fn())
}

export function saveTokens(t: Tokens): void {
  setMemory(t)
}

export function clearTokens(): void {
  setMemory(null)
}

/** 로그인한 회원이 바뀌면 fn을 부른다. 돌려준 함수로 구독을 끝낸다 */
export function onMemberChange(fn: () => void): () => void {
  memberListeners.add(fn)
  return () => { memberListeners.delete(fn) }
}

/** 예전 버전이 브라우저 저장소에 남긴 토큰을 지운다(앱을 열 때 한 번) */
export function dropLegacyTokens(): void {
  for (const get of [() => localStorage, () => sessionStorage]) {
    try {
      get().removeItem(LEGACY_KEY)
    } catch {
      /* 저장소 없음 */
    }
  }
}

/** 액세스 토큰이 아직 쓸 만한지. 시계 차이를 생각해 30초 여유를 둔다 */
export function accessAlive(t: Tokens | null, now = Date.now()): boolean {
  return !!t && Date.parse(t.expiresAt) - 30_000 > now
}

/** 다시 로그인할 때 편하게: 마지막 학교 메일만 기억한다(토큰 아님) */
export function readLastEmail(): string {
  try {
    return localStorage.getItem(LAST_EMAIL) ?? ''
  } catch {
    return ''
  }
}

export function saveLastEmail(email: string): void {
  try {
    localStorage.setItem(LAST_EMAIL, email)
  } catch {
    /* 무시 */
  }
}
