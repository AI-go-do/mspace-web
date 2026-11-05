import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { FoundMember } from '../api/members'
import { startNow } from '../api/reservations'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { BackIcon, DeniedSheet, Members, RulesAgree, newKey } from '../components/ReserveSteps'
import { deniedFor, type Denied } from '../content/denied'
import { hasAgreed } from '../content/rules'
import { instantEnds, nextTakenAt } from '../lib/slots'
import { isFreeNow, seoulClock, seoulDate } from '../lib/time'
import { useNow } from '../lib/useNow'
import './Instant.css'

type Step = 'pick' | 'members' | 'rules'

/**
 * FR-WEB-102 지금 바로 쓰기 (시안 Instant, core FR-RSV-103 POST /api/reservations/instant).
 * 지금 빈 방만 보여 주고, 끝 시각은 30분 칸 칩으로 고른다(다음 예약 전·2시간 안까지만).
 * 시작은 서버가 누른 시각으로 정하고, 10분 안에 입실해야 한다.
 */
export default function Instant() {
  const navigate = useNavigate()
  const now = useNow(15_000)
  const [rooms, setRooms] = useState<RoomSlots[] | null>(null)
  // 서버에 닿지 못해 예시를 보여 주는 중이면 실제로 시작하지 않는다
  const [sample, setSample] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<number | null>(null)
  const [endAt, setEndAt] = useState<string | null>(null)
  const [people, setPeople] = useState<FoundMember[]>([])
  const [step, setStep] = useState<Step>('pick')
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<(Denied & { message: string }) | null>(null)

  // 새 요청을 보내면 이전 요청은 끊는다. 늦게 온 옛 응답이 새 값을 덮지 않게
  const active = useRef<AbortController | null>(null)
  const load = () => {
    active.current?.abort()
    const ctrl = new AbortController()
    active.current = ctrl
    return getAvailability(seoulDate(), ctrl.signal)
      .then((r) => {
        if (active.current !== ctrl) return
        setRooms(r.data.rooms); setSample(r.sample); setError(null)
      })
      .catch((e: Error) => {
        if (ctrl.signal.aborted || active.current !== ctrl) return
        setError(e.message)
      })
  }
  useEffect(() => {
    load()
    // 서버 occupiedNow는 불러온 순간 값이라, 열어 둔 동안 1분마다 새로 받는다
    const t = setInterval(load, 60_000)
    return () => {
      clearInterval(t)
      active.current?.abort()
      active.current = null
    }
  }, [])

  const idemKey = useRef(newKey())
  useEffect(() => {
    idemKey.current = newKey()
  }, [roomId, endAt, people])

  const free = (rooms ?? []).filter((r) => isFreeNow(r.slots, now, r.occupiedNow)).sort((a, b) => a.roomId - b.roomId)
  const room = free.find((r) => r.roomId === roomId) ?? null
  const ends = room ? instantEnds(room.slots, now) : []
  // 고른 끝 시각이 시간이 지나 못 쓰게 되면 지운다
  const end = ends.find((e) => e.endAt === endAt && e.ok) ? endAt : null
  const count = people.length + 1
  const min = room?.minPeople ?? 1
  const max = room?.maxPeople ?? 99
  const deadline = seoulClock(new Date(now.getTime() + 10 * 60_000))

  /** 지금 시작해서 고를 수 있는 끝 시각이 하나라도 있는지 */
  const canStart = (r: RoomSlots) => instantEnds(r.slots, now).some((e) => e.ok)
  /** 이 방이 몇 시까지 비어 있는지(다음 예약 시작). 오늘 남은 예약이 없으면 null */
  const freeUntil = (r: RoomSlots) => {
    const at = nextTakenAt(r.slots, now)
    return at ? seoulClock(new Date(at)) : null
  }

  async function submit() {
    if (!room || !end || busy || sample) return
    setBusy(true)
    try {
      const created = await startNow({ roomId: room.roomId, endAt: end, participantStudentIds: people.map((p) => p.studentId) }, idemKey.current)
      navigate(`/reservations/${created.id}`, { state: { created, instant: true } })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return
      setDenied({ ...deniedFor(e instanceof ApiError ? e.code : 'NETWORK'), message: e instanceof Error ? e.message : '잠시 후 다시 시도해 주세요' })
    } finally {
      setBusy(false)
    }
  }

  function start() {
    if (!room || !end) return
    if (count < min || count > max) return setStep('members')
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
    setStep('pick')
    setEndAt(null)
    load()
  }

  const title = room ? `창작실 ${room.roomId}` : ''
  const when = end ? `지금–${seoulClock(new Date(end))}` : ''

  if (step === 'members') {
    return <main className="reserve"><Members title={title} room={room} when={when} people={people} setPeople={setPeople}
      count={count} min={min} max={max} onBack={() => setStep('pick')}
      onDone={end ? start : undefined} doneLabel={end ? `${count}명으로 지금 시작하기` : undefined} busy={busy} busyLabel="시작하는 중…" />
      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  }
  if (step === 'rules') {
    return <main className="reserve"><RulesAgree sub={`${title} · ${when} · ${count}명`} busy={busy} onBack={() => setStep('pick')}
      noShowAt={deadline} instant onAgree={submit} />
      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  }

  return (
    <main className="reserve instant">
      <header className="rs-head">
        <div className="rs-title">
          <button type="button" className="back" aria-label="뒤로" onClick={() => navigate(-1)}><BackIcon /></button>
          <div>
            <h1>지금 바로 쓰기</h1>
            <span className="muted sub">지금 {seoulClock(now)}부터 시작해요</span>
          </div>
        </div>
      </header>

      <section className="card in-rooms" aria-labelledby="free-title">
        <h2 id="free-title">지금 비어 있는 방{sample && <span className="sample">예시</span>}</h2>
        {sample && <p role="status" className="muted">서버에 닿지 않아 예시를 보여 주고 있어요. 지금은 시작할 수 없어요.</p>}
        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}
        {rooms && free.length === 0 && <p className="muted">지금 비어 있는 방이 없어요. 홈에서 다른 시간을 골라 주세요.</p>}
        {free.map((r) => {
          const ok = canStart(r)
          const until = freeUntil(r)
          return (
            <button key={r.roomId} type="button" className="in-room" aria-pressed={r.roomId === roomId} disabled={!ok}
              onClick={() => { setRoomId(r.roomId); setEndAt(null) }}>
              <span className="in-no">{r.roomId}</span>
              <span className="in-text">
                <b>창작실 {r.roomId}</b>
                <span className="muted">{r.minPeople}–{r.maxPeople}명 · {!ok ? '곧 다음 예약이 있어요' : until ? `${until}까지 비어 있어요` : '오늘 남은 예약이 없어요'}</span>
              </span>
            </button>
          )
        })}
      </section>

      {room && (
        <section className="card in-ends" aria-labelledby="end-title">
          <div className="in-ends-head">
            <h2 id="end-title">언제까지 쓸까요?</h2>
            <span className="muted small">30분 단위 · 최대 2시간</span>
          </div>
          <div className="end-chips">
            {ends.map((e) => (
              <button key={e.endAt} type="button" disabled={!e.ok} aria-pressed={e.endAt === end} onClick={() => setEndAt(e.endAt)}>
                {seoulClock(new Date(e.endAt))}
              </button>
            ))}
          </div>
        </section>
      )}

      {room && <p className="in-warn"><b>10분 안({deadline}까지)</b>에 키패드로 입실하지 않으면 자동으로 취소돼요.</p>}

      <div className="rs-bar">
        <div className="rs-bar-row">
          <span className="rs-when">
            <span className="muted">{room ? `창작실 ${room.roomId}` : '방을 골라 주세요'}</span>
            <b>{end ? `${seoulClock(now)} – ${seoulClock(new Date(end))}` : '끝 시각을 골라 주세요'}</b>
          </span>
          <button type="button" className="people-chip" disabled={!room} onClick={() => setStep('members')}>
            함께 {count}명
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
          </button>
        </div>
        <button type="button" className="btn-primary" disabled={!room || !end || busy || sample} onClick={start}>
          {busy ? '시작하는 중…' : '지금 시작하기'}
        </button>
      </div>

      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  )
}
