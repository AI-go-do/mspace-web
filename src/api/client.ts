import { accessAlive, clearTokens, readTokens, saveTokens, type Tokens } from '../auth/tokens'

/** core API 호출. 오류는 서버 형식 { code, message }(NFR-COM-005)를 그대로 던진다. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

/** 로그인이 끝났을 때(refresh 실패·로그아웃) 부르는 함수들. 화면은 로그인 화면으로 보낸다 */
const sessionEndListeners = new Set<() => void>()
export function onSessionEnd(fn: () => void): () => void {
  sessionEndListeners.add(fn)
  return () => sessionEndListeners.delete(fn)
}
function endSession() {
  clearTokens()
  sessionEndListeners.forEach((fn) => fn())
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(path, { ...init, headers })
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  return new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? '잠시 후 다시 시도해 주세요')
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // 로그인 API(/api/auth/)는 토큰 없이 부른다
  const isAuth = path.startsWith('/api/auth/')
  let tokens = isAuth ? null : readTokens()
  // 액세스 토큰이 끝났으면 먼저 새로 받는다(서버에 401을 한 번 덜 맞는다)
  // refresh가 401이면 refreshTokens 안에서 로그인을 끝낸다. 그 밖의 오류(서버 5xx·네트워크)는
  // 토큰을 그대로 둔 채 던진다(배포 중 잠깐 502가 났다고 로그아웃시키지 않으려고)
  if (tokens && !accessAlive(tokens)) tokens = await refreshTokens(tokens)

  let res = await send(path, init, tokens?.accessToken ?? null)
  if (res.status === 401 && tokens) {
    // 시계가 틀렸거나 서버가 토큰을 버린 경우: 한 번만 새로 받아 다시 보낸다
    const fresh = await refreshTokens(tokens)
    res = await send(path, init, fresh.accessToken)
  }
  if (res.status === 401 && !isAuth) endSession()
  if (!res.ok) throw await toError(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

// ---- 자동 로그인 (FR-AUTH-002) ----

interface TokenResponse {
  accessToken: string
  expiresAt: string
  memberId: number
  newMember: boolean
  refreshToken: string
  refreshExpiresAt: string
}

let inFlight: Promise<Tokens> | null = null

/**
 * refresh 토큰으로 새 한 쌍을 받는다. **동시에 한 번만** 부른다.
 * 같은 refresh 토큰을 두 번 보내면 서버가 도난으로 보고 모두 끊기 때문이다.
 * - 같은 탭: 진행 중인 요청을 함께 기다린다.
 * - 다른 탭: 브라우저 잠금(Web Locks)으로 줄을 세우고, 앞 탭이 이미 바꿨으면 그 값을 쓴다.
 * refresh가 401이면 로그인을 끝낸다. 네트워크 오류면 토큰은 그대로 두고 오류만 던진다.
 */
export function refreshTokens(stale: Tokens): Promise<Tokens> {
  if (!inFlight) {
    inFlight = withLock(() => doRefresh(stale)).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function doRefresh(stale: Tokens): Promise<Tokens> {
  const current = readTokens()
  if (!current) throw new ApiError(401, 'REFRESH_TOKEN_INVALID', '다시 로그인해 주세요')
  // 다른 탭이 먼저 바꿔 놓았으면 그것을 쓴다
  if (current.refreshToken !== stale.refreshToken) return current

  const res = await send('/api/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken: current.refreshToken }) }, null)
  if (res.status === 401) {
    endSession()
    throw await toError(res)
  }
  if (!res.ok) throw await toError(res)
  const body = (await res.json()) as TokenResponse
  const next = { accessToken: body.accessToken, expiresAt: body.expiresAt, refreshToken: body.refreshToken }
  saveTokens(next)
  return next
}

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  return locks ? (locks.request('mspace.refresh', fn) as Promise<T>) : fn()
}

// ---- 로그인 (FR-AUTH-001) ----

export function requestEmailCode(email: string): Promise<void> {
  return api('/api/auth/email-codes', { method: 'POST', body: JSON.stringify({ email }) })
}

export interface Signup {
  name: string
  studentId: string
}

/** 번호 확인 + 토큰 받기. 처음 가입이면 서버가 SIGNUP_INFO_REQUIRED를 주고, 이름·학번을 붙여 다시 보낸다 */
export async function login(email: string, code: string, remember: boolean, signup?: Signup): Promise<TokenResponse> {
  const body = await api<TokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, code, ...signup }),
  })
  saveTokens({ accessToken: body.accessToken, expiresAt: body.expiresAt, refreshToken: body.refreshToken }, remember)
  return body
}

/** 로그아웃: 서버에서 refresh 토큰을 끊고, 들고 있던 두 토큰을 지운다 */
export async function logout(): Promise<void> {
  const t = readTokens()
  try {
    if (t) await send('/api/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken: t.refreshToken }) }, null)
  } finally {
    endSession()
  }
}
