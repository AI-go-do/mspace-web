import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { minutesLabel } from '../lib/format'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { FoundMember } from '../api/members'
import { createReservation } from '../api/reservations'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { BackIcon, DeniedSheet, Members, RulesAgree, newKey } from '../components/ReserveSteps'
import { deniedFor, type Denied } from '../content/denied'
import { hasAgreed } from '../content/rules'
import { seoulClock, seoulDate } from '../lib/time'
import { dayLabel, lengthLabel, slotClock, tapSlot, weekChips, type Pick } from '../lib/slots'
import './Reserve.css'

type Step = 'time' | 'members' | 'rules'

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
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<(Denied & { message: string }) | null>(null)
  const [now, setNow] = useState(() => new Date())

  // 날짜를 빨리 바꾸면 늦게 온 옛 응답이 새 날짜 위에 덮이지 않게 최근 요청만 반영한다
  const loadSeq = useRef(0)
  const load = useCallback(() => {
    const seq = ++loadSeq.current
    // 다시 불러오는 동안·실패한 뒤에 옛 시간표를 고를 수 없게 비운다
    setRoom(null)
    setPick(null)
    setLoadError(null)
    return getAvailability(date)
      .then((r) => {
        if (seq !== loadSeq.current) return
        const found = r.data.rooms.find((x) => x.roomId === roomId) ?? null
        setRoom(found)
        if (!found) setLoadError('없는 방이에요')
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setLoadError(e.message)
      })
  }, [date, roomId])

  useEffect(() => {
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
  const range = pick ? `${slotClock(pick.start)} – ${slotClock(pick.start + pick.len)} · ${minutesLabel(pick.len * 30)}` : '시작 칸을 눌러 주세요'

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
            {loadError && (
              <div role="alert">
                <p className="muted">시간표를 못 불러왔어요. {loadError}</p>
                <button type="button" className="btn-line" onClick={() => load()}>다시 불러오기</button>
              </div>
            )}
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
          count={count} min={min} max={max} onBack={() => setStep('time')}
          onDone={pick ? reserve : undefined} doneLabel={pick ? `${count}명으로 예약하기` : undefined}
          busy={busy} busyLabel="예약하는 중…" />
      )}

      {step === 'rules' && (
        <RulesAgree sub={`${title} · ${when} · ${count}명`} busy={busy} onBack={() => setStep('time')}
          noShowAt={pick && slots[pick.start] ? seoulClock(new Date(Date.parse(slots[pick.start].startAt) + 15 * 60_000)) : ''}
          onAgree={submit} />
      )}

      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  )
}
