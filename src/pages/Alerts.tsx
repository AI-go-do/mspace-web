import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { agoLabel, getMyNotifications, notificationAction, type AppNotification } from '../api/notifications'
import { stillHere } from '../api/reservations'
import { ApiError, currentMemberId } from '../api/client'
import { useNow } from '../lib/useNow'
import './Alerts.css'

const REFRESH_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 알림함 (FR-NTF-103). 입실·종료·노쇼 직전·자리 비움 알림을 최근 것부터 보여 준다.
 * 화면이 열려 있는 동안 30초마다 다시 받는다. 읽음 표시 API는 아직 없어 서버의 read 값만 보여 준다
 */
export default function Alerts() {
  const [list, setList] = useState<AppNotification[] | null>(null)
  const [error, setError] = useState(false)
  const busy = useRef(false)
  // 화면을 보고 있는 동안 새 알림이 오면 화면 읽기 사용자에게 한 번만 알린다 (목록 전체를 다시 읽지 않게)
  const seen = useRef<Set<number> | null>(null)
  const [announce, setAnnounce] = useState('')
  const now = useNow(30_000)

  const load = useCallback(() => {
    if (busy.current) return
    // 이 화면을 연 회원의 알림만 받는다. 다른 탭에서 다른 회원으로 바뀌면 api가 요청을 막는다. 토큰이 아직 없으면 다음 확인을 기다린다
    const memberId = currentMemberId()
    if (memberId === null) return
    busy.current = true
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    getMyNotifications(abort.signal, memberId)
      .then((l) => {
        if (seen.current) {
          const fresh = l.filter((n) => !seen.current!.has(n.id)).length
          if (fresh) {
            // 같은 문구가 연달아 와도 다시 읽히게, 한 번 비웠다가 다음 틱에 넣는다
            setAnnounce('')
            setTimeout(() => setAnnounce(`새 알림 ${fresh}개`), 100)
          }
        }
        seen.current = new Set(l.map((n) => n.id))
        setList(l)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => { clearTimeout(timer); busy.current = false })
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <main className="alerts">
      <header className="alerts-head">
        <h1>알림</h1>
      </header>
      <p className="sr-only" aria-live="polite">{announce}</p>

      {error && (
        <p role="alert" className="alerts-msg">
          {list ? '새 알림을 못 받아왔어요. 잠시 뒤 다시 받아요.' : '알림을 못 불러왔어요.'}
          <button type="button" className="link-btn" onClick={load}>다시 받기</button>
        </p>
      )}

      {list === null && !error && <p className="alerts-msg muted">불러오는 중…</p>}

      {list?.length === 0 && (
        <div className="card alerts-empty">
          <b>아직 알림이 없어요</b>
          <span className="muted">입실 10분 전, 종료 10분 전, 자리를 오래 비웠을 때 여기로 알려 드려요.</span>
        </div>
      )}

      {!!list?.length && (
        <ul className="alerts-list">
          {list.map((n) => {
            const act = notificationAction(n)
            return (
              <li key={n.id} className={`card alert ${n.read ? '' : 'unread'} ${n.kind === 'AWAY_SOON' ? 'urgent' : ''}`}>
                <div className="alert-top">
                  {!n.read && <><i className="dot" aria-hidden="true" /><span className="sr-only">안 읽음</span></>}
                  <b className="alert-title">{n.title}</b>
                  <time className="alert-time" dateTime={n.createdAt}>{agoLabel(n.createdAt, now)}</time>
                </div>
                <p className="alert-body">{n.body}</p>
                {n.kind === 'AWAY_SOON' && n.reservationId != null
                  ? <AwayActions reservationId={n.reservationId} checkoutTo={act?.to} />
                  : act && <Link to={act.to} className="alert-link">{act.label}</Link>}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

/** "아직 있어요"를 누른 예약. 30초마다 목록을 다시 받아도, 화면을 다시 열어도 버튼이 되살아나지 않게 */
const stillHereDone = new Map<number, string>()

/**
 * 자리 비움 알림의 두 버튼 (FR-NTF-103, FR-DEV-103): "아직 있어요"(예약당 1번) · "퇴실할게요"(퇴실 화면으로).
 * 서버가 이미 썼다·꺼 뒀다·사용 중 아님이라고 하면 그 문구를 남기고 버튼을 거둔다
 */
function AwayActions({ reservationId, checkoutTo }: { reservationId: number; checkoutTo?: string }) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'error'; message: string } | { kind: 'done'; message: string }>(() => {
    const done = stillHereDone.get(reservationId)
    return done ? { kind: 'done', message: done } : { kind: 'idle' }
  })

  /** "아직 있어요"를 서버에 보내고 결과 문구로 버튼을 바꾼다 */
  async function press() {
    setState({ kind: 'sending' })
    try {
      await stillHere(reservationId)
      const message = '알겠어요. 자리 비움 시간을 지금부터 다시 잴게요.'
      stillHereDone.set(reservationId, message)
      setState({ kind: 'done', message })
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', '잠시 후 다시 눌러 주세요')
      if (['STILL_HERE_ALREADY_USED', 'STILL_HERE_DISABLED', 'RESERVATION_NOT_IN_USE'].includes(err.code)) {
        stillHereDone.set(reservationId, err.message)
        setState({ kind: 'done', message: err.message })
      } else setState({ kind: 'error', message: err.message })
    }
  }

  return (
    <div className="alert-actions">
      {state.kind === 'done'
        ? <p className="alert-note" role="status">{state.message}</p>
        : (
          <button type="button" className="btn-primary alert-btn" disabled={state.kind === 'sending'} onClick={() => void press()}>
            {state.kind === 'sending' ? '알리는 중…' : '아직 있어요'}
          </button>
        )}
      {state.kind === 'error' && <p className="alert-note err" role="alert">{state.message}</p>}
      {checkoutTo && <Link to={checkoutTo} className="btn-line alert-btn">퇴실할게요</Link>}
    </div>
  )
}
