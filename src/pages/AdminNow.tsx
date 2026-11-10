import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { currentMemberId } from '../api/client'
import { adminErrorMessage } from '../api/admin'
import { envSource, getRoomsEnvironment, type RoomsEnvironment, setSimSpeed } from '../api/environment'
import { trailFor, withLightTrail } from '../lib/lightTrail'
import { ADMIN_ROOMS, ENV_RULES } from '../config/adminRooms'
import { toRoomView, type RoomView } from '../lib/roomHealth'
import { majorAdvice, roomAdvice, type Advice, type AdviceContext } from '../lib/roomAdvice'
import { useRoomBlocks } from '../api/roomBlocks'
import { blockNow, reasonStatus } from '../lib/roomBlocks'
import { useCountUp } from '../lib/useCountUp'
import { seoulClock } from '../lib/time'
import type { TodoCounts } from './AdminTodo'
import { RoomTile, TILE_METRICS, type TileMetric } from './AdminFloor'
import { AdminOverview } from './AdminOverview'
import { AdminSensorBoard } from './AdminSensorBoard'
import { overview } from '../lib/roomOverview'
import { RoomDetail } from './AdminRoomDetail'
import { Judge, Steps, STEP_MS } from '../components/OdiSteps'
import { APPLIANCE_SOURCE, useAppliances } from '../api/appliances'
import { useClimateRules } from '../components/Climate'
import { useClimateAuto } from '../lib/useClimateAuto'
import '../components/Climate.css'
import './AdminNow.css'

const REQUEST_TIMEOUT_MS = 8_000

/** 카드 테두리 색: 방 값 표시 + 막힌 방에 사람·신고 같은 바깥 일도 노랑으로 */
export function cardTone(view: RoomView, advice: Advice[]): RoomView['tone'] {
  return view.tone !== 'ok' ? view.tone : advice.length ? 'warn' : 'ok'
}

/**
 * 오른쪽 "오디가 한 일"(10차 회의: 관리자는 보기만). 방 하나에 한 장, 누르면 그 방 상세 창.
 * 오디가 대신 처리한 일은 파랑 줄로, 장치처럼 사람 손이 꼭 필요한 일만 남색 "장치 확인"으로 남긴다
 */
