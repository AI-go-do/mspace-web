import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { minutesLabel } from '../lib/format'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { celebrate } from '../lib/celebrate'
import type { FoundMember } from '../api/members'
import { createReservation, type NewReservation } from '../api/reservations'
import { getAvailability, type RoomSlots, type Slot } from '../api/rooms'
import { BackIcon, DeniedSheet, Members, RulesAgree, newKey } from '../components/ReserveSteps'
import { deniedFor, type Denied } from '../content/denied'
import { hasAgreed } from '../content/rules'
import { seoulClock, seoulDate } from '../lib/time'
import { addDays, dayLabel, DAY_SLOTS, freeNextDaySlots, lengthLabel, MAX_SLOTS, nextDayReach, slotClock, slotClockAcross, tapSlot, weekChips, type Pick } from '../lib/slots'
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
  // 자정 넘김용 다음 날 앞쪽 칸(끝으로만 쓴다). 못 받으면 빈 배열이라 자정을 넘겨 고를 수 없다
  const [nextSlots, setNextSlots] = useState<Slot[]>([])
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
    setNextSlots([])
    setPick(null)
    setLoadError(null)
    const nextDate = addDays(date, 1)
    // 마지막(7일째) 날의 다음 날은 서버가 조회를 받지 않는다(시작이 7일 밖). 그 칸은 비어 있다고 보고 서버가 다시 확인한다
    const lastDay = date === addDays(today, 6)
    const next = lastDay
      ? Promise.resolve(freeNextDaySlots(nextDate))
      : getAvailability(nextDate)
        .then((r) => (r.data.rooms.find((x) => x.roomId === roomId)?.slots ?? []).slice(0, MAX_SLOTS - 1))
        .catch(() => [])
    next.then((n) => { if (seq === loadSeq.current) setNextSlots(n) })
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
  }, [date, roomId, today])

  useEffect(() => {
    setNow(new Date())
    load()
  }, [load])

  // 같은 내용으로 다시 보내면 같은 키 → 서버가 예약을 두 번 만들지 않는다
  const idemKey = useRef(newKey())
  useEffect(() => {
    idemKey.current = newKey()
  }, [date, pick, people])

  const daySlots = room?.slots ?? []
  // 하루 칸 뒤에 다음 날 앞쪽 칸을 이어 붙인다. 앞 48칸만 시작으로 고를 수 있다
  const slots = daySlots.length === DAY_SLOTS ? [...daySlots, ...nextSlots] : daySlots
  const free = slots.map((s) => s.available && Date.parse(s.startAt) >= now.getTime())
  const reach = Math.min(nextDayReach(pick?.start ?? null), slots.length - daySlots.length)
  const count = people.length + 1 // 대표자(나) 포함
  const min = room?.minPeople ?? 1
  const max = room?.maxPeople ?? 99
  const countOk = count >= min && count <= max
  // 아래 막대의 굵은 줄은 시각만(길이는 위 회색 줄에 있다). 자정을 넘기면 글이 길어져 두 줄로 꺾이지 않게
  const clock = pick ? `${slotClock(pick.start)} – ${slotClockAcross(pick.start + pick.len)}` : '시작 칸을 눌러 주세요'
  const range = pick ? `${clock} · ${minutesLabel(pick.len * 30)}` : clock

  // 마지막으로 보낸 내용과 멱등 키. 연결이 끊겨 "됐는지 모름"일 때 다시 시도는 이걸 그대로 보낸다
  // (시트가 떠 있는 동안 고른 것이 바뀌어 키가 새로 나도, 같은 예약이 두 번 생기지 않게)
  const lastSent = useRef<{ body: NewReservation; key: string } | null>(null)

  async function submit(resend?: { body: NewReservation; key: string }) {
    if (!resend && (!pick || !room)) return
    if (busy) return
    setBusy(true)
    try {
      const sent = resend ?? {
        body: {
          roomId,
          startAt: slots[pick!.start].startAt,
          endAt: slots[pick!.start + pick!.len - 1].endAt,
          participantStudentIds: people.map((p) => p.studentId),
        },
        key: idemKey.current,
      }
      lastSent.current = sent
      const created = await createReservation(sent.body, sent.key)
      celebrate()
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
    if (d.next === 'retry') return submit(d.unsure ? lastSent.current ?? undefined : undefined)
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
              <button type="button" className="back" aria-label="뒤로" disabled={busy} onClick={() => navigate(-1)}><BackIcon /></button>
              <h1>{title} {room && <span className="muted">{room.minPeople}–{room.maxPeople}명</span>}</h1>
            </div>
            <div className="days" role="group" aria-label="날짜">
              {chips.map((c) => (
                <button key={c.date} type="button" aria-pressed={c.date === date} disabled={busy} onClick={() => setDate(c.date)}
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
              {daySlots.map((s, i) => {
                const past = Date.parse(s.startAt) < now.getTime()
                const taken = !past && !s.available
                const on = !!pick && i >= pick.start && i < pick.start + pick.len
                const label = `${slotClock(i)} ${taken ? '예약됨' : past ? '지난 시간' : on ? '선택됨' : '비어 있음'}`
                return (
                  <button key={s.startAt} type="button" className={`slot ${taken ? 'taken' : ''} ${past ? 'past' : ''} ${on ? 'on' : ''}`}
                    style={on ? { '--k': i - pick!.start } as CSSProperties : undefined}
                    disabled={busy || !free[i]} aria-pressed={on} aria-label={label} onClick={() => setPick(tapSlot(pick, i, free, DAY_SLOTS))}>
                    {slotClock(i)}
                  </button>
                )
              })}
            </div>
            {reach > 0 && (
              <div className="next-day" role="group" aria-label={`다음 날 ${dayLabel(addDays(date, 1))} 끝 칸`}>
                <span className="next-day-label">다음 날 {dayLabel(addDays(date, 1))} · 끝 칸으로만 골라요</span>
                <div className="slot-grid">
                  {slots.slice(DAY_SLOTS, DAY_SLOTS + reach).map((s, k) => {
                    const i = DAY_SLOTS + k
                    const taken = !s.available
                    const on = !!pick && i >= pick.start && i < pick.start + pick.len
                    const label = `다음 날 ${slotClock(k)} ${taken ? '예약됨' : on ? '선택됨' : '비어 있음'}`
                    return (
                      <button key={s.startAt} type="button" className={`slot ${taken ? 'taken' : ''} ${on ? 'on' : ''}`}
                        style={on ? { '--k': i - pick!.start } as CSSProperties : undefined}
                        disabled={busy || !free[i]} aria-pressed={on} aria-label={label} onClick={() => setPick(tapSlot(pick, i, free, DAY_SLOTS))}>
                        {slotClock(k)}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
            <span className="guide">시작 칸을 누르고 끝 칸을 누르세요 · 최대 2시간(4칸) · 지난 시간은 흐리게 보여요</span>
          </section>

          <div className="rs-bar">
            <div className="rs-bar-row">
              <span className="rs-when">
                <span className="muted">{dayLabel(date)}{pick ? ` · ${lengthLabel(pick.len)}` : ''}</span>
                <b>{clock}</b>
              </span>
              <button type="button" className="people-chip" disabled={busy} onClick={() => setStep('members')}>
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
