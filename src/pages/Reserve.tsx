import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { minutesLabel } from '../lib/format'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { celebrate } from '../lib/celebrate'
import type { FoundMember } from '../api/members'
import { createReservation, type NewReservation } from '../api/reservations'
import { getAvailability, type RoomSlots, type Slot } from '../api/rooms'
import { countdown, finishDemoOffer, isDemoOffer, offerPick, openOfferSlots, relayOn, takenRunEnd, type RelayOffer } from '../api/relay'
import { currentMemberId } from '../api/client'
import { WaitSheet } from '../components/Relay'
import { useNow } from '../lib/useNow'
import { useWaits } from '../lib/useRelay'
import type { SuggestPick } from '../components/ButlerCard'
import { BackIcon, DeniedSheet, Members, RulesAgree, newKey } from '../components/ReserveSteps'
import { deniedFor, type Denied } from '../content/denied'
import { hasAgreed } from '../content/rules'
import { seoulClock, seoulDate } from '../lib/time'
import { addDays, dayLabel, DAY_SLOTS, freeNextDaySlots, lengthLabel, MAX_SLOTS, nextDayReach, roomLink, slotClock, slotClockAcross, tapSlot, weekChips, type Pick } from '../lib/slots'
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
  // 홈 비서 카드("수업 끝나면 여기")가 넘긴 날짜·칸. 처음 시간표를 받은 뒤 그 칸이 아직 비어 있으면 골라 둔다(한 번만)
  const navState = (useLocation().state ?? {}) as { suggest?: SuggestPick; relay?: RelayOffer }
  const suggest = useRef(navState.suggest ?? null)
  // 빈방 릴레이(Q-18)로 넘겨받은 칸. 다른 학생에게는 예약됨으로 보이는 칸이라, 이 화면에서만 빈 칸으로 본다
  const relay = useRef(navState.relay ?? null).current
  const { waits, add: addWait, cancel: cancelWait } = useWaits()
  const canWait = relayOn()
  // 예약된 칸을 눌러 연 "기다리기" 시트
  const [waitAt, setWaitAt] = useState<number | null>(null)
  const [waitBusy, setWaitBusy] = useState(false)
  const [waitError, setWaitError] = useState<string | null>(null)

  const [date, setDate] = useState(() => (suggest.current && chips.some((c) => c.date === suggest.current!.date) ? suggest.current.date : today))
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

  // 골라 둔 칸이 화면 아래에 있으면 그리로 내려 보여 준다(한 번만)
  const scrollToPick = useRef(false)
  useEffect(() => {
    if (!scrollToPick.current || !pick) return
    scrollToPick.current = false
    document.querySelector('.slot[aria-pressed="true"]')?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [pick])

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
        .then((r) => openOfferSlots(r.data.rooms.find((x) => x.roomId === roomId)?.slots ?? [], relay?.roomId === roomId ? relay : null).slice(0, MAX_SLOTS - 1))
        .catch(() => [])
    next.then((n) => { if (seq === loadSeq.current) setNextSlots(n) })
    return getAvailability(date)
      .then((r) => {
        if (seq !== loadSeq.current) return
        const found = withOffer(r.data.rooms.find((x) => x.roomId === roomId) ?? null, relay)
        setRoom(found)
        if (!found) setLoadError('없는 방이에요')
        const s = suggest.current
        if (found && s && s.date === date) {
          suggest.current = null
          // 그 사이 누가 예약했거나 지난 칸이면 고르지 않고 시간표만 보여 준다
          const fits = (all: Slot[]) => {
            const want = all.slice(s.start, s.start + s.len)
            return s.len > 0 && want.length === s.len && want.every((x) => x.available && Date.parse(x.startAt) >= Date.now())
          }
          if (s.start + s.len <= found.slots.length) {
            if (fits(found.slots)) {
              setPick({ start: s.start, len: s.len })
              scrollToPick.current = true
            }
          } else {
            // 자정을 넘기는 칸(23:00–01:00, 릴레이로 넘겨받은 칸)은 다음 날 앞쪽 칸까지 받은 뒤 고른다.
            // 그 사이 학생이 직접 고른 칸이 있으면 덮지 않는다
            next.then((n) => {
              if (seq === loadSeq.current && fits([...found.slots, ...n])) setPick((p) => p ?? { start: s.start, len: s.len })
            })
          }
        }
      })
      .catch((e: Error) => {
        if (seq === loadSeq.current) setLoadError(e.message)
      })
  }, [date, roomId, today, relay])

  useEffect(() => {
    setNow(new Date())
    load()
  }, [load])

  // '지금 시작' 줄이 낡지 않게: 오늘을 보고 칸을 안 골랐을 때만 30초마다 시계와 방 현황을 조용히 다시 받는다(고른 칸은 건드리지 않는다).
  // 처음 불러오기가 끝나기 전이나 앞 새로고침이 아직 오는 중이면 그 차례는 건너뛰어 요청이 겹치지 않게 하고, 10초 안에 안 오면 끊는다
  const hasRoom = room !== null
  useEffect(() => {
    if (date !== today || pick || !hasRoom) return
    let pending: AbortController | null = null
    const id = setInterval(() => {
      setNow(new Date())
      if (pending) return
      const seq = loadSeq.current
      const ctrl = new AbortController()
      pending = ctrl
      const timer = setTimeout(() => ctrl.abort(), 10_000)
      getAvailability(date, ctrl.signal)
        .then((r) => {
          if (ctrl.signal.aborted || seq !== loadSeq.current) return
          const found = withOffer(r.data.rooms.find((x) => x.roomId === roomId) ?? null, relay)
          setRoom(found)
          if (!found) setLoadError('없는 방이에요') // 처음 불러오기와 같게
        })
        .catch(() => {})
        .finally(() => {
          clearTimeout(timer)
          if (pending === ctrl) pending = null
        })
    }, 30_000)
    return () => {
      clearInterval(id)
      pending?.abort() // 칸을 고르거나 날짜를 바꾸면 오는 중인 새로고침은 버린다
    }
  }, [date, today, pick, roomId, hasRoom, relay])

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

  // 고른 칸이 넘겨받은 구간 안이면 릴레이 예약이다. 받을 시간은 1초마다 줄고, 지나면 예약 버튼을 막는다
  const tick = useNow(relay ? 1000 : 60_000)
  const offer = relay ? offerPick(relay) : null
  const viaRelay = !!relay && relay.roomId === roomId && !!offer && !!pick && offer.date === date && pick.start >= offer.start && pick.start + pick.len <= offer.start + offer.len
  const relayLeft = relay ? Date.parse(relay.expiresAt) - tick.getTime() : 0
  const relayExpired = viaRelay && relayLeft <= 0
  // 예시 화면에서 받기를 끝까지 눌렀을 때 시트
  const [demoDone, setDemoDone] = useState(false)

  async function submit(resend?: { body: NewReservation; key: string }) {
    if (!resend && (!pick || !room)) return
    // 넘겨받은 칸의 받을 시간이 지났으면 새로 보내지 않는다(함께 쓸 사람·수칙 단계에 있는 사이 지나도). 같은 내용 다시 보내기는 그대로
    if (!resend && relayExpired) return
    if (busy) return
    setBusy(true)
    try {
      if (!resend && viaRelay && isDemoOffer(relay!.id)) {
        // 예시(?demo=1): core 릴레이 API 전이라 실제 예약은 만들지 않는다
        const memberId = currentMemberId()
        if (memberId !== null) finishDemoOffer(memberId, relay!.id)
        setDemoDone(true)
        return
      }
      const sent = resend ?? {
        body: {
          roomId,
          startAt: slots[pick!.start].startAt,
          endAt: slots[pick!.start + pick!.len - 1].endAt,
          participantStudentIds: people.map((p) => p.studentId),
          ...(viaRelay ? { relayOfferId: relay!.id } : {}),
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
    if (!pick || relayExpired) return
    if (!countOk) return setStep('members')
    if (!hasAgreed()) return setStep('rules')
    submit()
  }

  function followDenied() {
    const d = denied
    setDenied(null)
    if (!d) return
    if (d.next === 'mine') return navigate('/me/reservations')
    if (d.next === 'members') return setStep('members')
    if (d.next === 'retry') return submit(d.unsure ? lastSent.current ?? undefined : undefined)
    setStep('time')
    setPick(null)
    setNow(new Date())
    load()
  }

  // 이 날·이 방에서 내가 기다리는 칸
  // 시각은 글자가 아니라 순간으로 비교한다(core가 +09:00, 시간표가 Z로 줘도 같은 칸으로 보게)
  const waitingAt = new Set(waits.filter((w) => w.roomId === roomId && seoulDate(new Date(w.startAt)) === date).map((w) => Date.parse(w.startAt)))
  const myWaits = waits.filter((w) => w.roomId === roomId && waitingAt.has(Date.parse(w.startAt)))

  async function startWait() {
    if (waitAt === null || waitBusy) return
    setWaitBusy(true)
    setWaitError(null)
    try {
      await addWait(roomId, daySlots[waitAt].startAt, takenRunEnd(daySlots, waitAt))
      setWaitAt(null)
    } catch (e) {
      setWaitError(e instanceof Error ? e.message : '잠시 후 다시 눌러 주세요')
    } finally {
      setWaitBusy(false)
    }
  }

  const title = `창작실 ${roomId}`
  // 수연 피드백(11/6): 지금 바로 쓰기가 예약 화면과 떨어져 있어 불편 → 오늘 이 방이 지금 비어 있으면 시간표 위에 바로 시작 줄을 둔다
  const startNowLink = room && date === today && !pick ? roomLink(room, now) : null
  const canStartNow = !!startNowLink && startNowLink.startsWith('/now')
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

          {canStartNow && (
            <Link to={startNowLink!} state={people.length ? { people } : undefined} className="card rs-now">
              <span className="rs-now-text">
                <b>지금 비어 있어요</b>
                <span className="muted">지금 {seoulClock(now)}부터 바로 쓰기 · 끝 시각만 골라요</span>
              </span>
              <span className="rs-now-go">지금 시작</span>
            </Link>
          )}

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
                const waiting = taken && waitingAt.has(Date.parse(s.startAt))
                // 빈방 릴레이: 예약된 칸도 눌러서 기다리기를 걸 수 있다(이미 기다리는 칸은 아래 줄에서 그만둔다)
                const waitable = canWait && taken && !waiting
                const label = `${slotClock(i)} ${waiting ? '예약됨, 기다리는 중' : taken ? (waitable ? '예약됨, 눌러서 기다리기' : '예약됨') : past ? '지난 시간' : on ? '선택됨' : '비어 있음'}`
                return (
                  <button key={s.startAt} type="button" className={`slot ${taken ? 'taken' : ''} ${past ? 'past' : ''} ${on ? 'on' : ''} ${waitable ? 'can-wait' : ''} ${waiting ? 'waiting' : ''}`}
                    style={on ? { '--k': i - pick!.start } as CSSProperties : undefined}
                    disabled={busy || (!free[i] && !waitable)} aria-pressed={on} aria-label={label}
                    onClick={() => (waitable ? (setWaitError(null), setWaitAt(i)) : setPick(tapSlot(pick, i, free, DAY_SLOTS)))}>
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
            <span className="guide">시작 칸을 누르고 끝 칸을 누르세요 · 최대 2시간(4칸) · 지난 시간은 흐리게 보여요{canWait ? ' · 예약된 칸을 누르면 기다릴 수 있어요' : ''}</span>
            {myWaits.length > 0 && (
              <ul className="rs-waits">
                {myWaits.map((w) => (
                  <li key={w.id}>
                    <span>{seoulClock(new Date(w.startAt))} 칸을 기다리는 중 · {w.order}번째</span>
                    <button type="button" className="link-btn" onClick={() => void cancelWait(w.id).catch(() => undefined)}>그만 기다리기</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="rs-bar">
            <div className="rs-bar-row">
              <span className="rs-when">
                {viaRelay && <span className="rs-relay">{relayExpired ? '받을 시간이 지났어요' : `릴레이로 받은 칸 · ${countdown(relayLeft)} 안에`}</span>}
                <span className="muted">{dayLabel(date)}{pick ? ` · ${lengthLabel(pick.len)}` : ''}</span>
                <b>{clock}</b>
              </span>
              <button type="button" className="people-chip" disabled={busy} onClick={() => setStep('members')}>
                함께 {count}명
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
              </button>
            </div>
            <button type="button" className="btn-primary" disabled={!pick || busy || relayExpired} onClick={reserve}>
              {busy ? '예약하는 중…' : relayExpired ? '다음 사람에게 넘어갔어요' : '예약하기'}
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

      {waitAt !== null && (
        <WaitSheet clock={slotClock(waitAt)} busy={waitBusy} error={waitError} onWait={() => void startWait()} onClose={() => setWaitAt(null)} />
      )}

      {demoDone && (
        <DeniedSheet
          denied={{ title: '예시라 실제 예약은 만들지 않았어요', hint: 'core 릴레이 API(core #94)가 붙으면 여기서 바로 예약되고 입실 번호 화면으로 가요.', action: '확인', next: 'time', message: '' }}
          onClose={() => setDemoDone(false)} onHome={() => navigate('/')} onNext={() => navigate('/')} />
      )}

      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  )
}

/** 넘겨받은 구간의 칸을 빈 칸으로 바꾼 방(릴레이가 없으면 그대로) */
function withOffer(room: RoomSlots | null, relay: RelayOffer | null): RoomSlots | null {
  return room && relay && relay.roomId === room.roomId ? { ...room, slots: openOfferSlots(room.slots, relay) } : room
}
