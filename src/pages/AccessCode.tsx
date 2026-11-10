import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, currentMemberId, refreshTokens } from '../api/client'
import { cancelDeadline, canCancel, getMyReservations, isActive, STATUS_LABEL, type CreatedReservation, type MyReservation } from '../api/reservations'
import Spacey from '../components/Spacey'
import { celebrate } from '../lib/celebrate'
import { dayLabel } from '../lib/slots'
import { seoulClock, seoulClockSec, seoulDate } from '../lib/time'
import { useNow } from '../lib/useNow'
import { useWakeLock } from '../lib/useWakeLock'
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
/** 입실할 수 있는 동안은 자주 본다. 키패드로 들어가면 몇 초 안에 화면이 닫히게 */
export const CHECKIN_REFRESH_MS = 3_000
/** 답이 오지 않는 요청을 끊는 시간. 끊어야 다음 확인이 돈다 */
const REQUEST_TIMEOUT_MS = 10_000
/** 서버에 닿지 못했을 때. 브라우저 문구("Failed to fetch")를 그대로 내지 않는다 */
const OFFLINE = '연결이 끊겼어요. 와이파이를 확인하고 다시 시도해 주세요'
/** "문이 열렸어요"를 보여 준 뒤 내 예약으로 넘어가기까지(QR이 접히고 폭죽이 떨어지는 동안) */
const ENTERED_MS = 2_600

