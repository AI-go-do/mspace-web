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

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  const token = readToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

  const res = await fetch(path, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new ApiError(res.status, body.code ?? 'UNKNOWN', body.message ?? '잠시 후 다시 시도해 주세요')
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

// 로그인(FR-AUTH-001·002)이 붙으면 토큰 저장 위치를 이곳 한 군데에서 바꾼다.
function readToken(): string | null {
  try {
    return localStorage.getItem('mspace.accessToken')
  } catch {
    return null
  }
}
