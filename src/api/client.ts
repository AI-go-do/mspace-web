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
/** 지금 로그인한 회원 번호(모르면 null) */
export function currentMemberId(): number | null {
  return readTokens()?.memberId ?? null
}

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
  // 사진을 받을 때는 부른 쪽이 Accept를 정한다(JSON만 받는다고 하면 서버가 406으로 거절)
  if (!headers.has('Accept')) headers.set('Accept', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)
  // 사진(FormData)은 브라우저가 경계(boundary)를 붙인 multipart 머리글을 직접 넣는다
  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  // 같은 출처라 refresh 쿠키(HttpOnly, /api/auth 전용)는 브라우저가 알아서 붙인다
  try {
    return await fetch(path, { credentials: 'same-origin', ...init, headers })
  } catch (e) {
    // 부른 쪽이 끊은 요청(화면 떠남·시간 초과)은 그대로 던진다. 부른 쪽이 signal.aborted로 구분한다
    if (init.signal?.aborted) throw e
    // 서버에 닿지 못함(와이파이 끊김 등). 브라우저 오류 문구("Failed to fetch"·"Load failed")를 화면에 그대로 내지 않는다
    throw new ApiError(0, 'NETWORK', '연결이 끊겼어요. 와이파이를 확인하고 다시 시도해 주세요')
  }
}

/**
 * 바꾸는 요청(POST·PUT·DELETE)을 기다리는 최대 시간. 느린 와이파이에서 "…하는 중"에 끝없이 머물지 않게 한다.
 * 부른 쪽이 signal을 주면(사진 올리기·비서 채팅처럼 따로 시간을 정한 요청) 그것을 따르고, 사진(FormData)도 건드리지 않는다
 */
export const WRITE_TIMEOUT_MS = 15_000

async function toError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => ({}))
  return new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? '잠시 후 다시 시도해 주세요')
}

/**
 * member를 주면 그 회원의 토큰으로만 보낸다. refresh로 다른 회원 토큰을 받았으면(같은 브라우저 다른 탭에서
 * 다른 학생이 로그인) 보내지 않고 SESSION_CHANGED를 던진다. 앞 학생의 말을 새 학생 계정으로 보내지 않으려고.
 */
export async function api<T>(path: string, { member, as, ...init }: RequestInit & { member?: number | null; as?: 'json' | 'blob' } = {}): Promise<T> {
  const wrongMember = (t: Tokens | null) => member !== undefined && (t?.memberId ?? null) !== member
  // 로그인 API(/api/auth/)는 토큰 없이 부른다
  const isAuth = path.startsWith('/api/auth/')
  let tokens = isAuth ? null : readTokens()
  // 액세스 토큰이 없거나(새로고침) 끝났으면 먼저 쿠키로 새로 받는다
  // refresh가 401이면 refreshTokens 안에서 로그인을 끝낸다. 그 밖의 오류(서버 5xx·네트워크)는
  // 그대로 던진다(배포 중 잠깐 502가 났다고 로그아웃시키지 않으려고)
  // 이 요청을 시작한 로그인 세대. 기다리는 사이 로그아웃·다른 계정 로그인이 있었으면
  // 예전 요청을 새 계정 토큰으로 보내지 않는다(예: 예전 사람의 예약 취소가 새 사람 계정에 적용되는 일)
  const started = generation
  if (!isAuth && !accessAlive(tokens)) tokens = await refreshTokens()
  if (started !== generation || wrongMember(tokens)) throw new ApiError(401, 'SESSION_CHANGED', '다시 시도해 주세요')

  const method = (init.method ?? 'GET').toUpperCase()
  const timed = method !== 'GET' && !init.signal && !(init.body instanceof FormData)
  const timeout = timed ? new AbortController() : null
  const timer = timeout ? setTimeout(() => timeout.abort(), WRITE_TIMEOUT_MS) : undefined
  const sendInit = timeout ? { ...init, signal: timeout.signal } : init
  // 우리가 정한 시간이 지나 요청(또는 본문 읽기)을 끊었을 때만 TIMEOUT으로 바꾼다. 서버에서는 처리됐을 수도 있어서
  // "실패"라고 단정하지 않는다. refresh 중에 시간이 지난 경우는 그 오류를 그대로 둔다(세션 오류를 TIMEOUT으로 덮지 않게)
  const withTimeout = async <R,>(work: () => Promise<R>): Promise<R> => {
    try {
      return await work()
    } catch (e) {
      if (timeout?.signal.aborted && e instanceof DOMException && e.name === 'AbortError') {
        throw new ApiError(0, 'TIMEOUT', '응답이 늦어요. 처리됐는지 확인한 뒤 다시 시도해 주세요')
      }
      throw e
    }
  }
  // 머리글만 오고 본문이 안 오는 경우도 있어서, 시간 제한은 본문을 다 읽을 때까지 건다
  try {
    let res = await withTimeout(() => send(path, sendInit, tokens?.accessToken ?? null))
    if (res.status === 401 && tokens) {
      // 시계가 틀렸거나 서버가 토큰을 버린 경우: 같은 세대일 때만 한 번 새로 받아 다시 보낸다
      if (started !== generation) throw await toError(res)
      const fresh = await refreshTokens()
      if (started !== generation) throw await toError(res)
      if (wrongMember(fresh)) throw new ApiError(401, 'SESSION_CHANGED', '다시 시도해 주세요')
      res = await withTimeout(() => send(path, sendInit, fresh.accessToken))
    }
    if (res.status === 401 && !isAuth && started === generation) endSession()
    if (!res.ok) throw await toError(res)
    if (res.status === 204) return undefined as T
    // 사진처럼 JSON이 아닌 응답(관리자 증거 사진)은 Blob으로 받는다. 이미지 태그는 Bearer 머리글을 못 붙여서
    return await withTimeout(() => (as === 'blob' ? res.blob() : res.json()) as Promise<T>)
  } finally {
    clearTimeout(timer)
  }
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
    const p: Promise<Tokens> = doRefresh().finally(() => {
      if (inFlight === p) inFlight = null
    })
    inFlight = p
  }
  return inFlight
}

