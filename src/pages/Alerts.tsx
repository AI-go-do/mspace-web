import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { agoLabel, getMyNotifications, notificationAction, type AppNotification } from '../api/notifications'
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
  const now = useNow(30_000)

  const load = useCallback(() => {
    if (busy.current) return
    busy.current = true
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    getMyNotifications(abort.signal)
      .then((l) => { setList(l); setError(false) })
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
                  {!n.read && <i className="dot" aria-label="안 읽음" />}
                  <b className="alert-title">{n.title}</b>
                  <time className="alert-time" dateTime={n.createdAt}>{agoLabel(n.createdAt, now)}</time>
                </div>
                <p className="alert-body">{n.body}</p>
                {act && <Link to={act.to} className={n.kind === 'AWAY_SOON' ? 'btn-primary alert-btn' : 'alert-link'}>{act.label}</Link>}
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}
