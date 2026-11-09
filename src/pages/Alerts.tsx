import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { isApology, isDemoId } from '../api/apology'
import { agoLabel, announceUnreadChanged, getMyNotifications, markAllNotificationsRead, markNotificationRead, notificationAction, withRead, type AppNotification } from '../api/notifications'
import { stillHere } from '../api/reservations'
import { ApiError, currentMemberId } from '../api/client'
import { useNow } from '../lib/useNow'
import { useUnreadCount } from '../lib/useUnreadCount'
import './Alerts.css'

const REFRESH_MS = 30_000
/** 이 화면에서 읽음으로 바꾼 알림을 서버 값보다 앞세우는 시간. 지나면 서버가 준 읽음 상태를 따른다 */
const READ_OVERRIDE_MS = 30_000

/**
 * 앱 안에서 뒤로 갈 화면이 있는지. 라우터가 history.state.idx에 앱 안 몇 번째 화면인지 적어 둔다(처음 연 화면은 0).
 * history.length는 앞으로 갈 기록까지 세서, 주소로 바로 열었다가 돌아온 경우에도 1보다 커진다
 */
function hasBackEntry(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx
  return typeof idx === 'number' && idx > 0
}
const REQUEST_TIMEOUT_MS = 15_000

/**
 * 알림함 (FR-NTF-103). 입실·종료·노쇼 직전·자리 비움 알림을 최근 것부터 보여 준다.
 * 화면이 열려 있는 동안 30초마다 다시 받는다. 알림의 버튼을 누르면 그 알림을, "모두 읽음"을 누르면 전부 읽음으로 바꾼다(core #69)
 */