/** refresh를 기다리는 최대 시간. 넘으면 요청을 실제로 끊는다(로그인이 이걸 기다리므로 영원히 멈추지 않게) */
export const REFRESH_TIMEOUT_MS = 10_000

async function doRefresh(): Promise<Tokens> {
  const started = generation
  // 시간 제한은 둘로 나눈다. ① 잠금 기다림: 다른 탭이 잠금을 오래 쥐어도 멈추지 않게.
  // ② refresh 요청: 잠금을 받은 뒤부터 새로 잰다. 기다림이 요청 시간을 깎아 먹으면, 서버가 쿠키를 바꾼 직후에
  // 요청이 끊겨 다음 시도가 이미 쓴 쿠키를 다시 보낼 수 있어서다(그러면 서버가 모두 끊는다).
  // 요청은 단순히 기다림만 끝내지 않고 실제로 끊는다. 살아 있는 요청이 나중에 로그인 쿠키를 덮을 수 있어서다
  const lockAbort = new AbortController()
  const lockTimer = setTimeout(() => lockAbort.abort(), REFRESH_TIMEOUT_MS)
  const requestAbort = new AbortController()
  let requestTimer: ReturnType<typeof setTimeout> | undefined
  try {
    return await withLock(() => {
      clearTimeout(lockTimer)
      requestTimer = setTimeout(() => requestAbort.abort(), REFRESH_TIMEOUT_MS)
      return refreshOnce(started, requestAbort.signal)
    }, lockAbort.signal)
  } catch (e) {
    if (lockAbort.signal.aborted || requestAbort.signal.aborted) throw new ApiError(0, 'REFRESH_TIMEOUT', '연결이 늦어요. 잠시 후 다시 시도해 주세요')
    throw e
  } finally {
    clearTimeout(lockTimer)
    clearTimeout(requestTimer)
  }
}

async function refreshOnce(started: number, signal: AbortSignal): Promise<Tokens> {
  const res = await send('/api/auth/refresh', { method: 'POST', signal }, null)
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
  const next = { accessToken: body.accessToken, expiresAt: body.expiresAt, memberId: body.memberId }
  saveTokens(next)
  return next
}

/** signal을 주면 잠금을 기다리는 중에도 끊을 수 있다 (끊기면 AbortError로 실패) */
function withLock<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!locks) return fn()
  return (signal ? locks.request('mspace.refresh', { signal }, fn) : locks.request('mspace.refresh', fn)) as Promise<T>
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
  // 진행 중인 refresh가 끝난 뒤에 로그인한다. 늦게 온 refresh 응답의 쿠키가 새 로그인 쿠키를 덮지 않게 하려고
  // (같은 탭은 inFlight를 기다리고, 다른 탭은 refresh와 같은 잠금으로 줄을 세운다)
  await inFlight?.catch(() => undefined)
  return withLock(async () => {
    const body = await api<TokenResponse>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, code, remember, ...signup }),
    })
    generation++
    saveTokens({ accessToken: body.accessToken, expiresAt: body.expiresAt, memberId: body.memberId })
    return body
  })
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
