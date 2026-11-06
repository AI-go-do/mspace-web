import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { getMyReservations, isActive, STATUS_LABEL, type CreatedReservation, type MyReservation } from '../api/reservations'
import Spacey from '../components/Spacey'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulDate } from '../lib/time'
import './AccessCode.css'

interface NavState {
  created?: CreatedReservation
  /** 지금 바로 쓰기(즉시 시작)면 입실 마감이 누른 뒤 10분 */
  instant?: boolean
}

/**
 * 즉시 시작 예약인지 시작 시각으로 가린다. 미리 예약은 늘 30분 칸 경계(정각·30분)에서 시작하고,
 * 즉시 시작은 서버가 누른 시각(초 단위)을 시작으로 쓰므로 경계에서 벗어난다(core ReservationTime.instant).
 * core 응답에 입실 마감이 없어서 쓰는 방법이다. 정확히 정각·30분 0초에 누른 즉시 시작만 미리 예약으로 보인다.
 */
export function isInstantStart(startAt: string): boolean {
  return Date.parse(startAt) % (30 * 60_000) !== 0
}

/** 미리 예약은 시작 + 15분, 즉시 시작은 누른 뒤(=시작) + 10분까지 입실 (FR-ACC-001) */
export function checkInDeadline(startAt: string, instant = isInstantStart(startAt)): Date {
  return new Date(Date.parse(startAt) + (instant ? 10 : 15) * 60_000)
}

/**
 * 예약의 입실 마감. core가 준 값(checkinDeadline)이 있으면 그대로 쓴다: 시작 뒤에 미리 예약하면
 * DB는 예약한 시각 + 15분으로 잡아서 화면 계산과 다르다. 없으면(예전 core) 화면이 계산한다
 */
export function deadlineOf(r: { startAt: string; checkinDeadline?: string }, instant?: boolean): Date {
  if (r.checkinDeadline) return new Date(r.checkinDeadline)
  return checkInDeadline(r.startAt, instant || isInstantStart(r.startAt))
}

/** 열어 둔 동안 상태(입실·노쇼·취소)가 바뀌면 번호를 고치거나 끈다 */
const REFRESH_MS = 30_000

/** FR-WEB-005 예약 완료 · 입실 번호 화면 (시안 Key). 예약 직후와 내 예약에서 연다 */
export default function AccessCode() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as NavState
  const justCreated = state.created?.id === id
  // 번호는 지금 로그인한 회원의 예약 목록에서 확인한 것만 보여 준다.
  // 화면 이동 기록(state)은 다른 계정이 남긴 것일 수 있어 번호 표시에 쓰지 않는다
  const [r, setR] = useState<MyReservation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shared, setShared] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    let loaded = false
    // 요청은 한 번에 하나만 보낸다. 진행 중에 새로고침이 또 오면 끝난 뒤 한 번만 다시 받는다.
    // 그래서 답이 순서대로 오고, 느린 연결에서도 받은 답이 화면에 반영된다
    let inFlight = false
    let again = false
    const refresh = () => {
      if (inFlight) {
        again = true
        return
      }
      inFlight = true
      getMyReservations()
        .then((list) => {
          if (!alive) return
          const found = list.find((x) => x.id === id) ?? null
          setR(found)
          setError(found ? null : '찾을 수 없는 예약이에요')
          loaded = true
        })
        .catch((e: Error) => {
          // 한 번 받은 뒤 잠깐 끊긴 건 그대로 두고, 처음부터 못 받으면 오류를 보여 준다
          if (alive && !loaded) setError(e.message)
        })
        .finally(() => {
          inFlight = false
          if (alive && again) {
            again = false
            refresh()
          }
        })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id])

  if (error) {
    return (
      <main className="key-page">
        <div className="key-top"><span className="key-title">입실 번호</span></div>
        <div className="ticket"><div className="ticket-body"><p role="alert">{error}</p><Link to="/me" className="link">내 예약 보기</Link></div></div>
      </main>
    )
  }
  if (!r) return <main className="key-page" aria-busy="true"><div className="key-top"><span className="key-sub" role="status">불러오는 중…</span></div></main>

  const date = seoulDate(new Date(r.startAt))
  const today = seoulDate()
  const when = `${date === today ? '오늘 ' : ''}${dayLabel(date)}`
  const time = `${seoulClock(new Date(r.startAt))}–${seoulClock(new Date(r.endAt))}`
  const roomName = `창작실 ${r.room.id}`
  const active = isActive(r.status)
  const showCode = r.owner && active && !!r.accessCode
  const deadline = seoulClock(deadlineOf(r, state.instant))

  async function share() {
    const text = `M-space ${roomName} · ${when} ${time}\n입실 번호 ${r!.accessCode} (방 앞 키패드에 누르고 #)`
    if (navigator.share) {
      try {
        await navigator.share({ title: 'M-space 예약', text })
        return
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return // 보내기 창을 닫음
        // 그 밖의 실패는 복사로 대신한다
      }
    }
    try {
      await navigator.clipboard.writeText(text)
      setShared('복사했어요. 메신저에 붙여 넣어 보내 주세요.')
    } catch {
      setShared('보내지 못했어요. 번호를 직접 알려 주세요.')
    }
  }

  return (
    <main className="key-page">
      <div className={`key-top ${justCreated && r.status === 'BOOKED' ? 'done' : ''}`}>
        <Spacey size={80} />
        <span className="key-title">{justCreated && r.status === 'BOOKED' ? '예약 완료' : r.status === 'IN_USE' ? '사용 중' : active ? '입실 번호' : STATUS_LABEL[r.status]}</span>
        <span className="key-sub">
          {showCode ? '방 앞 키패드에 이 번호를 눌러 주세요' : !r.owner ? '번호는 대표자에게만 보여요' : '끝난 예약이라 번호가 꺼졌어요'}
        </span>
      </div>

      {/* 방금 예약했으면 표가 인쇄되듯 위에서부터 펼쳐진다 */}
      <div className={`ticket ${justCreated ? 'fresh' : ''}`}>
        <div className="ticket-body">
          <div className="ticket-when">
            <span className="muted">{when}</span>
            <b>{roomName} · {time}</b>
          </div>
          {showCode && (
            <>
              <div className="code-digits" role="img" aria-label={`입실 번호 ${r.accessCode!.split('').join(' ')}`}>
                {r.accessCode!.split('').map((d, i) => <span key={i}>{d}</span>)}
              </div>
              {r.status === 'BOOKED'
                ? <span className="deadline">{deadline}까지 입실하지 않으면 방이 풀려요</span>
                : <span className="deadline calm">입실했어요. 잠깐 나갔다 와도 같은 번호로 열려요</span>}
            </>
          )}
        </div>
        <div className="ticket-cut" aria-hidden="true"><span /><span /></div>
        <ol className="steps">
          <li><span>1</span>방 앞으로<br />가요</li>
          <li><span>2</span>번호 6자리<br />누르고 #</li>
          <li><span>3</span>불이 켜지면<br />입실 완료</li>
          <li><span>4</span>방 사진<br />한 장 찍기</li>
        </ol>
      </div>

      {shared && <p className="key-toast" role="status">{shared}</p>}

      <div className="key-actions">
        {showCode && <button type="button" className="btn-ghost" onClick={share}>참여자에게 보내기</button>}
        <button type="button" className="btn-white" onClick={() => navigate('/me')}>내 예약 보기</button>
      </div>
    </main>
  )
}
