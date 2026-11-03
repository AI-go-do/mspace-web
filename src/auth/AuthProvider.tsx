import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { ApiError, logout as apiLogout, onSessionEnd, refreshTokens } from '../api/client'
import { accessAlive, readTokens } from './tokens'
import Splash from './Splash'

type Status = 'checking' | 'in' | 'out'

interface Auth {
  status: Status
  /** 로그인 화면이 토큰을 저장한 뒤 부른다 */
  signedIn: () => void
  logout: () => Promise<void>
}

const AuthContext = createContext<Auth | null>(null)

/**
 * 앱을 열 때 (FR-AUTH-002): 로그인 화면이 아니라 로딩 화면을 먼저 보여 주고
 * ① 토큰이 있나 ② 액세스 토큰이 살아 있나(살아 있으면 바로 메인) ③ refresh로 새로 받기 를 확인한다.
 * 실패했을 때만 로그인 화면으로 간다.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(() => {
    const t = readTokens()
    if (!t) return 'out'
    return accessAlive(t) ? 'in' : 'checking'
  })

  useEffect(() => {
    if (status !== 'checking') return
    const t = readTokens()
    if (!t) {
      setStatus('out')
      return
    }
    refreshTokens(t)
      .then(() => setStatus('in'))
      // refresh가 401이면 로그인 끝. 서버에 못 닿았으면(와이파이 등) 일단 들여보내고 화면이 오류를 보여 준다
      .catch((e) => setStatus(e instanceof ApiError && e.status === 401 ? 'out' : 'in'))
  }, [status])

  useEffect(() => onSessionEnd(() => setStatus('out')), [])

  const signedIn = useCallback(() => setStatus('in'), [])
  const logout = useCallback(() => apiLogout(), [])

  return <AuthContext.Provider value={{ status, signedIn, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): Auth {
  const a = useContext(AuthContext)
  if (!a) throw new Error('AuthProvider 밖에서 useAuth를 불렀어요')
  return a
}

/** 로그인해야 볼 수 있는 화면을 감싼다. 로그인 뒤 원래 가려던 곳으로 돌아온다 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <Splash />
  if (status === 'out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return <>{children}</>
}
