import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError } from '../api/client'
import { continueReservation, getMyReservations, isActive, STATUS_LABEL, type MyReservation } from '../api/reservations'
import { AppealSheet } from '../components/PenaltyHistory'
import { LooseWarningCard, matchWarnings, openAppealCount, useMyWarnings, WarningRow } from '../components/PastWarnings'
import { BackIcon, newKey } from '../components/ReserveSteps'
import type { WarningRecord } from '../lib/appeal'
import { canContinueAt, minutesLabel, remainLabel, timeRange, whenLabel } from '../lib/format'
import { seoulClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import { useStillHere } from './Alerts'
import './Mine.css'

const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
)

const REFRESH_MS = 30_000
/** 답이 오지 않는 요청을 끊는 시간. 끊어야 다음 새로고침이 돈다 */
export const REQUEST_TIMEOUT_MS = 15_000

/**
 * 다른 화면에서도 쓰는 내 예약 목록 받기.
 * 화면이 열려 있는 동안 30초마다, 그리고 화면으로 돌아올 때 다시 받는다(키패드로 입실하면 상태가 바뀌므로).
 * 요청은 한 번에 하나만 보내고, 진행 중에 또 오면 끝난 뒤 한 번만 다시 받는다.
 */
export function useMyReservations() {
  const [list, setList] = useState<MyReservation[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  // 한 번 받은 뒤 새로 받기에 실패한 경우: 목록은 그대로 두고 따로 알린다
  const [stale, setStale] = useState(false)
  const alive = useRef(true)
  const loaded = useRef(false)
  const inFlight = useRef(false)
  const again = useRef(false)
  const reload = useCallback(() => {
    const run = () => {
      if (inFlight.current) {
        again.current = true
        return
      }
      inFlight.current = true
      const abort = new AbortController()
      const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
      getMyReservations(abort.signal)
        .then((l) => {
          if (!alive.current) return
          setList(l)
          setError(null)
          setStale(false)
          loaded.current = true
        })
        // 처음부터 못 받으면 오류 화면, 한 번 받은 뒤 실패하면 목록은 두고 "최신 아님"만 알린다
        .catch((e: Error) => {
          if (!alive.current) return
          if (loaded.current) setStale(true)
          else setError(abort.signal.aborted ? '연결이 늦어요. 잠시 후 다시 시도해 주세요' : e.message)
        })
        .finally(() => {
          clearTimeout(timer)
          inFlight.current = false
          if (alive.current && again.current) {
            again.current = false
            run()
          }
        })
    }
    run()
  }, [])
  useEffect(() => {
    alive.current = true
    reload()
    const onVisible = () => {
      if (document.visibilityState === 'visible') reload()
    }
    const timer = setInterval(reload, REFRESH_MS)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [reload])
  return { list, error, stale, reload }
}

/**
 * FR-WEB-002 내 예약 목록 (시안 Mine, 마이 탭 > 내 예약): 사용 중인 예약은 맨 위 카드(남은 시간 + 진행 막대 + 퇴실),
 * 다가오는 예약은 눌러서 상세(취소), 지난 예약은 따로.
 * 사용 중 카드의 "방에 문제가 있나요?"는 신고 화면(FR-RPT-101)으로 간다.
 * 이용 규칙·시간표·친구·관리자·로그아웃은 마이 탭(MyPage)으로 옮겼다(11/6 재웅).
 * 경고 받은 지난 예약에는 배달 앱 리뷰처럼 "경고 철회 요청 (N일 남음)" 버튼을 붙인다(FR-RPT-105, PastWarnings).
 * `?tab=past`로 열면 지난 탭부터(경고 알림에서 바로 오게)
 */
export default function MyReservations() {
  const { list, error, stale, reload } = useMyReservations()
  const navigate = useNavigate()
  const now = useNow()
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'upcoming' | 'past'>(() => (params.get('tab') === 'past' ? 'past' : 'upcoming'))
  const warnings = useMyWarnings()
  const [writing, setWriting] = useState<WarningRecord | null>(null)
  const [justSent, setJustSent] = useState<number | null>(null)
  const openAppeals = openAppealCount(warnings, now)
  // 연장하면 새 예약(새 id)으로 카드가 바뀌므로, 알림은 카드 밖에 두고 새 예약 id에 붙인다
  const [extended, setExtended] = useState<{ id: number; text: string } | null>(null)

  const active = (list ?? []).filter((r) => isActive(r.status))
  const past = (list ?? []).filter((r) => !isActive(r.status))
  const inUse = active.find((r) => r.status === 'IN_USE')
  const upcoming = active.filter((r) => r !== inUse)
  const { byReservation, loose } = matchWarnings(warnings, past.map((r) => r.id))
  // 시트를 연 뒤 상태가 바뀌어도(보냄 → AI 판단) 최신 경고를 넘긴다
  const writingNow = writing ? warnings.find((w) => w.id === writing.id) ?? writing : null

  return (
    <main className="mine">
      <header className="mine-head">
        <div className="mine-title">
          <button type="button" className="back" aria-label="뒤로" onClick={() => navigate('/me')}><BackIcon /></button>
          <h1>내 예약</h1>
        </div>
        <div className="seg-tabs" role="group" aria-label="보기">
          <button type="button" aria-pressed={tab === 'upcoming'} onClick={() => setTab('upcoming')}>다가오는</button>
          <button type="button" aria-pressed={tab === 'past'} onClick={() => setTab('past')}
            aria-label={openAppeals > 0 ? `지난, 철회 요청할 수 있는 경고 ${openAppeals}건` : undefined}>
            지난{openAppeals > 0 && <i className="pw-dot" aria-hidden="true" />}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="card mine-msg">내 예약을 못 불러왔어요. {error}</p>}
      {stale && <p role="status" className="card mine-msg muted">최신 정보를 못 받았어요. 잠시 후 다시 받아요.</p>}
      {!list && !error && <p className="card mine-msg muted" role="status">불러오는 중…</p>}

      {list && tab === 'upcoming' && (
        <>
          {openAppeals > 0 && (
            <button type="button" className="pw-banner" onClick={() => setTab('past')}>
              <b>철회를 요청할 수 있는 경고가 {openAppeals}건 있어요</b>
              <span className="muted">지난 예약 보기</span>
            </button>
          )}
          {inUse && <InUseCard key={inUse.id} r={inUse} onChanged={reload}
            notice={extended && extended.id === inUse.id ? extended.text : null}
            onExtended={(id, text) => setExtended({ id, text })} />}
          {upcoming.map((r) => (
            <Link key={r.id} to={`/me/${r.id}`} className="card mine-item">
              <span className="mine-item-text">
                <span className="muted">곧 쓸 예약 · {r.owner ? '대표자' : '참여자'}</span>
                <b>{whenLabel(r.startAt, now)} · 창작실 {r.room.id}</b>
                <span className="muted">{timeRange(r.startAt, r.endAt)}</span>
              </span>
              <Chevron />
            </Link>
          ))}
          {active.length === 0 && (
            <div className="card mine-empty">
              <b>다가오는 예약이 없어요</b>
              <span className="muted">홈에서 방을 누르면 바로 시간을 골라요.</span>
              <Link to="/" className="link">방 고르러 가기</Link>
            </div>
          )}
        </>
      )}

      {list && tab === 'past' && (
        <>
          {loose.map((w) => (
            <LooseWarningCard key={`w${w.id}`} w={w} now={now} fresh={justSent === w.id} onWrite={() => setWriting(w)} />
          ))}
          {past.map((r) => {
            const item = (
              <Link key={r.id} to={`/me/${r.id}`} className="card mine-item past">
                <span className="mine-item-text">
                  <span className="muted">{STATUS_LABEL[r.status]} · {r.owner ? '대표자' : '참여자'}</span>
                  <b>{whenLabel(r.startAt, now)} · 창작실 {r.room.id}</b>
                  <span className="muted">{timeRange(r.startAt, r.endAt)}</span>
                </span>
                <Chevron />
              </Link>
            )
            const w = byReservation.get(r.id)
            if (!w) return item
            // 버튼은 링크 밖에 둔다(링크 안 버튼은 누를 때 상세로 넘어가 버림)
            return (
              <div key={r.id} className="pw-wrap">
                {item}
                <WarningRow w={w} now={now} fresh={justSent === w.id} onWrite={() => setWriting(w)} />
              </div>
            )
          })}
          {past.length === 0 && loose.length === 0 && <p className="card mine-msg muted">지난 예약이 없어요.</p>}
        </>
      )}

      {writingNow && (
        <AppealSheet w={writingNow} onClose={() => setWriting(null)} onSent={() => setJustSent(writingNow.id)} />
      )}

    </main>
  )
}

/** 연장 길이 고르기: 30분 단위 최대 2시간 (FR-RSV-105) */
const CONTINUE_STEPS = [30, 60, 90, 120]

/**
 * 지금 사용 중 카드 (입실하면 이 창으로 바뀐다): 방·시간·인원, 1초마다 줄어드는 남은 시간, 끝나는 시각, 진행 막대,
 * 대표자 버튼 — 퇴실하기 · 연장하기(끝나기 10분 전부터) · 아직 있어요(예약당 1번)
 */
export function InUseCard({ r, onChanged, notice, onExtended }: {
  r: MyReservation
  onChanged: () => void
  /** 연장 직후 새 카드에 남길 알림 (카드가 바뀌어도 사라지지 않게 부모가 들고 있다) */
  notice: string | null
  onExtended: (newId: number, text: string) => void
}) {
  const now = useNow(1_000)
  const start = Date.parse(r.startAt)
  const end = Date.parse(r.endAt)
  const done = Math.min(100, Math.max(0, ((now.getTime() - start) / (end - start)) * 100))
  const elapsed = minutesLabel((now.getTime() - start) / 60_000)
  const total = minutesLabel((end - start) / 60_000)
  const canContinue = canContinueAt(r.endAt, now.getTime())
  const still = useStillHere(r.id)
  const [picking, setPicking] = useState(false)
  const [sending, setSending] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  // 한 번 고르는 동안은 같은 멱등 키를 쓴다(응답을 못 받고 다시 눌러도 두 번 연장되지 않게)
  // 다른 길이를 고르면 새 키를 쓴다(같은 키에 다른 끝 시각을 보내면 core가 처음 요청 결과를 돌려주므로)
  const key = useRef({ minutes: 0, value: newKey() })

  async function extend(minutes: number) {
    if (sending) return
    setSending(true)
    setNote(null)
    if (key.current.minutes !== minutes) key.current = { minutes, value: newKey() }
    try {
      const res = await continueReservation(r.id, new Date(end + minutes * 60_000).toISOString(), key.current.value)
      key.current = { minutes: 0, value: newKey() }
      setPicking(false)
      onExtended(res.id, `${seoulClock(new Date(res.endAt))}까지 연장했어요. 입실 번호가 새로 나왔어요.`)
      onChanged()
    } catch (e) {
      setNote(e instanceof ApiError ? e.message : '잠시 후 다시 눌러 주세요')
      // 409(이미 연장·다음 칸 예약됨·시간 밖)는 같은 키로 다시 보내도 같으니 새 키로 바꾼다
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) key.current = { minutes: 0, value: newKey() }
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="inuse" aria-label="지금 사용 중인 예약">
      <div className="inuse-top">
        <div className="inuse-info">
          <span className="inuse-state"><i aria-hidden="true" />지금 사용 중</span>
          <b className="inuse-room">창작실 {r.room.id}</b>
          <span className="inuse-sub">{timeRange(r.startAt, r.endAt)} · {r.participants.length}명</span>
        </div>
        <div className="inuse-left">
          <span>{seoulClock(new Date(end))}까지</span>
          <b className="inuse-count" aria-live="off">{remainLabel(end - now.getTime())}</b>
          <span>남음</span>
        </div>
      </div>
      <div className="inuse-bar" role="img" aria-label={`${total} 중 ${elapsed} 지남`}>
        <i style={{ width: `${done}%` }} />
      </div>
      {r.owner ? (
        <>
          <Link to={`/me/${r.id}/checkout`} className="inuse-btn">다 썼어요, 퇴실하기</Link>
          <div className="inuse-row">
            <button type="button" className="inuse-btn2" disabled={!canContinue || sending} aria-expanded={picking}
              onClick={() => { setNote(null); setPicking((v) => !v) }}>
              연장하기
            </button>
            {still.state.kind !== 'done' && (
              <button type="button" className="inuse-btn2" disabled={still.state.kind === 'sending'} onClick={() => void still.press()}>
                {still.state.kind === 'sending' ? '알리는 중…' : '아직 있어요'}
              </button>
            )}
          </div>
          {!canContinue && end > now.getTime() && <span className="inuse-note">연장은 끝나기 10분 전부터 할 수 있어요</span>}
          {picking && canContinue && (
            <div className="inuse-steps" role="group" aria-label="얼마나 더 쓸까요">
              {CONTINUE_STEPS.map((m) => (
                <button key={m} type="button" className="inuse-step" disabled={sending} onClick={() => void extend(m)}>
                  +{minutesLabel(m)}<small>{seoulClock(new Date(end + m * 60_000))}까지</small>
                </button>
              ))}
            </div>
          )}
          {notice && <p className="inuse-note" role="status">{notice}</p>}
          {note && <p className="inuse-note" role="alert">{note}</p>}
          {still.state.kind === 'done' && <p className="inuse-note" role="status">{still.state.message}</p>}
          {still.state.kind === 'error' && <p className="inuse-note" role="alert">{still.state.message}</p>}
        </>
      ) : (
        <span className="inuse-note">퇴실·연장은 대표자가 해요</span>
      )}
      <div className="inuse-links">
        {r.owner && <Link to={`/reservations/${r.id}`} className="inuse-link">입실 번호 다시 보기</Link>}
        <Link to={`/me/${r.id}`} className="inuse-link">예약 자세히 보기</Link>
        <Link to={`/report?roomId=${r.room.id}&reservationId=${r.id}`} className="inuse-link">방에 문제가 있나요?</Link>
      </div>
    </section>
  )
}
