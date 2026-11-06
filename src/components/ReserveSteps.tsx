import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { currentMemberId } from '../api/client'
import { filterFriends, friendErrorMessage, getFriends, requestFriend, type Friend } from '../api/friends'
import type { FoundMember } from '../api/members'
import type { RoomSlots } from '../api/rooms'
import type { Denied } from '../content/denied'
import { SANCTION, agreeRules, saveAgreed } from '../content/rules'
import '../pages/Reserve.css'

/** 예약(FR-WEB-001)과 지금 바로 쓰기(FR-WEB-102)가 같이 쓰는 단계 화면 */

export const BackIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
)

/** 멱등 키. http(LAN 주소)에서는 crypto.randomUUID가 없어서 대신 만든다 */
export function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/** 예약 전 수칙 동의 (시안 Rules). 처음 예약할 때와 수칙이 바뀌었을 때만 띄운다 */
export function RulesAgree(props: { sub: string; noShowAt: string; instant?: boolean; busy: boolean; onBack: () => void; onAgree: () => void }) {
  const { sub, noShowAt, instant, busy, onBack, onAgree } = props
  const [agreed, setAgreed] = useState(false)
  return (
    <section className="rules-agree">
      <header className="rs-head">
        <div className="rs-title">
          <button type="button" className="back" aria-label="뒤로" onClick={onBack}><BackIcon /></button>
          <div>
            <h1>예약 전에 확인해 주세요</h1>
            <span className="muted sub">{sub}</span>
          </div>
        </div>
      </header>
      <div className="card rule-list">
        {agreeRules(noShowAt, instant).map((r) => (
          <div key={r.tag} className="rule">
            <span className={`rule-tag ${r.strong ? 'strong' : ''}`}>{r.tag}</span>
            <span className="rule-text"><b>{r.title}</b><span className="muted">{r.body}</span></span>
          </div>
        ))}
        <p className="sanction">{SANCTION}</p>
      </div>
      <div className="rs-bar">
        <label className="agree-check">
          <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
          모두 읽었고 지킬게요
        </label>
        <button type="button" className="btn-primary" disabled={!agreed || busy}
          onClick={() => { saveAgreed(); onAgree() }}>
          {busy ? '예약하는 중…' : '동의하고 예약하기'}
        </button>
        <span className="muted center small">처음 예약할 때와 규칙이 바뀌었을 때만 보여요</span>
      </div>
    </section>
  )
}

/** 예약이 안 될 때 아래 시트 (FR-WEB-006, 시안 Denied) */
export function DeniedSheet(props: { denied: Denied & { message: string }; onClose: () => void; onHome: () => void; onNext: () => void }) {
  const { denied, onClose, onHome, onNext } = props
  const navigate = useNavigate()
  // 처리됐는지 모를 때: 홈으로 떠나지 말고 내 예약에서 바로 확인하게 한다
  const onMine = () => navigate('/me')
  return (
    <div className="sheet-wrap">
      <div className="sheet-dim" onClick={onClose} aria-hidden="true" />
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="denied-title">
        <span className="sheet-icon" aria-hidden="true">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#15233D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9.5" /></svg>
        </span>
        <h2 id="denied-title">{denied.title}</h2>
        <p className="muted">{denied.hint ?? denied.message}</p>
        <div className="sheet-actions">
          {denied.unsure
            ? <button type="button" className="btn-line" onClick={onMine}>내 예약 확인</button>
            : <button type="button" className="btn-line" onClick={onHome}>홈으로</button>}
          <button type="button" className="btn-primary" autoFocus onClick={onNext}>{denied.action}</button>
        </div>
      </div>
    </div>
  )
}

/**
 * 함께 쓸 사람 (FR-RSV-004·005, 시안 Members). 서로 수락한 친구만 넣을 수 있어서(core #68) 내 친구 목록에서 고른다.
 * 검색은 친구 안에서만 한다(아무 학번이나 쳐서 남의 이름을 보지 않게, 재웅 11/6).
 * 친구가 아닌 학번을 치면 그 자리에서 친구 요청을 보낼 수 있다(상대가 수락해야 넣을 수 있음)
 */