/** 남은 시간 "7:42" (한 시간 넘으면 "1:07:42") */
export function mmss(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

/**
 * 입실 마감 안내 한 줄. 입실할 수 있는 때(시작 10분 전부터)는 1초마다 줄어드는 카운트다운,
 * 아직 멀었으면 마감 시각, 지났으면 지났다고(곧 서버가 노쇼로 바꾸고 화면이 닫힌다)
 */
export function deadlineText(deadline: Date, startAt: string, now: number): string {
  const left = deadline.getTime() - now
  if (left <= 0) return '입실 마감이 지났어요'
  if (now >= Date.parse(startAt) - 10 * 60_000) return `입실 마감까지 ${mmss(left)}`
  return `${seoulClock(deadline)}까지 입실하지 않으면 방이 풀려요`
}

/**
 * 다음 확인까지 기다릴 시간. 대표자의 예약됨(BOOKED) 예약이 입실 가능한 때(시작 10분 전 ~ 입실 마감 + 1분)이고
 * 화면을 보고 있으면 3초, 아니면 30초. 마감 뒤 1분은 노쇼로 바뀌는 것까지 보려고 둔다
 */
export function refreshDelay(
  r: { status: string; owner: boolean; startAt: string; checkinDeadline?: string } | null,
  now: number,
  visible: boolean,
): number {
  if (!r || !visible || !r.owner || r.status !== 'BOOKED') return REFRESH_MS
  const from = Date.parse(r.startAt) - 10 * 60_000
  const until = deadlineOf(r).getTime() + 60_000
  if (now >= from && now <= until) return CHECKIN_REFRESH_MS
  // 아직 입실 시간 전이면 입실 시간이 시작될 때 한 번 더 본다(30초를 다 기다리지 않게)
  if (now < from) return Math.max(CHECKIN_REFRESH_MS, Math.min(REFRESH_MS, from - now))
  return REFRESH_MS
}

/** 이 화면을 연 동안 예약됨 → 사용 중으로 바뀌었는지(키패드 입실). 처음부터 사용 중이면 아니다 */
export function justEntered(prev: string | undefined, next: string | undefined): boolean {
  return prev === 'BOOKED' && next === 'IN_USE'
}

/** FR-WEB-005 예약 완료 · 입실 번호 화면 (시안 Key). 예약 직후와 내 예약에서 연다 */
export default function AccessCode() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as NavState
  const justCreated = state.created?.id === id
  // 번호는 지금 로그인한 회원의 예약 목록에서 확인한 것만 보여 준다.
  // 화면 이동 기록(state)은 다른 계정이 남긴 것일 수 있어 번호 표시에 쓰지 않는다
  const [r, setR] = useState<MyReservation | null>(null)
  // 입실할 수 있는 동안은 마감 카운트다운이 1초마다 줄어든다. 그 밖에는 취소 버튼(누른 뒤 5분)이 마감에 맞춰 사라질 만큼만
  const now = useNow(r?.status === 'BOOKED' && r.owner ? 1_000 : 5_000)
  const [error, setError] = useState<string | null>(null)
  // [다시 시도]를 누르면 1 올려서 처음부터 다시 받는다
  const [attempt, setAttempt] = useState(0)
  const [shared, setShared] = useState<string | null>(null)

  const [entered, setEntered] = useState(false)
  // 문 앞에서 QR을 보여 주는 동안은 폰 화면이 꺼지지 않게(번호를 다 누를 때까지도)
  useWakeLock(!!r && r.owner && r.status === 'BOOKED' && !!r.accessCode)

  useEffect(() => {
    let alive = true
    let loaded = false
    let last: MyReservation | null = null
    // 이 화면을 연 회원. 다른 탭에서 다른 학생이 로그인하면 그 학생 예약으로 바꿔 보이지 않는다.
    // 아직 모르면(시작 때 refresh가 네트워크로 실패) 요청하지 않고 다음 확인 때 다시 잡는다
    let member: number | null = currentMemberId()
    // 요청은 한 번에 하나만 보낸다. 진행 중에 새로고침이 또 오면 끝난 뒤 한 번만 다시 받는다.
    // 그래서 답이 순서대로 오고, 느린 연결에서도 받은 답이 화면에 반영된다
    let inFlight: AbortController | null = null
    let again = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let leave: ReturnType<typeof setTimeout> | undefined
    // 다음 확인은 받은 예약에 맞춰 잡는다(입실 가능한 때는 3초, 아니면 30초)
    const schedule = () => {
      clearTimeout(timer)
      if (!alive || leave) return
      timer = setTimeout(refresh, refreshDelay(last, Date.now(), document.visibilityState === 'visible'))
    }
    const refresh = () => {
      if (!alive || leave) return
      if (inFlight) {
        again = true
        return
      }
      member ??= currentMemberId()
      if (member === null) {
        // 시작 때 refresh가 네트워크로 실패해 토큰이 없으면 쿠키로 다시 받아 본다(연결이 돌아오면 이어서 열린다).
        // 받은 회원으로 고정한 뒤에만 예약을 조회한다. refresh 401이면 client가 로그인을 끝내 로그인 화면으로 간다
        refreshTokens()
          .then((t) => { if (alive) member = t.memberId ?? null })
          // 처음부터 못 받으면(문 앞에서 와이파이 끊김) "불러오는 중"에 머물지 않고 오류와 다시 시도를 보여 준다.
          // 뒤에서는 계속 다시 받아 보므로 연결이 돌아오면 저절로 열린다
          .catch((e: unknown) => { if (alive && !loaded) setError(e instanceof ApiError ? e.message : OFFLINE) })
          .finally(() => { if (alive && member !== null) refresh(); else schedule() })
        return
      }
      const abort = new AbortController()
      inFlight = abort
      const cut = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
      getMyReservations(abort.signal, member)
        .then((list) => {
          if (!alive || inFlight !== abort) return
          const found = list.find((x) => x.id === id) ?? null
          // 한 번이라도 받으면 오류 화면을 걷는다(연결이 돌아온 경우)
          const prev = last?.status
          last = found
          setR(found)
          setError(found ? null : '찾을 수 없는 예약이에요')
          loaded = true
          // 문 앞 카메라가 QR을 읽거나 키패드로 들어갔으면: QR이 접히며 "문이 열렸어요"와 폭죽, 그 뒤 내 예약으로
          if (justEntered(prev, found?.status)) {
            setEntered(true)
            celebrate()
            try { navigator.vibrate?.([40, 60, 40]) } catch { /* 진동 없는 기기 */ }
            leave = setTimeout(() => navigate('/me', { replace: true }), ENTERED_MS)
          }
        })
        .catch((e: Error) => {
          if (!alive || inFlight !== abort) return
          // 다른 탭에서 다른 학생이 로그인했으면 앞 학생의 번호를 지우고 화면을 떠난다
          if (e instanceof ApiError && e.code === 'SESSION_CHANGED') {
            last = null
            setR(null)
            leave = setTimeout(() => navigate('/me', { replace: true }), 0)
            return
          }
          // 한 번 받은 뒤 잠깐 끊긴 건 그대로 두고, 처음부터 못 받으면 오류를 보여 준다
          if (!loaded) setError(abort.signal.aborted ? '연결이 늦어요. 잠시 후 다시 시도해 주세요' : e instanceof ApiError ? e.message : OFFLINE)
        })
        .finally(() => {
          clearTimeout(cut)
          if (inFlight !== abort) return
          inFlight = null
          if (alive && again) {
            again = false
            refresh()
          } else schedule()
        })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    refresh()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      clearTimeout(timer)
      clearTimeout(leave)
      inFlight?.abort()
      inFlight = null
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id, navigate, attempt])

  // 처음부터 못 받은 경우(와이파이 끊김·없는 예약). 막다른 화면이 되지 않게 다시 시도와 내 예약으로 가는 길을 둔다
  if (error) {
    return (
      <main className="key-page">
        <div className="key-top"><span className="key-title">입실 QR</span></div>
        <div className="ticket"><div className="ticket-body">
          <p role="alert">{error}</p>
          <button type="button" className="btn-primary" onClick={() => { setError(null); setAttempt((n) => n + 1) }}>다시 시도</button>
          <Link to="/me/reservations" className="link">내 예약 보기</Link>
        </div></div>
      </main>
    )
  }
  if (!r) {
    return (
      <main className="key-page" aria-busy="true">
        <div className="key-top"><span className="key-sub" role="status">불러오는 중…</span></div>
        <div className="key-actions"><Link to="/me/reservations" className="btn-ghost center-link">내 예약 보기</Link></div>
      </main>
    )
  }

  const date = seoulDate(new Date(r.startAt))
  const today = seoulDate()
  const when = `${date === today ? '오늘 ' : ''}${dayLabel(date)}`
  const time = `${seoulClock(new Date(r.startAt))}–${seoulClock(new Date(r.endAt))}`
  const roomName = `창작실 ${r.room.id}`
  const active = isActive(r.status)
  // 입실은 QR만(11/10 재웅: 키패드·NFC 뺌). 번호는 화면에 보이지 않는다
  const showCode = r.owner && active && !!r.qrText
  const deadline = deadlineOf(r, state.instant)
  // 지금 바로 쓰기를 잘못 눌렀으면 여기서 바로 취소하러 간다 (시작 후에도 취소되는 예약만, core #84)
  const undo = canCancel(r, now.getTime()) && cancelDeadline(r).getTime() > Date.parse(r.startAt)

  async function share() {
    const text = `M-space ${roomName} · ${when} ${time}\n대표자 QR로 같이 들어가요`
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
      setShared('보내지 못했어요. 시간을 직접 알려 주세요.')
    }
  }

  return (
    <main className="key-page">
      <div className={`key-top ${justCreated && r.status === 'BOOKED' ? 'done' : ''}`}>
        <Spacey size={80} />
        <span className="key-title">{justCreated && r.status === 'BOOKED' ? '예약 완료' : r.status === 'IN_USE' ? '사용 중' : active ? '입실 QR' : STATUS_LABEL[r.status]}</span>
        <span className="key-sub">
          {entered ? '입실했어요. 마이로 넘어가요'
            : showCode
            ? (r.status === 'BOOKED' ? '문 앞 카메라에 QR을 비춰 주세요 · 화면이 꺼지지 않아요' : '잠깐 나갔다 와도 같은 QR로 열려요')
            : !r.owner ? 'QR은 대표자에게만 보여요. 대표자와 같이 들어가요'
            : r.status === 'NO_SHOW' ? '입실 시간이 지나 예약이 풀렸어요'
            : '끝난 예약이라 QR이 꺼졌어요'}
        </span>
      </div>

      {/* 방금 예약했으면 표가 인쇄되듯 위에서부터 펼쳐진다 */}
      <div className={`ticket ${justCreated ? 'fresh' : ''} ${entered ? 'opened' : ''}`}>
        <div className="ticket-body">
          {/* 입실되는 순간: QR이 세로로 접히고 그 자리에 열린 문 */}
          {entered && (
            <div className="door-open" role="status">
              <span className="door-icon" aria-hidden="true">🔓</span>
              <b>문이 열렸어요</b>
              <span>{roomName} · {seoulClock(new Date(r.endAt))}까지</span>
            </div>
          )}
          <div className="ticket-when">
            <span className="muted">{when}</span>
            <b>{roomName} · {time}</b>
          </div>
          {(showCode || entered) && (
            <>
              {/* 문 앞 웹캠이 읽는 입실 QR. 흰 바탕에 검은 칸, 화면 폭의 60% 넘게. 밝기를 올려 두면 더 잘 읽힌다 */}
              {r.status === 'BOOKED' && r.qrText && (
                <div className="code-qr" role="img" aria-label="입실 QR. 문 앞 카메라에 비춰 주세요">
                  <QRCodeSVG value={r.qrText} size={256} level="M" marginSize={2} bgColor="#ffffff" fgColor="#000000" />
                </div>
              )}
              {r.status === 'BOOKED'
                ? <>
                    {/* 1초마다 바뀌는 카운트다운은 읽어 주지 않고(aria-live off), 마감이 지난 순간만 따로 알린다 */}
                    <span className="deadline" aria-live="off">{deadlineText(deadline, r.startAt, now.getTime())}</span>
                    {now.getTime() > deadline.getTime() && <span className="sr-only" role="status">입실 마감이 지났어요</span>}
                  </>
                : <span className="deadline calm">입실했어요. 잠깐 나갔다 와도 같은 QR로 열려요</span>}
            </>
          )}
        </div>
        <div className="ticket-cut" aria-hidden="true"><span /><span /></div>
        <ol className="steps">
          <li><span>1</span>방 앞으로<br />가요</li>
          <li><span>2</span>카메라에<br />QR 비추기</li>
          <li><span>3</span>불이 켜지면<br />입실 완료</li>
          <li><span>4</span>방 사진<br />한 장 찍기</li>
        </ol>
      </div>

      {shared && <p className="key-toast" role="status">{shared}</p>}

      <div className="key-actions">
        {showCode && <button type="button" className="btn-ghost" onClick={share}>참여자에게 보내기</button>}
        <button type="button" className="btn-white" onClick={() => navigate('/me/reservations')}>내 예약 보기</button>
        {undo && <Link to={`/me/${r.id}`} className="link key-undo">잘못 눌렀어요 · {seoulClockSec(cancelDeadline(r))} 전까지 취소</Link>}
      </div>
    </main>
  )
}
