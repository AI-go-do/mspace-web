import { useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { findMember, type FoundMember } from '../api/members'
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
          <button type="button" className="btn-line" onClick={onHome}>홈으로</button>
          <button type="button" className="btn-primary" autoFocus onClick={onNext}>{denied.action}</button>
        </div>
      </div>
    </div>
  )
}

/** 함께 쓸 사람 (FR-RSV-004·005, 시안 Members): 학번으로 찾아 한 명씩 넣고 뺀다 */
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
}) {
  const { title, room, when, people, setPeople, count, min, max, onBack, onDone, doneLabel, busy = false, busyLabel } = props
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundMember | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  // 검색 중에 학번을 고치면 늦게 온 옛 결과가 새 학번 옆에 뜨지 않게 버린다
  const searchSeq = useRef(0)

  function changeQuery(v: string) {
    searchSeq.current++
    setQuery(v)
    setFound(null)
    setMsg(null)
    setSearching(false)
  }

  async function search(e: FormEvent) {
    e.preventDefault()
    const sid = query.trim()
    if (!sid || searching) return
    const seq = ++searchSeq.current
    setSearching(true)
    setFound(null)
    setMsg(null)
    try {
      const member = await findMember(sid)
      if (seq === searchSeq.current) setFound(member)
    } catch (err) {
      if (seq !== searchSeq.current) return
      setMsg(err instanceof ApiError && err.code === 'MEMBER_NOT_FOUND'
        ? `${sid}는 찾을 수 없어요. 학교 메일로 가입한 사람만 넣을 수 있어요.`
        : err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요')
    } finally {
      if (seq === searchSeq.current) setSearching(false)
    }
  }

  // 본인(대표자)은 이미 인원에 들어 있어 다시 넣지 않는다 (core #66 me)
  const self = !!found?.me
  const added = !!found && (self || people.some((p) => p.studentId === found.studentId))
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
        <form className="search" onSubmit={search}>
          <label htmlFor="sid" className="sr-only">학번으로 찾기</label>
          <input id="sid" value={query} onChange={(e) => changeQuery(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" placeholder="학번으로 찾기" maxLength={20} />
          <button className="search-btn" disabled={!query || searching || busy}>{searching ? '찾는 중' : '찾기'}</button>
        </form>
      </header>

      {found && (
        <div className="card found">
          <span className="avatar">{found.name.slice(0, 1)}</span>
          <span className="who"><b>{found.name}</b><span className="muted">{found.studentId} · {self ? '나 (대표자)' : '찾은 사람'}</span></span>
          {added ? <span className="muted strong">추가됨</span> : (
            <button type="button" className="add-btn" disabled={busy} onClick={() => { setPeople([...people, found]); setQuery('') }}>추가</button>
          )}
        </div>
      )}
      {msg && <p role="alert" className="notice">{msg}</p>}

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
