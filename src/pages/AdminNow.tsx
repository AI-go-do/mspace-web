import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { currentMemberId } from '../api/client'
import { adminErrorMessage } from '../api/admin'
import { ENV_SOURCE, getRoomsEnvironment, type RoomsEnvironment } from '../api/environment'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView, type RoomView } from '../lib/roomHealth'
import { useRoomBlocks } from '../api/roomBlocks'
import { blockNow, reasonStatus } from '../lib/roomBlocks'
import { useCountUp } from '../lib/useCountUp'
import { seoulClock } from '../lib/time'
import type { TodoCounts } from './AdminTodo'
import { RoomChart } from './AdminRoomChart'
import { RoomDetail } from './AdminRoomDetail'
import { applianceState, setClimateAuto, useAppliances } from '../api/appliances'
import { ROOM_APPLIANCES } from '../config/appliances'
import { climateTips } from '../lib/climate'
import { useClimateAuto } from '../lib/useClimateAuto'
import '../components/Climate.css'
import './AdminNow.css'

const REQUEST_TIMEOUT_MS = 8_000

function Value({ label, value, unit, note, hot, big }: { label: string; value: string | null; unit: string; note: string; hot?: boolean; big?: boolean }) {
  return (
    <div className={`nv ${big ? 'big' : ''} ${hot ? 'hot' : ''}`}>
      <small>{label}</small>
      {value === null ? <b className="none">–</b> : <b>{value}<i>{unit}</i></b>}
      <em>{note}</em>
    </div>
  )
}

/** 방 한 장(넓은 화면은 한 줄). 아무 곳이나 누르면 방 상세 창이 열린다 */
export function RoomCard({ view, now, blocked, i = 0, onOpen }: { view: RoomView; now: Date; blocked?: string | null; i?: number; onOpen?: () => void }) {
  const { flags } = view
  return (
    <article className={`card now-room t-${view.tone} ${onOpen ? 'can-open' : ''}`} aria-label={`${view.name} ${view.status.text}`} style={{ '--k': i } as CSSProperties}
      onClick={onOpen}>
      <header className="nr-head">
        <span className="nr-no">{view.roomId}</span>
        <div className="nr-title">
          <b>{view.name}</b>
          <span className="muted">{view.slot}</span>
        </div>
        {blocked && <span className="nr-st s-warn" title="관리자가 막은 기간">{blocked}</span>}
        <span className={`nr-st s-${view.status.tone}`}>{view.status.text}</span>
      </header>
      <div className="nr-vals">
        <Value big label="CO2" value={view.co2 === null ? null : String(view.co2)} unit="ppm" note={view.co2Note}
          hot={flags.co2Soon || flags.co2Over} />
        <Value label="온도" value={view.temperatureC === null ? null : view.temperatureC.toFixed(1)} unit="°C" note={view.tempNote} hot={flags.hot} />
        <Value label="습도" value={view.humidityPct === null ? null : String(view.humidityPct)} unit="%" note={view.humNote} />
      </div>
      <ClimateChips view={view} now={now} />
      <RoomChart view={view} now={now} />
      {onOpen && (
        <button type="button" className="nr-open" onClick={(e) => { e.stopPropagation(); onOpen() }} aria-label={`${view.name} 자세히 보기`}>
          자세히<span aria-hidden="true"> ›</span>
        </button>
      )}
    </article>
  )
}

/** 방 줄의 에어컨·공기청정기 표시: 켜진 기기 + 권유가 있으면 한 줄 ("숨 막히기 12분 전") */
function ClimateChips({ view, now }: { view: RoomView; now: Date }) {
  const store = useAppliances()
  const devs = ROOM_APPLIANCES[view.roomId] ?? []
  if (!devs.length) return null
  const tips = climateTips(view, now, (id) => applianceState(id, store))
  const on = devs.filter((a) => applianceState(a.id, store).power === 'ON')
  if (!tips.length && !on.length) return null
  return (
    <div className="cl-chips">
      {tips.slice(0, 1).map((t) => <span key={t.key} className="cl-chip tip">{t.title}{t.button ? ` · ${t.button}` : ''}</span>)}
      {on.map((a) => <span key={a.id} className="cl-chip on">{a.name} 켜짐</span>)}
    </div>
  )
}

/** 위 숫자 칸 하나. 값이 바뀌면 세어 올라간다 */
function Kpi({ label, value, of, tone, onClick, hint }: { label: string; value: number | null; of?: number; tone?: string; onClick?: () => void; hint?: string }) {
  const shown = useCountUp(value ?? 0)
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <b className="kpi-num" aria-hidden="true">{value === null ? '–' : shown}{of !== undefined && <small>/ {of}</small>}</b>
      <span className="sr-only">{value === null ? '모름' : `${value}${of !== undefined ? ` / ${of}` : ''}`}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </>
  )
  return onClick
    ? <button type="button" className={`card kpi ${tone ?? ''} as-btn`} onClick={onClick}>{body}<span className="kpi-go" aria-hidden="true">→</span></button>
    : <div className={`card kpi ${tone ?? ''}`}>{body}</div>
}

