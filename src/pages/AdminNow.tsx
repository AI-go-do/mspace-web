import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { currentMemberId } from '../api/client'
import { adminErrorMessage } from '../api/admin'
import { envSource, getRoomsEnvironment, type RoomsEnvironment } from '../api/environment'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView, type RoomView } from '../lib/roomHealth'
import { majorAdvice, roomAdvice, type Advice, type AdviceContext } from '../lib/roomAdvice'
import { useRoomBlocks } from '../api/roomBlocks'
import { blockNow, reasonStatus } from '../lib/roomBlocks'
import { useCountUp } from '../lib/useCountUp'
import { seoulClock } from '../lib/time'
import type { TodoCounts } from './AdminTodo'
import { RoomTile } from './AdminFloor'
import { AdminOverview } from './AdminOverview'
import { overview } from '../lib/roomOverview'
import { RoomDetail } from './AdminRoomDetail'
import { setClimateAuto, useAppliances } from '../api/appliances'
import { seasonRules } from '../lib/climate'
import { useOutdoorWeather } from '../api/weather'
import { WeatherChip } from '../components/Climate'
import { useClimateAuto } from '../lib/useClimateAuto'
import '../components/Climate.css'
import './AdminNow.css'

const REQUEST_TIMEOUT_MS = 8_000

/** 카드 테두리 색: 방 값 표시 + 막힌 방에 사람·신고 같은 바깥 일도 노랑으로 */
export function cardTone(view: RoomView, advice: Advice[]): RoomView['tone'] {
  return view.tone !== 'ok' ? view.tone : advice.length ? 'warn' : 'ok'
}

