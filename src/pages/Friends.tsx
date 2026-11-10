import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentMemberId } from '../api/client'
import {
  acceptFriend, cancelFriendRequest, declineFriend, friendErrorMessage, getFriends, removeFriend, requestFriend,
  type FriendList,
} from '../api/friends'
import { BackIcon } from '../components/ReserveSteps'
import './Friends.css'
import { IconButton } from '../components/IconAction'

const REQUEST_TIMEOUT_MS = 15_000

/**
 * 친구 (FR-RSV-004 변경, core #68). 예약 참여자는 서로 수락한 친구만 넣을 수 있어서,
 * 학번으로 친구 요청을 보내고, 받은 요청을 수락·거절하고, 보낸 요청을 취소하고, 친구를 끊는다
 */
export default function Friends() {
  const navigate = useNavigate()
  const [data, setData] = useState<FriendList | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [sid, setSid] = useState('')
  // 지금 처리 중인 일(버튼 하나). 처리하는 동안 다른 버튼도 막아 겹친 요청을 보내지 않는다
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null)
  const active = useRef<AbortController | null>(null)

  const load = useCallback(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    active.current?.abort()
    const ctrl = new AbortController()
    active.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
    getFriends(ctrl.signal, memberId)
      .then((d) => { if (active.current === ctrl) { setData(d); setLoadError(false) } })
      .catch(() => { if (active.current === ctrl) setLoadError(true) })
      .finally(() => { clearTimeout(timer); if (active.current === ctrl) active.current = null })
  }, [])

  useEffect(() => {
    load()
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      active.current?.abort()
      active.current = null
    }
  }, [load])

  /** 버튼 하나의 일을 처리하고, 성공·실패 문구를 보이고, 목록을 새로 받는다 */
  async function run(key: string, work: (member: number) => Promise<string>) {
    const memberId = currentMemberId()
    if (memberId === null || busy) return
    setBusy(key)
    setMsg(null)
    try {
      setMsg({ text: await work(memberId), error: false })
    } catch (e) {
      setMsg({ text: friendErrorMessage(e), error: true })
    } finally {
      setBusy(null)
      load()
    }
  }

  function send(e: FormEvent) {
    e.preventDefault()
    const studentId = sid.trim()
    if (!studentId) return
    void run('send', async (m) => {
      const r = await requestFriend(studentId, m)
      setSid('')
      return r.status === 'ACCEPTED' ? `${r.name}님이 먼저 요청해 두어서 바로 친구가 됐어요.` : `${r.name}님에게 친구 요청을 보냈어요.`
    })
  }

  return (
    <main className="friends">
      <header className="friends-head">
        <button type="button" className="back" aria-label="뒤로" onClick={() => navigate('/me')}><BackIcon /></button>
        <div>
          <h1>친구</h1>
          <span className="muted friends-sub">서로 수락한 친구만 예약에 함께 넣을 수 있어요</span>
        </div>
      </header>

      <form className="card friends-add" onSubmit={send}>
        <label htmlFor="friend-sid"><b>학번으로 친구 요청</b></label>
        <div className="search">
          <input id="friend-sid" value={sid} onChange={(e) => setSid(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" placeholder="친구 학번" maxLength={20} disabled={!!busy} />
          <button className="search-btn" disabled={!sid || !!busy}>{busy === 'send' ? '보내는 중' : '요청'}</button>
        </div>
      </form>
      {msg && <p role={msg.error ? 'alert' : 'status'} className={`friends-msg ${msg.error ? 'err' : ''}`}>{msg.text}</p>}
      {loadError && (
        <p role="alert" className="friends-msg err">
          친구 목록을 못 불러왔어요. <IconButton icon="refresh" label="다시 받기" onClick={load} />
        </p>
      )}
      {!data && !loadError && <p className="friends-msg muted" role="status">불러오는 중…</p>}

      {data && data.received.length > 0 && (
        <section className="card friends-sec" aria-labelledby="received-title">
          <h2 id="received-title">받은 요청 {data.received.length}</h2>
          {data.received.map((r) => (
            <div key={r.requestId} className="person">
              <span className="avatar">{r.name.slice(0, 1)}</span>
              <span className="who"><b>{r.name}</b><span className="muted">{r.studentId}</span></span>
              <span className="friends-actions">
                <button type="button" className="add-btn" disabled={!!busy}
                  onClick={() => void run(`acc${r.requestId}`, async (m) => { await acceptFriend(r.requestId, m); return `${r.name}님과 친구가 됐어요.` })}>
                  {busy === `acc${r.requestId}` ? '수락 중' : '수락'}
                </button>
                <IconButton icon="close" label="거절" disabled={!!busy}
                  onClick={() => void run(`dec${r.requestId}`, async (m) => { await declineFriend(r.requestId, m); return '요청을 거절했어요.' })} />
              </span>
            </div>
          ))}
        </section>
      )}

      {data && (
        <section className="card friends-sec" aria-labelledby="friends-title">
          <h2 id="friends-title">내 친구 {data.friends.length}</h2>
          {data.friends.length === 0 && <p className="muted friends-empty">아직 친구가 없어요. 함께 방을 쓸 사람의 학번으로 요청을 보내 보세요.</p>}
          {data.friends.map((f) => (
            <div key={f.studentId} className="person">
              <span className="avatar">{f.name.slice(0, 1)}</span>
              <span className="who"><b>{f.name}</b><span className="muted">{f.studentId}</span></span>
              <IconButton icon="userMinus" label={busy === `rm${f.studentId}` ? '끊는 중' : '친구 끊기'} disabled={!!busy}                onClick={() => {
                  if (!window.confirm(`${f.name}님과 친구를 끊을까요? 이미 잡은 예약은 그대로예요.`)) return
                  void run(`rm${f.studentId}`, async (m) => { await removeFriend(f.studentId, m); return `${f.name}님과 친구를 끊었어요.` })
                }} />
            </div>
          ))}
        </section>
      )}

      {data && data.sent.length > 0 && (
        <section className="card friends-sec" aria-labelledby="sent-title">
          <h2 id="sent-title">보낸 요청 {data.sent.length}</h2>
          {data.sent.map((r) => (
            <div key={r.requestId} className="person">
              <span className="avatar">{r.name.slice(0, 1)}</span>
              <span className="who"><b>{r.name}</b><span className="muted">{r.studentId} · 수락 기다리는 중</span></span>
              <IconButton icon="close" label={busy === `can${r.requestId}` ? '취소 중' : '요청 취소'} disabled={!!busy}
                onClick={() => void run(`can${r.requestId}`, async (m) => { await cancelFriendRequest(r.requestId, m); return '요청을 취소했어요.' })} />
            </div>
          ))}
        </section>
      )}
    </main>
  )
}
