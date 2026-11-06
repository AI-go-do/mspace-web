import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { getFriends, type FriendList } from '../api/friends'
import { isActive, type MyReservation } from '../api/reservations'
import { classesOn, getSchedule, seoulDay, type Schedule } from '../api/schedule'
import Spacey from '../components/Spacey'
import { useAuth } from '../auth/AuthProvider'
import { hasAgreed } from '../content/rules'
import { timeRange, whenLabel } from '../lib/format'
import { useIsAdmin } from '../lib/useIsAdmin'
import { useMemberId } from '../lib/useMemberId'
import { useNow } from '../lib/useNow'
import { InUseCard, useMyReservations } from './MyReservations'
import './Mine.css'
import './MyPage.css'

const Chevron = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>
)

/** "오늘 수업 3개 · 15:00 끝" / "오늘 수업 없음" / "아직 안 넣었어요". 못 받았으면(undefined) 빈 줄 */
export function scheduleLine(schedule: Schedule | null | undefined, now: Date): string {
  if (schedule === undefined) return ''
  if (schedule === null) return '아직 안 넣었어요'
  const today = classesOn(schedule.classes, seoulDay(now))
  if (today.length === 0) return '오늘 수업 없음'
  const last = today.reduce((a, b) => (a.endTime > b.endTime ? a : b))
  return `오늘 수업 ${today.length}개 · ${last.endTime} 끝`
}

/** "다가오는 1 · 지난 12". 못 받았으면 빈 줄 */
export function reservationsLine(list: MyReservation[] | null): string {
  if (!list) return ''
  const upcoming = list.filter((r) => isActive(r.status)).length
  return `다가오는 ${upcoming} · 지난 ${list.length - upcoming}`
}

/** "친구 4 · 받은 요청 1" (받은 요청이 없으면 "친구 4"). 못 받았으면 빈 줄 */
export function friendsLine(f: FriendList | null): string {
  if (!f) return ''
  return f.received.length ? `친구 ${f.friends.length} · 받은 요청 ${f.received.length}` : `친구 ${f.friends.length}`
}

/**
 * 마이 탭 (11/6 재웅: 내 예약에 로그아웃·시간표·친구가 섞여 있으니 마이페이지로 묶자).
 * 위에서 아래로: 머리글(스페이시·내 정보·수칙 동의) → 사용 중/다가오는 예약 1장 → 줄 메뉴(내 예약·내 시간표·친구·이용 규칙) → 관리자 → 로그아웃.
 * 이름·학번은 넣지 않는다(토큰에 회원 번호만 있고, 공용 폰에서 남의 이름이 보일 수 있어서).
 * 입실하면 여기로 넘어오고 사용 중 카드가 맨 위에 그대로 있다(FR-WEB-002)
 */
export default function MyPage() {
  // 회원이 바뀌면(공용 폰에서 다른 사람이 로그인) 화면을 통째로 새로 만들어 앞 사람의 예약·시간표·친구 요약을 바로 버린다
  const member = useMemberId()
  return <MyPageFor key={member ?? 'none'} member={member} />
}

function MyPageFor({ member }: { member: number | null }) {
  const { list, error, stale, reload } = useMyReservations()
  const { logout } = useAuth()
  const now = useNow()
  const admin = useIsAdmin()
  const [schedule, setSchedule] = useState<Schedule | null | undefined>(undefined)
  const [friends, setFriends] = useState<FriendList | null>(null)
  const [logoutError, setLogoutError] = useState<string | null>(null)
  const [extended, setExtended] = useState<{ id: number; text: string } | null>(null)

  // 회원 번호를 아직 모르면(첫 토큰 갱신이 늦거나 실패) 알게 되는 순간(새 key로 다시 그려짐) 받고, 연결이 돌아오면 못 받은 것만 다시 받는다
  useEffect(() => {
    if (member === null) return
    let alive = true
    let gotSchedule = false
    let gotFriends = false
    // 줄 메뉴의 한 줄 요약. 못 받아도 메뉴는 그대로 열린다
    const load = () => {
      if (!gotSchedule) getSchedule(member).then((s) => { if (alive) { setSchedule(s); gotSchedule = true } }).catch(() => {})
      if (!gotFriends) getFriends(undefined, member).then((f) => { if (alive) { setFriends(f); gotFriends = true } }).catch(() => {})
    }
    load()
    window.addEventListener('online', load)
    return () => {
      alive = false
      window.removeEventListener('online', load)
    }
  }, [member])

  const tryLogout = () => {
    setLogoutError(null)
    logout().catch(() => setLogoutError('로그아웃하지 못했어요. 잠시 후 다시 눌러 주세요.'))
  }

  const active = (list ?? []).filter((r) => isActive(r.status))
  const inUse = active.find((r) => r.status === 'IN_USE')
  const next = active.find((r) => r !== inUse)
  const agreed = hasAgreed()

  return (
    <main className="mine my">
      <header className="my-head">
        <span className="my-mascot" aria-hidden="true"><Spacey size={56} label="" /></span>
        <div className="my-head-text">
          <h1>내 정보</h1>
          <span className={`my-badge ${agreed ? 'on' : ''}`}>{agreed ? '수칙 동의 ✓' : '수칙 동의 전'}</span>
        </div>
      </header>

      {error && <p role="alert" className="card mine-msg">내 예약을 못 불러왔어요. {error}</p>}
      {stale && <p role="status" className="card mine-msg muted">최신 정보를 못 받았어요. 잠시 후 다시 받아요.</p>}

      {inUse && <InUseCard key={inUse.id} r={inUse} onChanged={reload}
        notice={extended && extended.id === inUse.id ? extended.text : null}
        onExtended={(id, text) => setExtended({ id, text })} />}
      {!inUse && next && (
        <Link to={`/me/${next.id}`} className="card mine-item">
          <span className="mine-item-text">
            <span className="muted">곧 쓸 예약 · {next.owner ? '대표자' : '참여자'}</span>
            <b>{whenLabel(next.startAt, now)} · 창작실 {next.room.id}</b>
            <span className="muted">{timeRange(next.startAt, next.endAt)}</span>
          </span>
          <Chevron />
        </Link>
      )}

      <nav className="my-menu card" aria-label="내 정보 메뉴">
        <Link to="/me/reservations" className="my-row">
          <span className="my-row-text"><b>내 예약</b><span className="muted">{reservationsLine(list)}</span></span><Chevron />
        </Link>
        <Link to="/me/schedule" className="my-row">
          <span className="my-row-text"><b>내 시간표</b><span className="muted">{scheduleLine(schedule, now)}</span></span><Chevron />
        </Link>
        <Link to="/me/friends" className="my-row">
          <span className="my-row-text">
            <b>친구{!!friends?.received.length && <i className="my-dot" aria-hidden="true" />}</b>
            <span className="muted">{friendsLine(friends)}</span>
          </span>
          <Chevron />
        </Link>
        <Link to="/rules" className="my-row">
          <span className="my-row-text"><b>이용 규칙</b></span><Chevron />
        </Link>
        {admin && (
          <Link to="/admin" className="my-row">
            <span className="my-row-text"><b>관리자</b><span className="muted">신고 판정 · 이용 현황</span></span><Chevron />
          </Link>
        )}
      </nav>

      <button type="button" className="my-logout" onClick={tryLogout}>로그아웃</button>
      {logoutError && <p role="alert" className="muted mine-msg">{logoutError}</p>}
    </main>
  )
}