function ActionFeed({ issues, onOpen, sample, checks }: { issues: { v: RoomView; list: Advice[] }[]; onOpen: (roomId: number) => void; sample: boolean; checks: number }) {
  return (
    <ul className="ctl-feed">
      {issues.map(({ v, list }, i) => {
        const top = list[0]
        return (
          <li key={v.roomId} style={{ '--k': i } as CSSProperties}>
            <button type="button" className={`cf-item i-${top.tone}`} onClick={() => onOpen(v.roomId)}>
              <span className="cf-no">{v.roomId}</span>
              <span className="cf-text">
                <small>{v.name} · {top.hands ? '장치 점검' : top.auto ? '오디가 처리' : '장치 확인'}</small>
                <b>{top.title}</b>
                {top.auto && <span className="cf-auto">오디: {top.auto}</span>}
                {list.length > 1 && <em>외 {list.length - 1}건 더</em>}
              </span>
              <span className="cf-go" aria-hidden="true">›</span>
            </button>
            {top.steps && <Judge steps={top.steps} sample={sample} />}
            {top.hands && <div className="ca-watch"><Watch sample={sample} checks={checks} did={top.auto} /></div>}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * 센서 끊김·멈춤(11/10 재웅 "AI는 상태를 계속 다시 분석하고, 고치는 건 사람"). 오디는 찾고 알리고 계속 다시 본다.
 * 다시 보기는 이 화면의 조회 주기(pollMs)와 같다. 값이 다시 움직이면 이 줄은 저절로 사라진다
 */
function Watch({ sample, checks, did }: { sample: boolean; checks: number; did?: string }) {
  const steps = ['찾았어요', did ?? '담당에게 알림',
    `다시 확인 중${checks > 0 ? ` · ${checks}번째` : ''}`]
  return (
    <>
      <Steps steps={steps} sample={sample} at={2} ms={STEP_MS} label="오디가 지켜보는 과정" live />
    </>
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
 * 관리자 "지금" = 관제실. 어두운 판 위에 방 1~5 평면도 + 오른쪽 "오디가 한 일" + 아래 "전체 실시간 분석". 관리자는 보기만(10차 회의).
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
  // 조회한 횟수. 센서 끊김 칸의 '몇 번째 다시 확인'에 쓴다
  const [reads, setReads] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [readAt, setReadAt] = useState<Date | null>(null)
  const [openRoom, setOpenRoom] = useState<number | null>(null)
  // 시연 빨리 감기(가짜 값만): 1초에 1분씩 흐르게 하고 1초마다 읽는다
  const [fast, setFast] = useState(false)
  useEffect(() => { setSimSpeed(fast ? 60 : 1) }, [fast])
  useEffect(() => () => setSimSpeed(1), [])
  // 오디가 새로 처리한 일을 시각과 함께 쌓는다(이 화면을 연 동안만). "관리자가 아무것도 안 해도 저절로"를 보여 주는 줄
  const [history, setHistory] = useState<{ key: string; at: Date; room: string; title: string; auto: string }[]>([])
  const closeRoom = useCallback(() => setOpenRoom(null), [])
  // 방 칸에 보이는 값: 공통 하나 + 방마다 따로 고른 값(11/10 재웅). 공통을 바꾸면 따로 고른 것은 풀린다
  const [metric, setMetric] = useState<TileMetric>('co2')
  const [own, setOwn] = useState<Record<number, TileMetric>>({})
  const pickCommon = (m: TileMetric) => { setMetric(m); setOwn({}) }
  const pickOwn = (roomId: number, m: TileMetric) => setOwn((o) => {
    const next = { ...o }
    if (m === metric) delete next[roomId]
    else next[roomId] = m
    return next
  })

  useEffect(() => {
    const memberId = currentMemberId()
    if (memberId === null) return
    // core가 조도를 최신 값 하나만 줄 때, 받은 값을 모아 그래프를 그린다(lib/lightTrail). 탭을 옮겨도 남는다
    const trail = trailFor(memberId)
    let stale = false
    let ctrl: AbortController | null = null
    let poll: ReturnType<typeof setInterval> | undefined

    const load = () => {
      if (ctrl || stale) return
      const mine = new AbortController()
      ctrl = mine
      const timer = setTimeout(() => mine.abort(), REQUEST_TIMEOUT_MS)
      getRoomsEnvironment(mine.signal, memberId)
        .then((r) => { if (stale) return; setData(r.sample ? r.data : withLightTrail(r.data, trail, ENV_RULES.historyMinutes)); setSample(r.sample); setError(null); setReadAt(new Date()); setReads((n) => n + 1) })
        .catch((e) => { if (!stale) setError(adminErrorMessage(e)) })
        .finally(() => { clearTimeout(timer); if (ctrl === mine) ctrl = null })
    }
    // 화면이 안 보일 때(다른 탭·화면 꺼짐)는 읽지 않고, 다시 보이면 바로 읽는다
    const start = () => { clearInterval(poll); load(); poll = setInterval(load, fast ? 1000 : ENV_RULES.pollMs) }
    const onVisible = () => { if (document.visibilityState === 'visible') start(); else clearInterval(poll) }

    start()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      stale = true
      clearInterval(poll)
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [fast])

  const { blocks } = useRoomBlocks()
  const views = useMemo(() => {
    if (!data) return []
    const now = new Date(data.now)
    return data.rooms.map((r) => toRoomView(r, ADMIN_ROOMS.find((c) => c.roomId === r.roomId), now))
  }, [data])

  const now = useMemo(() => (data ? new Date(data.now) : null), [data])
  const { auto } = useAppliances()
  // 오늘 기준(계절·한파·폭염) + 방마다 AI가 배운 속도·목표 온도
  const { rules: climateRules } = useClimateRules()
  // 가짜(시연) 값으로는 실제 기기에 명령을 보내지 않아요. 가짜 기기일 때만 자동 제어를 보여 줘요
  useClimateAuto(views, now, auto && (!sample || APPLIANCE_SOURCE === 'mock'), currentMemberId(), climateRules)
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
  // 맨 위 "지금 확인할 것": 방마다 가장 급한 한 줄. 남색(장치 문제)이 먼저
  const issues = now
    ? views.map((v) => ({ v, list: adviceOf(v) })).filter((x) => x.list.length > 0)
      .sort((a, b) => Number(b.list[0].tone === 'off') - Number(a.list[0].tone === 'off'))
    : []

  // 맨 위 "오디가 처리": 오디가 대신 처리한 방 수, 장치처럼 사람 손이 필요한 방 수
  const handled = issues.filter((x) => !!x.list[0].auto && !x.list[0].hands).length

  // 새로 생긴 일만 기록에 올린다(바로 앞 조회에 없던 것). 분 숫자가 바뀌는 건 같은 일로 본다
  const keyOf = (roomId: number, title: string) => `${roomId}:${title.replace(/\d+/g, '#')}`
  const issueKeys = issues.map(({ v, list }) => keyOf(v.roomId, list[0].title)).join('|')
  const prevKeys = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!now) return
    const add = issues.filter(({ v, list }) => list[0].auto && !prevKeys.current.has(keyOf(v.roomId, list[0].title)))
      .map(({ v, list }) => ({ key: keyOf(v.roomId, list[0].title), at: now, room: v.name, title: list[0].title, auto: list[0].auto! }))
    prevKeys.current = new Set(issues.map(({ v, list }) => keyOf(v.roomId, list[0].title)))
    if (add.length) setHistory((h) => [...add, ...h].slice(0, 30))
    // issues는 issueKeys가 바뀔 때만 다시 본다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKeys])

  // 위 "평균 CO2"와 아래 분석의 평균이 늘 같게 같은 계산을 쓴다
  const avg = useMemo(() => overview(views).avg, [views])

  const tile = (v: RoomView, i: number, big = false) => {
    const list = adviceOf(v)
    return (
      <RoomTile key={v.roomId} i={i} big={big} view={v} tone={cardTone(v, list)} advice={list}
        blocked={blockedOf(v.roomId)} reports={todo.byRoom[v.roomId] ?? 0} now={now} rules={climateRules} onOpen={() => setOpenRoom(v.roomId)}
        metric={own[v.roomId] ?? metric} own={own[v.roomId] !== undefined} onMetric={(m) => pickOwn(v.roomId, m)} />
    )
  }
  // 평면도: 1~4번은 위 한 줄, 큰 방(마지막 방)은 아래 넓게. 방이 하나뿐이면 작은 칸 하나로
  const small = views.length === 1 ? views : views.slice(0, -1)
  const wide = views.length > 1 ? views[views.length - 1] : null
  // 방 목록이 비어 오면 0이 아니라 '모름'으로. 재실을 모르는 방이 있으면 '모두 괜찮음'이라 하지 않는다
  const known = data !== null && views.length > 0
  // 설정에 있는데 응답에 빠진 방도 모르는 방으로 센다
  const missingRooms = ADMIN_ROOMS.filter((r) => !views.some((v) => v.roomId === r.roomId)).length
  const unknownRooms = views.filter((v) => v.presence === 'UNKNOWN').length + missingRooms

  return (
    <section className="admin-now ctl" aria-label="관제실 지금 방 상태">
      <div className="ctl-top">
        <Big label="지금 쓰는 방" value={known ? used : null} of={views.length || ADMIN_ROOMS.length} tone="lead" />
        <Big label="주의" value={known ? warn + off : null} tone={warn ? 'warn' : off ? 'off' : ''} hint={off ? `장치 확인 ${off} 포함` : '환기·시간 넘김·입실 안 함·문'} />
        <Big label="평균 CO2" value={known ? avg : null} unit="ppm" hint={`기준 ${ENV_RULES.co2LimitPpm}`} />
        <Big label="오디가 처리" value={known ? handled : null} unit="건" tone="lead" hint="관리자 할 일 0" />
      </div>

      <div className="ctl-bar">
        <span className="ctl-live"><i aria-hidden="true" />
          {readAt ? <>실시간 · 마지막 조회 <b>{seoulClock(readAt)}</b></> : '불러오는 중…'} · {ENV_RULES.pollMs / 1000}초마다</span>
        {sample && <span className="ctl-sample">가짜 값 · 시연용</span>}
        {sample && (
          <button type="button" className="ctl-fast" aria-pressed={fast} onClick={() => setFast((f) => !f)}>
            {fast ? <>빨리 감는 중 · 시연 시각 <b>{now ? seoulClock(now) : '–'}</b></> : '빨리 감기 ×60'}
          </button>
        )}
      </div>
      {error && <p role="alert" className="adm-msg err">{error}{data ? ` 마지막 값(${readAt ? seoulClock(readAt) : ''})을 보여 주고 있어요.` : ''}</p>}

      <div className="ctl-grid">
        <section className="ctl-floor" aria-label="방 평면도 (누르면 자세히)">
          <div className="ctl-floor-head">
            <h2>방 5개</h2>
            <div className="ctl-metric" role="group" aria-label="모든 방에 보이는 값">
              {TILE_METRICS.map((m) => (
                <button key={m.key} type="button" aria-pressed={metric === m.key} onClick={() => pickCommon(m.key)}>{m.label}</button>
              ))}
            </div>
            {Object.keys(own).length > 0 && <button type="button" className="ctl-metric-reset" onClick={() => setOwn({})}>방마다 고른 것 풀기</button>}
          </div>
          <span className="ctl-scan" aria-hidden="true" />
          {!data && !error && Array.from({ length: 5 }, (_, i) => <div key={i} className={`ctl-tile skel ${i === 4 ? 'big' : ''}`} />)}
          {small.map((v, i) => tile(v, i))}
          {wide && tile(wide, views.length - 1, true)}
        </section>

        <aside className="ctl-side" aria-labelledby="ctl-issues-h">
          <h2 id="ctl-issues-h"><span className={`ctl-pulse ${issues.length ? 'on' : ''}`} aria-hidden="true" />오디가 한 일 <b>{now ? issues.length : '–'}</b></h2>
          {issues.length > 0 && <ActionFeed issues={issues} onOpen={setOpenRoom} sample={sample} checks={reads} />}
          {known && issues.length === 0 && unknownRooms === 0 && (
            <p className="ctl-allok" role="status"><span aria-hidden="true">✓</span> 모든 방이 괜찮아요. 오디가 지켜보고 있어요.</p>
          )}
          {known && issues.length === 0 && unknownRooms > 0 && (
            <p className="ctl-allok" role="status">이상한 방은 없지만, {unknownRooms}개 방은 재실을 알 수 없어요{missingRooms > 0 ? ` (${missingRooms}개 방은 값이 오지 않았어요)` : ''}.</p>
          )}
          {data && views.length === 0 && (
            <p className="ctl-allok" role="status">방 정보를 받지 못했어요. 잠시 뒤 다시 확인해요.</p>
          )}
          {history.length > 0 && (
            <section className="ctl-history" aria-labelledby="ctl-hist-h">
              <h3 id="ctl-hist-h">이 화면을 연 뒤 오디가 처리한 일</h3>
              <ol>
                {history.slice(0, 8).map((x) => (
                  <li key={x.key + x.at.getTime()}><time>{seoulClock(x.at)}</time><span><b>{x.room}</b> {x.auto}</span></li>
                ))}
              </ol>
            </section>
          )}
        </aside>

        {views.length > 0 && <AdminOverview views={views} compact />}
        {/* 방별 센서 그래프·열지도는 접어 둔다. 첫 화면은 대시보드만(11/10 재웅 "정신 사납다") */}
        {views.length > 0 && (
          <details className="ctl-more">
            <summary>방별 센서 자세히</summary>
            <AdminSensorBoard views={views} onOpen={setOpenRoom} />
          </details>
        )}
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
