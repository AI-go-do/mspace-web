import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { ApiError, login, requestEmailCode } from '../api/client'
import { useAuth } from '../auth/AuthProvider'
import { readLastEmail, saveLastEmail } from '../auth/tokens'
import Spacey from '../components/Spacey'
import './Login.css'

const DOMAIN = '@chosun.ac.kr'
const CODE_TTL = 10 * 60 // 인증번호 10분 (FR-AUTH-001)
const RESEND_AFTER = 60 // 같은 주소로 1분에 1번

/** "20231234" 또는 "20231234@chosun.ac.kr" → 메일 앞부분만 */
function localPart(v: string) {
  return v.trim().replace(/@.*$/, '')
}

/** FR-AUTH-001 학교 메일 로그인: 메일 → 6자리 코드 (처음이면 이름·학번까지) */
export default function Login() {
  const { status, signedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [id, setId] = useState(() => localPart(readLastEmail()))
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [sentAt, setSentAt] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [signup, setSignup] = useState(false)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const codeInput = useRef<HTMLInputElement>(null)

  const email = `${localPart(id)}${DOMAIN}`

  useEffect(() => {
    if (step !== 'code') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [step])

  if (status === 'in') return <Navigate to={from} replace />

  const elapsed = Math.floor((now - sentAt) / 1000)
  const left = Math.max(0, CODE_TTL - elapsed)
  const canResend = elapsed >= RESEND_AFTER

  async function sendCode(e?: FormEvent) {
    e?.preventDefault()
    if (!localPart(id) || busy) return
    setBusy(true)
    setError(null)
    try {
      await requestEmailCode(email)
      saveLastEmail(email)
      setSentAt(Date.now())
      setNow(Date.now())
      setCode('')
      setStep('code')
      // 처음 가입이면 학번 칸을 메일 앞부분(학번인 경우가 많음)으로 미리 채운다
      if (/^\d+$/.test(localPart(id))) setStudentId(localPart(id))
      setTimeout(() => codeInput.current?.focus(), 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  async function confirm(e: FormEvent) {
    e.preventDefault()
    if (code.length !== 6 || busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email, code, remember, signup ? { name: name.trim(), studentId: studentId.trim() } : undefined)
      signedIn()
      navigate(from, { replace: true })
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SIGNUP_INFO_REQUIRED') {
        // 번호는 맞았고 처음 가입이다. 번호는 아직 안 쓴 상태라 이름·학번을 붙여 다시 보내면 된다
        setSignup(true)
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요')
      }
    } finally {
      setBusy(false)
    }
  }

  if (step === 'email') {
    return (
      <main className="login">
        <div className="login-hero">
          <span className="login-school">조선대학교 IT융합대학</span>
          <h1>M-space</h1>
          <p>열쇠 없이, 예약만으로 문이 열려요</p>
        </div>
        <svg className="login-campus" viewBox="0 0 390 200" aria-hidden="true">
          <g fill="none" stroke="#FFFFFF" strokeWidth="1.5" strokeLinejoin="round">
            <path d="M20 190 V120 L40 98 L60 120 L80 98 L100 120 L120 98 L140 120 L160 98 V70 L195 22 L230 70 V98 L250 120 L270 98 L290 120 L310 98 L330 120 L350 98 L370 120 V190 Z" />
            <path d="M20 120 H160 M230 98 V120 H370" />
            <circle cx="195" cy="82" r="8" />
            <path d="M185 190 V172 a10 10 0 0 1 20 0 V190" />
          </g>
        </svg>
        <div className="login-mascot"><Spacey /></div>
        <form className="login-sheet" onSubmit={sendCode}>
          <label htmlFor="mail" className="login-label">학교 메일</label>
          <div className="mail-box">
            <input id="mail" value={id} onChange={(e) => setId(e.target.value)} autoComplete="username"
              inputMode="email" autoCapitalize="none" spellCheck={false} placeholder="학번 또는 아이디" required />
            <span className="muted">{DOMAIN}</span>
          </div>
          {error && <p role="alert" className="login-error">{error}</p>}
          <button className="btn-primary" disabled={busy || !localPart(id)}>{busy ? '보내는 중…' : '인증 코드 받기'}</button>
          <p className="muted login-help">메일로 온 6자리 코드를 넣으면 들어와요</p>
        </form>
      </main>
    )
  }

  return (
    <main className="code-page">
      <button type="button" className="back" aria-label="뒤로" onClick={() => { setStep('email'); setSignup(false); setError(null) }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
      </button>
      <form className="code-form" onSubmit={confirm}>
        <h1>메일로 보낸 코드 6자리를<br />넣어 주세요</h1>
        <span className="muted">{email}</span>

        <label className="code-boxes">
          <span className="sr-only">인증 코드 6자리</span>
          <input ref={codeInput} value={code} maxLength={6} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}"
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} aria-hidden="true" className={`code-box ${i === code.length ? 'at' : ''}`}>{code[i] ?? ''}</span>
          ))}
        </label>

        <div className="code-row">
          <span className="code-left">{left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 남음` : '코드가 만료됐어요'}</span>
          <button type="button" className="link-btn" disabled={!canResend || busy} onClick={() => sendCode()}>
            {canResend ? '코드 다시 받기' : `${RESEND_AFTER - elapsed}초 뒤 다시 받기`}
          </button>
        </div>

        {signup && (
          <fieldset className="signup">
            <legend>처음 오셨네요. 이름과 학번을 알려 주세요</legend>
            <label htmlFor="name">이름</label>
            <input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={50} required />
            <label htmlFor="sid">학번</label>
            <input id="sid" value={studentId} onChange={(e) => setStudentId(e.target.value.replace(/\D/g, ''))} inputMode="numeric" maxLength={20} required />
          </fieldset>
        )}

        <label className="remember">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          이 휴대폰에서 자동 로그인
        </label>

        {error && <p role="alert" className="login-error">{error}</p>}

        <div className="code-bottom">
          <span className="muted">메일이 안 오면 스팸함을 확인해 주세요</span>
          <button className="btn-primary" disabled={busy || code.length !== 6 || (signup && (!name.trim() || !studentId))}>
            {busy ? '확인하는 중…' : signup ? '가입하고 들어가기' : '확인'}
          </button>
        </div>
      </form>
    </main>
  )
}