export default function Alerts() {
  const navigate = useNavigate()
  const [list, setList] = useState<AppNotification[] | null>(null)
  const [error, setError] = useState(false)
  const busy = useRef(false)
  // 화면을 보고 있는 동안 새 알림이 오면 화면 읽기 사용자에게 한 번만 알린다 (목록 전체를 다시 읽지 않게)
  const seen = useRef<Set<number> | null>(null)
  const [announce, setAnnounce] = useState('')
  const now = useNow(30_000)
  const [readingAll, setReadingAll] = useState(false)
  const [readError, setReadError] = useState(false)
  // 이 화면에서 읽음으로 바꾼 알림과 바꾼 시각. 서버 반영 전에 받은 목록(안 읽음)이 점을 다시 켜지 않게 잠깐만 덮어쓴다.
  // READ_OVERRIDE_MS가 지나면 서버 값을 그대로 믿는다
  const readHere = useRef<Map<number, number>>(new Map())
  // 지금 보이는 목록이 누구의 것인지. 다른 탭에서 다른 회원으로 바뀌면 앞 사람 목록을 지우고 다시 받으며, 그 전까지 읽음 버튼을 막는다
  const [owner, setOwner] = useState<number | null>(null)
  const ownerRef = useRef<number | null>(null)

  const load = useCallback(() => {
    if (busy.current) return
    // 이 화면을 연 회원의 알림만 받는다. 다른 탭에서 다른 회원으로 바뀌면 api가 요청을 막는다. 토큰이 아직 없으면 다음 확인을 기다린다
    const memberId = currentMemberId()
    if (memberId === null) return
    if (ownerRef.current !== null && ownerRef.current !== memberId) {
      ownerRef.current = null
      setOwner(null)
      setList(null)
      seen.current = null
      readHere.current.clear()
    }
    busy.current = true
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    getMyNotifications(abort.signal, memberId)
      .then((l) => {
        // 기다리는 사이 회원이 바뀌었으면 이 목록은 버린다(다음 조회가 새 회원 것을 받는다)
        if (currentMemberId() !== memberId) return
        if (seen.current) {
          const fresh = l.filter((n) => !seen.current!.has(n.id)).length
          if (fresh) {
            // 같은 문구가 연달아 와도 다시 읽히게, 한 번 비웠다가 다음 틱에 넣는다
            setAnnounce('')
            setTimeout(() => setAnnounce(`새 알림 ${fresh}개`), 100)
          }
        }
        seen.current = new Set(l.map((n) => n.id))
        const at = Date.now()
        readHere.current.forEach((t, id) => { if (at - t > READ_OVERRIDE_MS) readHere.current.delete(id) })
        setList(l.map((n) => (!n.read && readHere.current.has(n.id) ? { ...n, read: true } : n)))
        ownerRef.current = memberId
        setOwner(memberId)
        setError(false)
      })
      .catch(() => setError(true))
      .finally(() => { clearTimeout(timer); busy.current = false })
  }, [])

  /** 알림 하나 읽음. 화면을 먼저 바꾸고 서버에 알린다. 실패해도 갈 곳으로는 그대로 간다(다음 조회 때 점이 다시 보임) */
  const readOne = useCallback((id: number) => {
    const memberId = currentMemberId()
    if (memberId === null || memberId !== ownerRef.current || readHere.current.has(id)) return
    readHere.current.set(id, Date.now())
    setList((l) => (l ? withRead(l, id) : l))
    markNotificationRead(id, memberId)
      .then(announceUnreadChanged)
      .catch(() => { readHere.current.delete(id) })
  }, [])

  /** 지금 보이는 알림 모두 읽음. 보내는 동안 버튼을 막는다 */
  async function readAll() {
    const memberId = currentMemberId()
    if (memberId === null || memberId !== ownerRef.current || readingAll || !list) return
    setReadingAll(true)
    setReadError(false)
    const ids = list.filter((n) => !n.read).map((n) => n.id)
    try {
      await markAllNotificationsRead(memberId)
      const at = Date.now()
      ids.forEach((id) => readHere.current.set(id, at))
      setList((l) => (l ? l.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)) : l))
      announceUnreadChanged()
    } catch {
      setReadError(true)
    } finally {
      setReadingAll(false)
    }
  }

  // 받은 목록(최근 것만)에는 없는 예전 안 읽은 알림도 있을 수 있어서, 서버가 센 안 읽은 수와 큰 쪽을 쓴다
  // 목록 주인이 지금 회원일 때만 센다(바뀐 직후 새 회원 숫자로 앞 사람 목록에 버튼을 띄우지 않게)
  const serverUnread = useUnreadCount()
  const mine = owner !== null && owner === currentMemberId()
  // 앞 회원 목록은 보이지 않게(다음 조회가 새 회원 것을 받을 때까지 불러오는 중으로)
  const shown = mine ? list : null
  const unread = mine ? Math.max(list?.filter((n) => !n.read).length ?? 0, serverUnread ?? 0) : 0

  useEffect(() => {
    load()
    const id = setInterval(load, REFRESH_MS)
    return () => clearInterval(id)
  }, [load])

  return (
    <main className="alerts">
      <header className="alerts-head">
        {/* 알림함은 아래 탭에 없고 홈 종 버튼으로만 들어와서, 돌아갈 길을 위에 둔다 */}
        <button type="button" className="back" aria-label="뒤로"
          onClick={() => (hasBackEntry() ? navigate(-1) : navigate('/'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div>
          <h1>알림</h1>
          <span className="muted alerts-sub">입실·종료 10분 전, 자리 비움을 알려 드려요</span>
        </div>
        {unread > 0 && (
          <button type="button" className="link-btn alerts-readall" disabled={readingAll || !list || !mine} onClick={() => void readAll()}>
            {readingAll ? '읽는 중…' : `모두 읽음 (${unread})`}
          </button>
        )}
      </header>
      {readError && <p role="alert" className="alerts-msg">읽음으로 바꾸지 못했어요. 잠시 후 다시 눌러 주세요.</p>}
      <p className="sr-only" aria-live="polite">{announce}</p>

      {error && (
        <p role="alert" className="alerts-msg">
          {shown ? '새 알림을 못 받아왔어요. 잠시 뒤 다시 받아요.' : '알림을 못 불러왔어요.'}
          <button type="button" className="link-btn" onClick={load}>다시 받기</button>
        </p>
      )}

      {/* 처음 받는 동안 알림 카드 세 장 자리를 미리 그려 둔다(화면이 튀지 않게) */}
      {shown === null && !error && (
        <ul className="alerts-list" aria-busy="true" aria-label="알림 불러오는 중">
          {[0, 1, 2].map((i) => (
            <li key={i} className="card alert alert-skeleton" aria-hidden="true">
              <span className="sk-bar" style={{ width: '52%' }} /><span className="sk-bar" style={{ width: '88%' }} /><span className="sk-bar" style={{ width: '64%' }} />
            </li>
          ))}
        </ul>
      )}

      {shown?.length === 0 && (
        <div className="card alerts-empty">
          <span className="alerts-empty-icon" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </span>
          <b>아직 알림이 없어요</b>
          <span className="muted">입실 10분 전, 종료 10분 전, 자리를 오래 비웠을 때 여기로 알려 드려요.</span>
        </div>
      )}

      {!!shown?.length && (
        <ul className="alerts-list">
          {shown.map((n) => {
            const act = notificationAction(n)
            return (
              <li key={n.id} className={`card alert ${n.read ? '' : 'unread'} ${n.kind === 'AWAY_SOON' ? 'urgent' : ''} ${isApology(n) ? 'apology-alert' : ''} ${n.kind === 'CO2_SOON' ? 'co2-alert' : ''}`}>
                <div className="alert-top">
                  {!n.read && <><i className="dot" aria-hidden="true" /><span className="sr-only">안 읽음</span></>}
                  <b className="alert-title">{n.title}</b>
                  {isDemoId(n.id) && <span className="alert-sample">예시</span>}
                  <time className="alert-time" dateTime={n.createdAt}>{agoLabel(n.createdAt, now)}</time>
                </div>
                <p className="alert-body">{n.body}</p>
                {n.kind === 'AWAY_SOON' && n.reservationId != null
                  ? <AwayActions reservationId={n.reservationId} checkoutTo={act?.to} onUse={() => readOne(n.id)} />
                  : act && <Link to={act.to} className="alert-link" onClick={() => readOne(n.id)}>{act.label}</Link>}
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
 * "아직 있어요" 보내기 (FR-DEV-103). 알림함과 내 예약의 사용 중 카드가 같이 쓴다(누른 기록을 함께 본다).
 * 서버가 이미 썼다·꺼 뒀다·사용 중 아님이라고 하면 그 문구를 남기고 버튼을 거둔다
 */
export function useStillHere(reservationId: number) {
  const [state, setState] = useState<{ kind: 'idle' | 'sending' } | { kind: 'error'; message: string } | { kind: 'done'; message: string }>(() => {
    const done = stillHereDone.get(reservationId)
    return done ? { kind: 'done', message: done } : { kind: 'idle' }
  })

  /** "아직 있어요"를 서버에 보내고 결과 문구로 버튼을 바꾼다 */
  async function press() {
    if (state.kind === 'sending') return
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
  return { state, press }
}

/** 자리 비움 알림의 두 버튼 (FR-NTF-103, FR-DEV-103): "아직 있어요"(예약당 1번) · "퇴실할게요"(퇴실 화면으로) */
function AwayActions({ reservationId, checkoutTo, onUse }: { reservationId: number; checkoutTo?: string; onUse: () => void }) {
  const { state, press } = useStillHere(reservationId)

  return (
    <div className="alert-actions">
      {state.kind === 'done'
        ? <p className="alert-note" role="status">{state.message}</p>
        : (
          <button type="button" className="btn-primary alert-btn" disabled={state.kind === 'sending'} onClick={() => { onUse(); void press() }}>
            {state.kind === 'sending' ? '알리는 중…' : '아직 있어요'}
          </button>
        )}
      {state.kind === 'error' && <p className="alert-note err" role="alert">{state.message}</p>}
      {checkoutTo && <Link to={checkoutTo} className="btn-line alert-btn" onClick={onUse}>퇴실할게요</Link>}
    </div>
  )
}