/**
 * 관리자 "지금": 위에 숫자 넷(사용 중·주의·확인 필요·할 일), 아래 방마다 CO2·온도·습도·재실을 크게. 10초마다 새로 읽는다.
 * 지켜보는 화면보다 "어디를 봐야 하나"가 먼저 보이게 이상한 방은 테두리 색으로 표시한다(노랑 주의, 남색 확인 필요).
 * 데이터는 api/environment 창구 하나에서만 받는다(지금은 가짜 값)
 */
export function AdminNow({ todo, onOpenTodo, onForceCheckout, onBlockRoom }: {
  todo: TodoCounts
  onOpenTodo: () => void
  onForceCheckout: (reservationId: number) => void
  onBlockRoom: (roomId: number, inspection: boolean) => void
}) {
  const [data, setData] = useState<RoomsEnvironment | null>(null)
  const [sample, setSample] = useState(ENV_SOURCE === 'mock')
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
  useClimateAuto(views, now, auto, currentMemberId())
  const opened = openRoom === null ? null : views.find((v) => v.roomId === openRoom) ?? null
  const blockedOf = (roomId: number) => {
    const b = now ? blockNow(roomId, blocks, now) : null
    return b ? reasonStatus(b.reason) : null
  }

  const used = views.filter((v) => v.status.tone === 'use' || v.flags.overtime || v.flags.unbooked).length
  const warn = views.filter((v) => v.tone === 'warn').length
  const off = views.filter((v) => v.tone === 'off').length
  const trendOnly = views.some((v) => v.forecastFrom === 'trend')

  return (
    <section className="admin-now" aria-label="지금 방 상태">
      <div className="kpis">
        {/* 방 값을 한 번도 못 받았으면 0이 아니라 "–"(모름) */}
        <Kpi label="사용 중" value={data ? used : null} of={views.length || ADMIN_ROOMS.length} tone="blue" />
        <Kpi label="주의" value={data ? warn : null} tone={warn ? 'yellow' : ''} hint="환기·더움·시간 넘김" />
        <Kpi label="확인 필요" value={data ? off : null} tone={off ? 'navy' : ''} hint="센서 멈춤·끊김" />
        <Kpi label="할 일" value={todo.reportsKnown ? todo.total : null} tone={todo.total ? 'k-todo' : ''} onClick={onOpenTodo}
          hint={!todo.reportsKnown ? `신고 수를 확인하지 못했어요 · AI 제안 ${todo.ai}`
            : todo.total ? `신고 ${todo.reports} · AI 제안 ${todo.ai}` : '사람이 볼 일이 없어요'} />
      </div>
      <div className="now-bar">
        <span className="now-clock" role="status"><span className="now-dot" aria-hidden="true" />
          {readAt ? <>마지막 조회 <b>{seoulClock(readAt)}</b></> : '불러오는 중…'} · {ENV_RULES.pollMs / 1000}초마다 새 값</span>
        {sample && <span className="now-sample">가짜 값 · 시연용</span>}
        <span className="now-legend">
          <i className="lg-line" />측정 <i className="lg-pred" />{ENV_RULES.forecastMinutes}분 예측{trendOnly ? '(최근 추세)' : ''}·범위
          <i className="lg-limit" />환기 기준 {ENV_RULES.co2LimitPpm} <i className="lg-over" />넘은 구간 <i className="lg-eta" />넘을 때
        </span>
        <span className="cl-auto" title="권유 중 기기 켜기·끄기만 대신 해요. 경고·정지는 하지 않아요">
          <button type="button" className={`cl-sw ${auto ? 'on' : ''}`} role="switch" aria-checked={auto} aria-label="에어컨·공기청정기 자동 제어"
            onClick={() => setClimateAuto(!auto)}><i aria-hidden="true" /></button>
          에어컨·공기청정기 자동 {auto ? '켜짐' : '꺼짐'}
        </span>
        <span className="now-tap">방을 누르면 자세히 · 할 일</span>
      </div>
      {error && <p role="alert" className="adm-msg err">{error}{data ? ` 마지막 값(${readAt ? seoulClock(readAt) : ''})을 보여 주고 있어요.` : ''}</p>}
      {!data && !error && <div className="now-rooms">{Array.from({ length: 5 }, (_, i) => <div key={i} className="card now-room skel" />)}</div>}
      {views.length > 0 && (
        <div className="now-rooms">
          {views.map((v, i) => (
            <RoomCard key={v.roomId} i={i} view={v} now={now!} blocked={blockedOf(v.roomId)} onOpen={() => setOpenRoom(v.roomId)} />
          ))}
        </div>
      )}
      {opened && now && (
        <RoomDetail view={opened} now={now} blocked={blockedOf(opened.roomId)} onClose={closeRoom}
          onForceCheckout={(id) => { closeRoom(); onForceCheckout(id) }}
          onBlockRoom={(id, insp) => { closeRoom(); onBlockRoom(id, insp) }} />
      )}
    </section>
  )
}
