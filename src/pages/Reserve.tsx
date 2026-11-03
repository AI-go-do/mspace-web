import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { findMember, type FoundMember } from '../api/members'
import { createReservation } from '../api/reservations'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { deniedFor, type Denied } from '../content/denied'
import { SANCTION, agreeRules, hasAgreed, saveAgreed } from '../content/rules'
import { seoulClock, seoulDate } from '../lib/time'
import { dayLabel, lengthLabel, slotClock, tapSlot, weekChips, type Pick } from '../lib/slots'
import './Reserve.css'

type Step = 'time' | 'members' | 'rules'

const BackIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
)

/** http(LAN 주소)에서는 crypto.randomUUID가 없어서 대신 만든다 */
function newKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * FR-WEB-001 예약 화면: 날짜 칩 7개 → 30분 칸(하루 48칸 한 화면) → 함께 쓸 사람 → (처음·수칙 변경 때만) 수칙 동의 → 예약.
 * 거절되면 FR-WEB-006 아래 시트로 이유와 다음 행동을 보여 준다.
 */
export default function Reserve() {
  const roomId = Number(useParams().roomId)
  const navigate = useNavigate()
  const today = seoulDate()
  const chips = useMemo(() => weekChips(today), [today])

  const [date, setDate] = useState(today)
  const [room, setRoom] = useState<RoomSlots | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [pick, setPick] = useState<Pick | null>(null)
  const [step, setStep] = useState<Step>('time')
  const [people, setPeople] = useState<FoundMember[]>([])
  const [agreed, setAgreed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<(Denied & { message: string }) | null>(null)
  const [now, setNow] = useState(() => new Date())

  const load = useCallback(() => {
    setLoadError(null)
    return getAvailability(date)
      .then((r) => {
        const found = r.data.rooms.find((x) => x.roomId === roomId) ?? null
        setRoom(found)
        if (!found) setLoadError('없는 방이에요')
      })
      .catch((e: Error) => setLoadError(e.message))
  }, [date, roomId])

  useEffect(() => {
    setPick(null)
    setNow(new Date())
    load()
  }, [load])

  // 같은 내용으로 다시 보내면 같은 키 → 서버가 예약을 두 번 만들지 않는다
  const idemKey = useRef(newKey())
  useEffect(() => {
    idemKey.current = newKey()
  }, [date, pick, people])

  const slots = room?.slots ?? []
  const free = slots.map((s) => s.available && Date.parse(s.startAt) >= now.getTime())
  const count = people.length + 1 // 대표자(나) 포함
  const min = room?.minPeople ?? 1
  const max = room?.maxPeople ?? 99
  const countOk = count >= min && count <= max
  const range = pick ? `${slotClock(pick.start)} – ${slotClock(pick.start + pick.len)}` : '시간을 골라 주세요'

  async function submit() {
    if (!pick || !room || busy) return
    setBusy(true)
    try {
      const created = await createReservation(
        {
          roomId,
          startAt: slots[pick.start].startAt,
          endAt: slots[pick.start + pick.len - 1].endAt,
          participantStudentIds: people.map((p) => p.studentId),
        },
        idemKey.current,
      )
      navigate(`/reservations/${created.id}`, { state: { created } })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return // 로그인 화면으로 간다
      const code = e instanceof ApiError ? e.code : 'NETWORK'
      const message = e instanceof Error ? e.message : '잠시 후 다시 시도해 주세요'
      setDenied({ ...deniedFor(code), message })
    } finally {
      setBusy(false)
    }
  }

  function reserve() {
    if (!pick) return
    if (!countOk) return setStep('members')
    if (!hasAgreed()) return setStep('rules')
    submit()
  }

  function followDenied() {
    const d = denied
    setDenied(null)
    if (!d) return
    if (d.next === 'mine') return navigate('/me')
    if (d.next === 'members') return setStep('members')
    if (d.next === 'retry') return submit()
    setStep('time')
    setPick(null)
    setNow(new Date())
    load()
  }

  const title = `창작실 ${roomId}`
  const when = pick ? `${date === today ? '오늘' : dayLabel(date)} ${range}` : ''

  return (
    <main className="reserve">
      {step === 'time' && (
        <>
          <header className="rs-head">
            <div className="rs-title">
              <button type="button" className="back" aria-label="뒤로" onClick={() => navigate(-1)}><BackIcon /></button>
              <h1>{title} {room && <span className="muted">{room.minPeople}–{room.maxPeople}명</span>}</h1>
            </div>
            <div className="days" role="group" aria-label="날짜">
              {chips.map((c) => (
                <button key={c.date} type="button" aria-pressed={c.date === date} onClick={() => setDate(c.date)}
                  aria-label={c.weekday === '오늘' ? `오늘 ${dayLabel(c.date)}` : dayLabel(c.date)}>
                  <span className="wd">{c.weekday}</span>
                  <span className="dn">{c.day}</span>
                </button>
              ))}
            </div>
          </header>

          <section className="card rs-grid-card" aria-labelledby="grid-title">
            <div className="rs-grid-head">
              <h2 id="grid-title">하루 전체 · 30분 칸</h2>
              <span className="legend">
                <span><i className="lg lg-taken-slot" />예약됨</span>
                <span><i className="lg lg-pick" />선택</span>
              </span>
            </div>
            {loadError && <p role="alert" className="muted">시간표를 못 불러왔어요. {loadError}</p>}
            <div className="slot-grid">
              {slots.map((s, i) => {
                const past = Date.parse(s.startAt) < now.getTime()
                const taken = !past && !s.available
                const on = !!pick && i >= pick.start && i < pick.start + pick.len
                const label = `${slotClock(i)} ${taken ? '예약됨' : past ? '지난 시간' : on ? '선택됨' : '비어 있음'}`
                return (
                  <button key={s.startAt} type="button" className={`slot ${taken ? 'taken' : ''} ${past ? 'past' : ''} ${on ? 'on' : ''}`}
                    disabled={!free[i]} aria-pressed={on} aria-label={label} onClick={() => setPick(tapSlot(pick, i, free))}>
                    {slotClock(i)}
                  </button>
                )
              })}
            </div>
            <span className="guide">시작 칸을 누르고 끝 칸을 누르세요 · 최대 2시간(4칸) · 지난 시간은 흐리게 보여요</span>
          </section>

          <div className="rs-bar">
            <div className="rs-bar-row">
              <span className="rs-when">
                <span className="muted">{dayLabel(date)}{pick ? ` · ${lengthLabel(pick.len)}` : ''}</span>
                <b>{range}</b>
              </span>
              <button type="button" className="people-chip" onClick={() => setStep('members')}>
                함께 {count}명
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
            <button type="button" className="btn-primary" disabled={!pick || busy} onClick={reserve}>
              {busy ? '예약하는 중…' : '예약하기'}
            </button>
          </div>
        </>
      )}

      {step === 'members' && (
        <Members title={title} room={room} when={when} people={people} setPeople={setPeople}
          count={count} min={min} max={max} onBack={() => setStep('time')} />
      )}

      {step === 'rules' && (
        <section className="rules-agree">
          <header className="rs-head">
            <div className="rs-title">
              <button type="button" className="back" aria-label="뒤로" onClick={() => setStep('time')}><BackIcon /></button>
              <div>
                <h1>예약 전에 확인해 주세요</h1>
                <span className="muted sub">{title} · {when} · {count}명</span>
              </div>
            </div>
          </header>
          <div className="card rule-list">
            {agreeRules(pick && slots[pick.start] ? seoulClock(new Date(Date.parse(slots[pick.start].startAt) + 15 * 60_000)) : '').map((r) => (
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
              onClick={() => { saveAgreed(); submit() }}>
              {busy ? '예약하는 중…' : '동의하고 예약하기'}
            </button>
            <span className="muted center small">처음 예약할 때와 규칙이 바뀌었을 때만 보여요</span>
          </div>
        </section>
      )}

      {denied && (
        <div className="sheet-wrap">
          <div className="sheet-dim" onClick={() => setDenied(null)} aria-hidden="true" />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="denied-title">
            <span className="sheet-icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#15233D" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8v5M12 16.5v.5" /><circle cx="12" cy="12" r="9.5" /></svg>
            </span>
            <h2 id="denied-title">{denied.title}</h2>
            <p className="muted">{denied.hint ?? denied.message}</p>
            <div className="sheet-actions">
              <button type="button" className="btn-line" onClick={() => navigate('/')}>홈으로</button>
              <button type="button" className="btn-primary" autoFocus onClick={followDenied}>{denied.action}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

/** 함께 쓸 사람 (FR-RSV-004·005, 시안 Members): 학번으로 찾아 한 명씩 넣고 뺀다 */
function Members(props: {
  title: string
  room: RoomSlots | null
  when: string
  people: FoundMember[]
  setPeople: (p: FoundMember[]) => void
  count: number
  min: number
  max: number
  onBack: () => void
}) {
  const { title, room, when, people, setPeople, count, min, max, onBack } = props
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<FoundMember | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function search(e: FormEvent) {
    e.preventDefault()
    const sid = query.trim()
    if (!sid || searching) return
    setSearching(true)
    setFound(null)
    setMsg(null)
    try {
      setFound(await findMember(sid))
    } catch (err) {
      setMsg(err instanceof ApiError && err.code === 'MEMBER_NOT_FOUND'
        ? `${sid}는 찾을 수 없어요. 학교 메일로 가입한 사람만 넣을 수 있어요.`
        : err instanceof Error ? err.message : '잠시 후 다시 시도해 주세요')
    } finally {
      setSearching(false)
    }
  }

  const added = !!found && people.some((p) => p.studentId === found.studentId)
  const note = count < min ? `${min - count}명 더 필요해요` : count > max ? `최대 ${max}명이에요` : `인원 맞아요 (${min}–${max}명)`

  return (
    <section className="members">
      <header className="rs-head">
        <div className="rs-title">
          <button type="button" className="back" aria-label="뒤로" onClick={onBack}><BackIcon /></button>
          <div>
            <h1>함께 쓸 사람</h1>
            <span className="muted sub">{title}{room ? ` · ${room.minPeople}–${room.maxPeople}명 방` : ''}{when ? ` · ${when}` : ''}</span>
          </div>
        </div>
        <form className="search" onSubmit={search}>
          <label htmlFor="sid" className="sr-only">학번으로 찾기</label>
          <input id="sid" value={query} onChange={(e) => setQuery(e.target.value.replace(/\D/g, ''))}
            inputMode="numeric" placeholder="학번으로 찾기" maxLength={20} />
          <button className="search-btn" disabled={!query || searching}>{searching ? '찾는 중' : '찾기'}</button>
        </form>
      </header>

      {found && (
        <div className="card found">
          <span className="avatar">{found.name.slice(0, 1)}</span>
          <span className="who"><b>{found.name}</b><span className="muted">{found.studentId} · 찾은 사람</span></span>
          {added ? <span className="muted strong">추가됨</span> : (
            <button type="button" className="add-btn" onClick={() => { setPeople([...people, found]); setQuery('') }}>추가</button>
          )}
        </div>
      )}
      {msg && <p role="alert" className="notice">{msg}</p>}

      <div className="card people">
        <div className="people-head">
          <span>함께 쓰는 사람 {count}명</span>
          <span className="count-note"><i className={count >= min && count <= max ? 'ok' : ''} />{note}</span>
        </div>
        <div className="person">
          <span className="avatar me">나</span>
          <span className="who"><b>나</b><span className="muted">대표자</span></span>
        </div>
        {people.map((p) => (
          <div key={p.studentId} className="person">
            <span className="avatar">{p.name.slice(0, 1)}</span>
            <span className="who"><b>{p.name}</b><span className="muted">{p.studentId}</span></span>
            <button type="button" className="remove" aria-label={`${p.name} 빼기`}
              onClick={() => setPeople(people.filter((x) => x.studentId !== p.studentId))}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </div>
        ))}
      </div>

      <div className="rs-bar">
        <button type="button" className="btn-primary" onClick={onBack}>{count}명으로 정하기</button>
      </div>
    </section>
  )
}
