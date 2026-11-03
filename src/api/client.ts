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
/**
 * 로그인 세대. 로그인하거나 로그인이 끝날 때마다 1 오른다.
 * 앱을 열 때 시작한 refresh가 늦게 끝나면, 그사이 새로 로그인한 토큰을 덮거나 지우지 않도록 결과를 버린다
 */
let generation = 0

function endSession() {
  generation++
  clearTokens()
  sessionEndListeners.forEach((fn) => fn())
}

async function send(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // 같은 출처라 refresh 쿠키(HttpOnly, /api/auth 전용)는 브라우저가 알아서 붙인다
  return fetch(path, { credentials: 'same-origin', ...init, headers })
}

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  return new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? '잠시 후 다시 시도해 주세요')
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  // 로그인 API(/api/auth/)는 토큰 없이 부른다
  const isAuth = path.startsWith('/api/auth/')
  let tokens = isAuth ? null : readTokens()
  // 액세스 토큰이 없거나(새로고침) 끝났으면 먼저 쿠키로 새로 받는다
  // refresh가 401이면 refreshTokens 안에서 로그인을 끝낸다. 그 밖의 오류(서버 5xx·네트워크)는
  // 그대로 던진다(배포 중 잠깐 502가 났다고 로그아웃시키지 않으려고)
  if (!isAuth && !accessAlive(tokens)) tokens = await refreshTokens()

  let res = await send(path, init, tokens?.accessToken ?? null)
  if (res.status === 401 && tokens) {
    // 시계가 틀렸거나 서버가 토큰을 버린 경우: 한 번만 새로 받아 다시 보낸다
    const fresh = await refreshTokens()
    res = await send(path, init, fresh.accessToken)
  }
  if (res.status === 401 && !isAuth) endSession()
  if (!res.ok) throw await toError(res)
  return res.status === 204 ? (undefined as T) : res.json()
}

// ---- 자동 로그인 (FR-AUTH-002) ----

/** refresh 토큰은 HttpOnly 쿠키로만 오고 본문에는 없다 */
interface TokenResponse {
  accessToken: string
  expiresAt: string
  memberId: number
  newMember: boolean
  refreshExpiresAt: string
}

let inFlight: Promise<Tokens> | null = null

/**
 * 쿠키의 refresh 토큰으로 새 액세스 토큰을 받는다. **동시에 한 번만** 부른다.
 * 서버는 refresh할 때마다 쿠키를 새 것으로 바꾸고, 이미 쓴 것이 다시 오면 도난으로 보고 모두 끊는다.
 * - 같은 탭: 진행 중인 요청을 함께 기다린다.
 * - 다른 탭: 브라우저 잠금(Web Locks)으로 줄을 세운다. 앞 탭이 받은 새 쿠키를 뒤 탭 요청이 그대로 쓴다.
 * refresh가 401이면 로그인을 끝낸다. 서버 5xx·네트워크 오류는 오류만 던진다.
 */
export function refreshTokens(): Promise<Tokens> {
  if (!inFlight) {
    inFlight = withLock(doRefresh).finally(() => {
      inFlight = null
    })
  }
  return inFlight
}

async function doRefresh(): Promise<Tokens> {
  const started = generation
  const res = await send('/api/auth/refresh', { method: 'POST' }, null)
  if (started !== generation) {
    // 기다리는 사이 새로 로그인(또는 로그아웃)했다: 이 결과는 버리고 지금 토큰을 쓴다
    const now = readTokens()
    if (now) return now
    throw new ApiError(401, 'REFRESH_TOKEN_INVALID', '다시 로그인해 주세요')
  }
  if (res.status === 401) {
    endSession()
    throw await toError(res)
  }
  if (!res.ok) throw await toError(res)
  const body = (await res.json()) as TokenResponse
  const next = { accessToken: body.accessToken, expiresAt: body.expiresAt }
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

/**
 * 번호 확인 + 토큰 받기. 처음 가입이면 서버가 SIGNUP_INFO_REQUIRED를 주고, 이름·학번을 붙여 다시 보낸다.
 * remember=false면 서버가 refresh 쿠키를 "브라우저를 닫으면 사라지는 쿠키"로 준다
 */
export async function login(email: string, code: string, remember: boolean, signup?: Signup): Promise<TokenResponse> {
  const body = await api<TokenResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, code, remember, ...signup }),
  })
  generation++
  saveTokens({ accessToken: body.accessToken, expiresAt: body.expiresAt })
  return body
}

/**
 * 로그아웃: 서버가 refresh 토큰을 끊고 쿠키를 지운다. 그다음에 메모리의 액세스 토큰을 버린다.
 * 서버가 실패하면(5xx·네트워크) 쿠키가 남아 새로고침하면 다시 로그인되므로, 로그인을 끝내지 않고 오류를 던진다.
 * 화면은 "로그아웃하지 못했어요"를 보여 주고 다시 누르게 한다
 */
export async function logout(): Promise<void> {
  const res = await send('/api/auth/logout', { method: 'POST' }, null)
  if (!res.ok) throw await toError(res)
  endSession()
}