export function Members(props: {
  title: string
  room: RoomSlots | null
  when: string
  people: FoundMember[]
  setPeople: (p: FoundMember[]) => void
  count: number
  min: number
  max: number
  onBack: () => void
  /** 인원이 맞을 때 아래 버튼. 없으면 onBack (인원만 정하고 돌아감) */
  onDone?: () => void
  /** 아래 버튼 글자. 기본 "N명으로 정하기" */
  doneLabel?: string
  /** onDone이 예약을 보내는 중이면 true: 버튼·뒤로·사람 넣고 빼기를 막는다 */
  busy?: boolean
  busyLabel?: string
  /** 아래 버튼 바로 위에 늘 보이는 안내 (예: 즉시 시작은 취소가 안 된다는 경고) */
  barNote?: ReactNode
}) {
  const { title, room, when, people, setPeople, count, min, max, onBack, onDone, doneLabel, busy = false, busyLabel, barNote } = props
  const [query, setQuery] = useState('')
  const [friends, setFriends] = useState<Friend[] | null>(null)
  // 이미 친구 요청을 보낸 학번. 같은 사람에게 또 보내지 않고 "수락 기다리는 중"으로 보여 준다
  const [sent, setSent] = useState<ReadonlySet<string>>(new Set())
  const [loadError, setLoadError] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const active = useRef<AbortController | null>(null)

  const loadFriends = useCallback(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    active.current?.abort()
    const ctrl = new AbortController()
    active.current = ctrl
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    getFriends(ctrl.signal, memberId)
      .then((d) => {
        if (active.current !== ctrl) return
        setFriends(d.friends)
        setSent(new Set(d.sent.map((r) => r.studentId)))
        setLoadError(false)
      })
      .catch(() => { if (active.current === ctrl) setLoadError(true) })
      .finally(() => { clearTimeout(timer); if (active.current === ctrl) active.current = null })
  }, [])

  useEffect(() => {
    loadFriends()
    // 친구 화면이나 다른 폰에서 상대가 수락하고 돌아오면 바로 보이게
    const onVisible = () => { if (document.visibilityState === 'visible') loadFriends() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      active.current?.abort()
      active.current = null
    }
  }, [loadFriends])

  const sid = query.trim()
  const shown = friends ? filterFriends(friends, sid).filter((f) => !people.some((p) => p.studentId === f.studentId)) : []
  // 친구 중에 없는 학번(8자리 이상 숫자)을 쳤을 때만 친구 요청을 권한다
  const notFriend = !!friends && /^\d{8,}$/.test(sid) && !friends.some((f) => f.studentId === sid)

  async function sendRequest() {
    const memberId = currentMemberId()
    if (memberId === null || sending) return
    setSending(true)
    setMsg(null)
    try {
      const r = await requestFriend(sid, memberId)
      if (r.status === 'PENDING') setSent((prev) => new Set(prev).add(r.studentId))
      setMsg(r.status === 'ACCEPTED'
        ? `${r.name}님이 먼저 요청해 두어서 바로 친구가 됐어요. 아래에서 추가해 주세요.`
        : `${r.name}님에게 친구 요청을 보냈어요. 수락하면 함께 넣을 수 있어요.`)
      loadFriends()
    } catch (e) {
      setMsg(friendErrorMessage(e))
    } finally {
      setSending(false)
    }
  }

  // 인원이 안 맞으면 아래 버튼을 막고 몇 명이 더 필요한지 알려 준다 (돌아가서 예약하다 또 막히지 않게, 11/5 재웅 피드백)
  const countOk = count >= min && count <= max
  const note = count < min ? `${min - count}명 더 필요해요` : count > max ? `최대 ${max}명이에요` : `인원 맞아요 (${min}–${max}명)`

  return (
    <section className="members">
      <header className="rs-head">
        <div className="rs-title">
          <button type="button" className="back" aria-label="뒤로" onClick={onBack} disabled={busy}><BackIcon /></button>
          <div>
            <h1>함께 쓸 사람</h1>
            <span className="muted sub">{title}{room ? ` · ${room.minPeople}–${room.maxPeople}명 방` : ''}{when ? ` · ${when}` : ''}</span>
          </div>
        </div>
        <div className="search">
          <label htmlFor="sid" className="sr-only">친구 학번이나 이름으로 찾기</label>
          <input id="sid" value={query} onChange={(e) => { setQuery(e.target.value); setMsg(null) }}
            placeholder="친구 학번이나 이름으로 찾기" maxLength={20} disabled={busy} />
        </div>
      </header>

      {loadError && (
        <p role="alert" className="notice">
          친구 목록을 못 불러왔어요. <button type="button" className="link-btn" onClick={loadFriends}>다시 받기</button>
        </p>
      )}
      {!friends && !loadError && <p className="notice muted" role="status">친구 목록 불러오는 중…</p>}
      {friends?.length === 0 && !sid && (
        <p className="notice">아직 친구가 없어요. 함께 쓸 사람의 학번을 위에 치면 친구 요청을 보낼 수 있어요.</p>
      )}

      {shown.length > 0 && (
        <div className="card found-list" aria-label="내 친구">
          {shown.map((f) => (
            <div key={f.studentId} className="person">
              <span className="avatar">{f.name.slice(0, 1)}</span>
              <span className="who"><b>{f.name}</b><span className="muted">{f.studentId} · 친구</span></span>
              <button type="button" className="add-btn" disabled={busy}
                onClick={() => { setPeople([...people, { studentId: f.studentId, name: f.name }]); setQuery('') }}>추가</button>
            </div>
          ))}
        </div>
      )}
      {notFriend && (
        <div className="card found">
          <span className="who"><b>{sid}</b><span className="muted">친구가 아니라 넣을 수 없어요. 상대가 수락하면 넣을 수 있어요</span></span>
          {sent.has(sid)
            ? <span className="muted strong">요청 보냄</span>
            : (
              <button type="button" className="add-btn" disabled={sending || busy} onClick={() => void sendRequest()}>
                {sending ? '보내는 중' : '친구 요청'}
              </button>
            )}
        </div>
      )}
      {friends && sid && !shown.length && !notFriend && <p className="notice muted">친구 중에 맞는 사람이 없어요.</p>}
      {msg && <p role="status" className="notice">{msg}</p>}

      <div className="card people">
        <div className="people-head">
          <span>함께 쓰는 사람 {count}명</span>
          <span className="count-note"><i className={countOk ? 'ok' : ''} />{note}</span>
        </div>
        <div className="person">
          <span className="avatar me">나</span>
          <span className="who"><b>나</b><span className="muted">대표자</span></span>
        </div>
        {people.map((p) => (
          <div key={p.studentId} className="person">
            <span className="avatar">{p.name.slice(0, 1)}</span>
            <span className="who"><b>{p.name}</b><span className="muted">{p.studentId}</span></span>
            <button type="button" className="remove" aria-label={`${p.name} 빼기`} disabled={busy}
              onClick={() => setPeople(people.filter((x) => x.studentId !== p.studentId))}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ))}
      </div>

      <div className="rs-bar">
        {barNote}
        {!countOk && (
          <p className="count-hint" role="status">
            {count < min ? <><b>{min - count}명</b> 더 추가하면 예약할 수 있어요</> : <>최대 {max}명이에요. <b>{count - max}명</b>을 빼 주세요</>}
          </p>
        )}
        <button type="button" className="btn-primary" disabled={!countOk || busy} onClick={onDone ?? onBack}>
          {busy && busyLabel ? busyLabel : doneLabel ?? `${count}명으로 정하기`}
        </button>
      </div>
    </section>
  )
}