/** 오른쪽 "지금 확인할 것". 방 하나에 한 장, 누르면 그 방 상세 창 */
function IssueFeed({ issues, onOpen }: { issues: { v: RoomView; list: Advice[] }[]; onOpen: (roomId: number) => void }) {
  return (
    <ul className="ctl-feed">
      {issues.map(({ v, list }, i) => (
        <li key={v.roomId} style={{ '--k': i } as CSSProperties}>
          <button type="button" className={`cf-item i-${list[0].tone}`} onClick={() => onOpen(v.roomId)}>
            <span className="cf-no">{v.roomId}</span>
            <span className="cf-text">
              <small>{v.name} · {list[0].tone === 'off' ? '장치 확인' : '주의'}</small>
              <b>{list[0].title}</b>
              <span>{list[0].todo}</span>
              {list.length > 1 && <em>외 {list.length - 1}건 더</em>}
            </span>
            <span className="cf-go" aria-hidden="true">›</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

/** 위 큰 숫자 하나. 값이 바뀌면 세어 올라간다 */
function Big({ label, value, of, unit, tone, hint }: { label: string; value: number | null; of?: number; unit?: string; tone?: string; hint?: string }) {
  const shown = useCountUp(value ?? 0)
  return (
    <div className={`ctl-big ${tone ?? ''}`}>
      <span className="cb-label">{label}</span>
      <b className="cb-num" aria-hidden="true">{value === null ? '–' : shown}{of !== undefined && <small> / {of}</small>}{unit && value !== null && <small> {unit}</small>}</b>
      <span className="sr-only">{value === null ? '모름' : `${value}${of !== undefined ? ` / ${of}` : ''}${unit ?? ''}`}</span>
      {hint && <span className="cb-hint">{hint}</span>}
    </div>
  )
}

/**
 * 관리자 "지금" = 관제실. 어두운 판 위에 방 1~5 평면도 + 오른쪽 "지금 확인할 것" + 아래 "전체 실시간 분석".
 * 맨 위 큰 숫자(쓰는 방·주의·확인 필요·평균 CO2·할 일)로 먼저 상황을 잡고, 이상한 방은 칸 모양(노란 고리·줄무늬)으로 먼저 보이게 한다.
 * 10초마다 새로 읽는다. 데이터는 api/environment 창구 하나에서만 받는다(지금은 가짜 값)
 */
export function AdminNow({ todo, onOpenTodo, onForceCheckout, onBlockRoom }: {
  todo: TodoCounts
  onOpenTodo: () => void
  onForceCheckout: (reservationId: number) => void
  onBlockRoom: (roomId: number, inspection: boolean) => void
}) {
  const [data, setData] = useState<RoomsEnvironment | null>(null)
  const [sample, setSample] = useState(envSource() === 'mock')
  const [error, setError] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const [openRoom, setOpenRoom] = useState<number | null>(null)
  const closeRoom = useCallback(() => setOpenRoom(null), [])

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    let stale = false
    let ctrl: AbortController | null = null
    let poll: ReturnType<typeof setInterval> | undefined

    const load = () => {
      if (ctrl || stale) return
      const mine = new AbortController()
      ctrl = mine
      const timer = setTimeout(() => mine.abort(), REQUEST_TIMEOUT_MS)
      getRoomsEnvironment(mine.signal, memberId)
        .then((r) => { if (stale) return; setData(r.data); setSample(r.sample); setError(null); setReadAt(new Date()) })
        .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
        .finally(() => { clearTimeout(timer); if (ctrl === mine) ctrl = null })
    }
    // 화면이 안 보일 때(다른 탭·화면 꺼짐)는 읽지 않고, 다시 보이면 바로 읽는다
    const start = () => { clearInterval(poll); load(); poll = setInterval(load, ENV_RULES.pollMs) }
    const onVisible = () => { if (document.visibilityState === 'visible') start(); else clearInterval(poll) }

    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stale = true
      clearInterval(poll)
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const { blocks } = useRoomBlocks()
  const views = useMemo(() => {
    if (!data) return []
    const now = new Date(data.now)
    return data.rooms.map((r) => toRoomView(r, ADMIN_ROOMS.find((c) => c.roomId === r.roomId), now))
  }, [data])

  const now = useMemo(() => (data ? new Date(data.now) : null), [data])
  const { auto } = useAppliances()
  const weather = useOutdoorWeather()
  const climateRules = useMemo(() => seasonRules(weather), [weather])
  useClimateAuto(views, now, auto, currentMemberId(), climateRules)
  const opened = openRoom === null ? null : views.find((v) => v.roomId === openRoom) ?? null
  const blockedOf = (roomId: number) => {
    const b = now ? blockNow(roomId, blocks, now) : null
    return b ? reasonStatus(b.reason) : null
  }

  const used = views.filter((v) => v.status.tone === 'use' || v.flags.overtime || v.flags.unbooked).length
  const ctxOf = (roomId: number): AdviceContext => ({ blocked: blockedOf(roomId), openReports: todo.byRoom[roomId] ?? 0 })
  const adviceOf = (v: RoomView) => (now ? majorAdvice(roomAdvice(v, now, ctxOf(v.roomId))) : [])
  const warn = views.filter((v) => cardTone(v, adviceOf(v)) === 'warn').length
  const off = views.filter((v) => v.tone === 'off').length
  const trendOnly = views.some((v) => v.forecastFrom === 'trend')
  // 맨 위 "지금 확인할 것": 방마다 가장 급한 한 줄. 남색(장치 문제)이 먼저
  const issues = now
    ? views.map((v) => ({ v, list: adviceOf(v) })).filter((x) => x.list.length > 0)
      .sort((a, b) => Number(b.list[0].tone === 'off') - Number(a.list[0].tone === 'off'))
    : []

  // 위 "평균 CO2"와 아래 분석의 평균이 늘 같게 같은 계산을 쓴다
  const avg = useMemo(() => overview(views).avg, [views])

  const tile = (v: RoomView, i: number, big = false) => {
    const list = adviceOf(v)
    return (
      <RoomTile key={v.roomId} i={i} big={big} view={v} tone={cardTone(v, list)} advice={list}
        blocked={blockedOf(v.roomId)} reports={todo.byRoom[v.roomId] ?? 0} now={now} rules={climateRules} onOpen={() => setOpenRoom(v.roomId)} />
    )
  }
  // 평면도: 1~4번은 위 한 줄, 큰 방(마지막 방)은 아래 넓게
  const small = views.slice(0, -1)
  const wide = views.length > 1 ? views[views.length - 1] : null

  return (
    <section className="admin-now ctl" aria-label="관제실 지금 방 상태">
      <div className="ctl-top">
        <Big label="지금 쓰는 방" value={data ? used : null} of={views.length || ADMIN_ROOMS.length} tone="lead" />
        <Big label="주의" value={data ? warn : null} tone={warn ? 'warn' : ''} hint="환기·시간 넘김·입실 안 함·문" />
        <Big label="확인 필요" value={data ? off : null} tone={off ? 'off' : ''} hint="센서 멈춤·끊김" />
        <Big label="평균 CO2" value={data ? avg : null} unit="ppm" hint={`기준 ${ENV_RULES.co2LimitPpm}`} />
        <button type="button" className={`ctl-big as-btn ${todo.total ? 'todo' : ''}`} onClick={onOpenTodo}>
          <span className="cb-label">할 일</span>
          <b className="cb-num" aria-hidden="true">{todo.reportsKnown ? todo.total : '–'}</b>
          <span className="sr-only">{todo.reportsKnown ? `${todo.total}건` : '모름'}</span>
          <span className="cb-hint">{!todo.reportsKnown ? `신고 수를 확인하지 못했어요 · AI 제안 ${todo.ai}`
            : todo.total ? `신고 ${todo.reports} · AI 제안 ${todo.ai}` : '사람이 볼 일이 없어요'}</span>
          <span className="cb-go" aria-hidden="true">→</span>
        </button>
      </div>

      <div className="ctl-bar">
        <span className="ctl-live"><i aria-hidden="true" />
          {readAt ? <>실시간 · 마지막 조회 <b>{seoulClock(readAt)}</b></> : '불러오는 중…'} · {ENV_RULES.pollMs / 1000}초마다</span>
        {sample && <span className="ctl-sample">가짜 값 · 시연용</span>}
        {trendOnly && <span className="ctl-note">예측은 최근 추세로 그렸어요</span>}
        <WeatherChip w={weather} />
        <span className="cl-auto" title="권유 중 기기 켜기·끄기만 대신 해요. 경고·정지는 하지 않아요">
          <button type="button" className={`cl-sw ${auto ? 'on' : ''}`} role="switch" aria-checked={auto} aria-label="에어컨·공기청정기 자동 제어"
            onClick={() => setClimateAuto(!auto)}><i aria-hidden="true" /></button>
          에어컨·공기청정기 자동 {auto ? '켜짐' : '꺼짐'}
        </span>
        <span className="ctl-legend" aria-hidden="true"><i className="lg-use" />사람 있음 <i className="lg-warn" />주의 <i className="lg-off" />확인 필요 <i className="lg-empty" />빈 방</span>
      </div>
      {error && <p role="alert" className="adm-msg err">{error}{data ? ` 마지막 값(${readAt ? seoulClock(readAt) : ''})을 보여 주고 있어요.` : ''}</p>}

      <div className="ctl-grid">
        <section className="ctl-floor" aria-label="방 평면도 (누르면 자세히)">
          <span className="ctl-scan" aria-hidden="true" />
          {!data && !error && Array.from({ length: 5 }, (_, i) => <div key={i} className={`ctl-tile skel ${i === 4 ? 'big' : ''}`} />)}
          {small.map((v, i) => tile(v, i))}
          {wide && tile(wide, views.length - 1, true)}
          <p className="ctl-hall" aria-hidden="true"><span>복도</span>입구 키패드 · QR 입실 · 방마다 CO2·온도·습도·재실·문 센서</p>
        </section>

        <aside className="ctl-side" aria-labelledby="ctl-issues-h">
          <h2 id="ctl-issues-h"><span className={`ctl-pulse ${issues.length ? 'on' : ''}`} aria-hidden="true" />지금 확인할 것 <b>{now ? issues.length : '–'}</b></h2>
          {issues.length > 0 && <IssueFeed issues={issues} onOpen={setOpenRoom} />}
          {data && issues.length === 0 && (
            <p className="ctl-allok" role="status"><span aria-hidden="true">✓</span> 모든 방이 괜찮아요. 확인할 것이 없어요.</p>
          )}
          <button type="button" className="ctl-todo" onClick={onOpenTodo}>
            <b>{todo.reportsKnown ? todo.total : '?'}</b>
            <span>사람이 정할 일<small>{todo.reportsKnown ? `신고 판정 ${todo.reports} · AI 제안 ${todo.ai}` : '신고 수를 확인하지 못했어요'}</small></span>
            <span aria-hidden="true">›</span>
          </button>
        </aside>

        {views.length > 0 && <AdminOverview views={views} />}
      </div>

      {opened && now && (
        <RoomDetail view={opened} now={now} blocked={blockedOf(opened.roomId)} reports={todo.byRoom[opened.roomId] ?? 0} sample={sample} onClose={closeRoom}
          onOpenReports={() => { closeRoom(); onOpenTodo() }}
          onForceCheckout={(id) => { closeRoom(); onForceCheckout(id) }}
          onBlockRoom={(id, insp) => { closeRoom(); onBlockRoom(id, insp) }} />
      )}
    </section>
  )
}
