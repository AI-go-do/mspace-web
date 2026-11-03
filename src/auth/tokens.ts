/**
 * 로그인 토큰 보관 (FR-AUTH-002).
 * - 액세스 토큰(1시간)과 refresh 토큰(14일)을 같은 곳에 함께 둔다.
 * - "이 휴대폰에서 자동 로그인"을 끄면 sessionStorage에 둬서 브라우저를 닫으면 사라진다.
 * - 저장소를 못 쓰는 브라우저(사생활 보호 모드 등)에서는 메모리에만 둔다.
 */
export interface Tokens {
  accessToken: string
  /** ISO 시각 */
  expiresAt: string
  refreshToken: string
}

const KEY = 'mspace.tokens'
const LAST_EMAIL = 'mspace.lastEmail'

let memory: Tokens | null = null

function stores(): Storage[] {
  const out: Storage[] = []
  try {
    out.push(localStorage)
  } catch {
    /* 저장소 없음 */
  }
  try {
    out.push(sessionStorage)
  } catch {
    /* 저장소 없음 */
  }
  return out
}

export function readTokens(): Tokens | null {
  // 이 탭만의 sessionStorage를 먼저 본다. 다른 탭이 자동 로그인으로 localStorage에
  // 다른 계정 토큰을 써도, 이 탭은 자기 토큰을 계속 쓴다
  for (const s of stores().reverse()) {
    try {
      const raw = s.getItem(KEY)
      if (raw) return JSON.parse(raw) as Tokens
    } catch {
      /* 깨진 값은 없는 것으로 본다 */
    }
  }
  return memory
}

/** remember=false면 브라우저를 닫을 때 사라진다 */
export function saveTokens(t: Tokens, remember = isRemembered()): void {
  memory = t
  const [local, session] = stores()
  const target = remember ? local : session
  // 이 탭이 이미 임시 로그인(sessionStorage)이면 refresh로 바꿔 쓰는 것뿐이다.
  // 이때 다른 탭이 자동 로그인으로 둔 localStorage 토큰은 지우지 않는다.
  // (자동 로그인 → 임시 로그인으로 처음 바꿀 때만 localStorage를 지운다)
  let keepLocal = false
  if (!remember) {
    try {
      keepLocal = !!session && session.getItem(KEY) !== null
    } catch {
      /* 저장소 없음 */
    }
  }
  for (const s of stores()) {
    try {
      if (s === target) s.setItem(KEY, JSON.stringify(t))
      else if (!(keepLocal && s === local)) s.removeItem(KEY)
    } catch {
      /* 메모리 값으로 계속 쓴다 */
    }
  }
}

export function clearTokens(): void {
  memory = null
  for (const s of stores()) {
    try {
      s.removeItem(KEY)
    } catch {
      /* 무시 */
    }
  }
}

/** 지금 토큰이 localStorage(자동 로그인)에 있는지. 없으면 기본은 자동 로그인 */
function isRemembered(): boolean {
  try {
    return sessionStorage.getItem(KEY) === null
  } catch {
    return true
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
