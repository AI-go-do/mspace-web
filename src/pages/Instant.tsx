import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ApiError } from '../api/client'
import type { FoundMember } from '../api/members'
import { startNow } from '../api/reservations'
import { getAvailability, type RoomSlots } from '../api/rooms'
import { BackIcon, DeniedSheet, Members, RulesAgree, newKey } from '../components/ReserveSteps'
import { deniedFor, type Denied } from '../content/denied'
import { hasAgreed } from '../content/rules'
import { instantEnds } from '../lib/slots'
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
  const [error, setError] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<number | null>(null)
  const [endAt, setEndAt] = useState<string | null>(null)
  const [people, setPeople] = useState<FoundMember[]>([])
  const [step, setStep] = useState<Step>('pick')
  const [busy, setBusy] = useState(false)
  const [denied, setDenied] = useState<(Denied & { message: string }) | null>(null)

  const load = () =>
    getAvailability(seoulDate())
      .then((r) => { setRooms(r.data.rooms); setError(null) })
      .catch((e: Error) => setError(e.message))
  useEffect(() => {
    load()
  }, [])

  const idemKey = useRef(newKey())
  useEffect(() => {
    idemKey.current = newKey()
  }, [roomId, endAt, people])

  const free = (rooms ?? []).filter((r) => isFreeNow(r.slots, now)).sort((a, b) => a.roomId - b.roomId)
  const room = free.find((r) => r.roomId === roomId) ?? null
  const ends = room ? instantEnds(room.slots, now) : []
  // 고른 끝 시각이 시간이 지나 못 쓰게 되면 지운다
  const end = ends.find((e) => e.endAt === endAt && e.ok) ? endAt : null
  const count = people.length + 1
  const min = room?.minPeople ?? 1
  const max = room?.maxPeople ?? 99
  const deadline = seoulClock(new Date(now.getTime() + 10 * 60_000))

  /** 이 방이 몇 시까지 비어 있는지(고를 수 있는 마지막 끝 시각) */
  const freeUntil = (r: RoomSlots) => {
    const ok = instantEnds(r.slots, now).filter((e) => e.ok)
    return ok.length ? seoulClock(new Date(ok[ok.length - 1].endAt)) : null
  }

  async function submit() {
    if (!room || !end || busy) return
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
      count={count} min={min} max={max} onBack={() => setStep('pick')} /></main>
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
        <h2 id="free-title">지금 비어 있는 방</h2>
        {error && <p role="alert" className="muted">방 현황을 못 불러왔어요. {error}</p>}
        {rooms && free.length === 0 && <p className="muted">지금 비어 있는 방이 없어요. 홈에서 다른 시간을 골라 주세요.</p>}
        {free.map((r) => {
          const until = freeUntil(r)
          return (
            <button key={r.roomId} type="button" className="in-room" aria-pressed={r.roomId === roomId} disabled={!until}
              onClick={() => { setRoomId(r.roomId); setEndAt(null) }}>
              <span className="in-no">{r.roomId}</span>
              <span className="in-text">
                <b>창작실 {r.roomId}</b>
                <span className="muted">{r.minPeople}–{r.maxPeople}명 · {until ? `${until}까지 비어 있어요` : '곧 다음 예약이 있어요'}</span>
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

      <p className="in-warn"><b>10분 안({deadline}까지)</b>에 키패드로 입실하지 않으면 자동으로 취소돼요.</p>

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
        <button type="button" className="btn-primary" disabled={!room || !end || busy} onClick={start}>
          {busy ? '시작하는 중…' : '지금 시작하기'}
        </button>
      </div>

      {denied && <DeniedSheet denied={denied} onClose={() => setDenied(null)} onHome={() => navigate('/')} onNext={followDenied} />}
    </main>
  )
}
