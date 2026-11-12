import { type CSSProperties } from 'react'
import { DeviceRow } from './AdminDevices'
import { RoomOdi } from './AdminRoomOdi'
import type { ClimateAppliance, Decision } from '../api/climate'
import { ENV_RULES } from '../config/adminRooms'
import type { TipRules } from '../lib/climate'
import type { Advice } from '../lib/roomAdvice'
import type { RoomView } from '../lib/roomHealth'
import { rangeOf } from '../lib/chartRange'
import { useCountUp } from '../lib/useCountUp'

/**
 * 관제실 평면도: 방 1~5를 실제 배치처럼 한 판에. 1~4번은 한 줄, 큰 방 5번은 아래 넓게, 맨 아래 복도.
 * 칸 모양만 봐도 상태가 보이게: 사람 있음 = 파랗게 숨쉬기, 주의 = 노란 고리, 확인 필요 = 줄무늬, 빈 방 = 점선.
 * 칸마다 지난 시간 CO2 작은 그래프(점선 = 예측, 노란 점선 = 환기 기준)
 */

export type TileTone = 'ok' | 'warn' | 'off'

/** 방 칸에서 고를 수 있는 값 (11/10 재웅: 공통으로 고르고, 방마다 따로도) */
export type TileMetric = 'co2' | 'temp' | 'hum' | 'light'
export const TILE_METRICS: { key: TileMetric; label: string; unit: string }[] = [
  { key: 'co2', label: 'CO2', unit: 'ppm' },
  { key: 'temp', label: '온도', unit: '°C' },
  { key: 'hum', label: '습도', unit: '%' },
  { key: 'light', label: '조도', unit: '%' },
]
const seriesOf = (v: RoomView, m: TileMetric) => (m === 'co2' ? v.history : m === 'temp' ? v.temps : m === 'hum' ? v.hums : v.lights)
const nowOf = (v: RoomView, m: TileMetric) => (m === 'co2' ? v.co2 : m === 'temp' ? v.temperatureC : m === 'hum' ? v.humidityPct : v.light)
const limitOf = (m: TileMetric) => (m === 'co2' ? ENV_RULES.co2LimitPpm : m === 'temp' ? ENV_RULES.hotC : m === 'hum' ? ENV_RULES.dryPct : ENV_RULES.lightOnPct)
/** 작은 그래프. 지난 값(+ CO2면 예측)을 0~100 칸에 그리고 선 굵기는 화면 크기와 상관없이 같게. 노란 점선 = 기준(온도·습도는 참고) */
export function Spark({ view, metric = 'co2', wide = false }: { view: RoomView; metric?: TileMetric; wide?: boolean }) {
  const limit = limitOf(metric)
  const past = seriesOf(view, metric)
  const ahead = metric === 'co2' ? view.forecast : []
  const total = past.length + ahead.length
  const values = [...past, ...ahead].filter((v): v is number => v !== null)
  if (total < 2 || values.length < 2) return <div className="ctl-spark none" aria-hidden="true" />
  const [lo, hi] = rangeOf(metric, values, limit)
  const x = (i: number) => (i / (total - 1)) * 100
  const y = (v: number) => 40 - ((v - lo) / (hi - lo)) * 40
  const line = (pts: [number, number][]) => pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(2)},${b.toFixed(2)}`).join('')
  // 값이 빈 분에서는 선을 끊는다
  const segs: [number, number][][] = []
  let cur: [number, number][] = []
  past.forEach((v, i) => {
    if (v === null) { if (cur.length) segs.push(cur); cur = []; return }
    cur.push([x(i), y(v)])
  })
  if (cur.length) segs.push(cur)
  const lastIdx = past.length - 1
  const lastVal = past[lastIdx]
  const pred = lastVal !== null && ahead.length ? line([[x(lastIdx), y(lastVal)], ...ahead.map((v, i) => [x(lastIdx + 1 + i), y(v)] as [number, number])]) : ''
  const area = segs.length ? `${line(segs[segs.length - 1])}L${segs[segs.length - 1].at(-1)![0].toFixed(2)},40L${segs[segs.length - 1][0][0].toFixed(2)},40Z` : ''
  const nowX = x(lastIdx)
  // 기준이 그래프 범위 밖이면 기준선·경고 칸을 안 그린다(확대해서 위로 벗어남)
  const showLimit = metric !== 'light' && limit >= lo && limit <= hi
  return (
    <span className="ctl-spark-box">
    <svg className={`ctl-spark ${wide ? 'wide' : ''} m-${metric}`} viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true">
      {/* 경고 쪽 칸: 습도는 기준 아래(건조), 조도는 경고 칸 없음 (AdminOverview와 같게) */}
      {showLimit && (metric === 'hum'
        ? <rect x="0" y={y(limit)} width="100" height={Math.max(0, 40 - y(limit))} className="sp-over" />
        : <rect x="0" y="0" width="100" height={Math.max(0, y(limit))} className="sp-over" />)}
      {showLimit && <line x1="0" x2="100" y1={y(limit)} y2={y(limit)} className="sp-limit" vectorEffect="non-scaling-stroke" />}
      {area && <path d={area} className="sp-area" />}
      {segs.map((s, i) => <path key={i} d={line(s)} className="sp-line" vectorEffect="non-scaling-stroke" pathLength={1} />)}
      {pred && <path d={pred} className="sp-pred" vectorEffect="non-scaling-stroke" />}
      <line x1={nowX} x2={nowX} y1="0" y2="40" className="sp-now" vectorEffect="non-scaling-stroke" />
    </svg>
    {/* 지금 값 점: 실시간 값이 들어올 때마다 위아래로 움직이고 퍼지는 고리로 "살아 있음"을 보여 준다 */}
    {lastVal !== null && <i key={`${lastVal}`} className="sp-dot" style={{ left: `${nowX}%`, top: `${(y(lastVal) / 40) * 100}%` }} aria-hidden="true" />}
    </span>
  )
}

/** 칸 안 큰 숫자 하나 (고른 값) */
function TileValue({ view, metric }: { view: RoomView; metric: TileMetric }) {
  const raw = nowOf(view, metric)
  const shown = useCountUp(raw === null ? null : metric === 'temp' ? Math.round(raw * 10) : Math.round(raw))
  const unit = TILE_METRICS.find((m) => m.key === metric)!.unit
  if (raw === null || shown === null) return <b className="none">–</b>
  const over = metric === 'co2' ? view.flags.co2Over : metric === 'light' ? view.flags.lightLeftOn : false
  return <b className={over ? 'over' : ''}>{metric === 'temp' ? (shown / 10).toFixed(1) : shown}<i>{unit}</i></b>
}

/**
 * 평면도 칸 하나. 칸 전체가 상세 창을 여는 버튼이고(ct-hit), 아래 작은 단추로 이 방만 다른 값을 볼 수 있다.
 * 버튼 안에 버튼을 둘 수 없어서 칸은 div, 여는 버튼은 칸 전체를 덮게 깐다
 */
/** 관제 칸에 더 얹는 실시간 정보(climate가 있을 때만): 인원·입실 시각·기기·오디 판단·열린 판단 수 */
export interface TileLive {
  /** climate가 아는 재실(가상 센서 방은 core 실제 예약·입실). null이면 칸의 재실 센서 값 */
  occupied: boolean | null
  people: number | null
  since: string | null
  devices: ClimateAppliance[]
  /** 이 방의 오디 판단(열린 것 먼저, 없으면 가장 최근) */
  decision: Decision | null
  open: number
  now: number
}

function hm(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso))
}

/** 칸 맨 위 현황: 인원 · 입실 · 퇴실(남은 분) · 알림 */
function NowLine({ view, live, alerts }: { view: RoomView; live: TileLive; alerts: number }) {
  // 재실을 모르면(센서 모름) 0명이 아니라 '?'
  const used: boolean | null = live.occupied ?? (view.presence === 'UNKNOWN' ? null : view.presence === 'OCCUPIED')
  const people = live.people ?? view.current?.people ?? null
  // 실제로 들어온 시각이 먼저, 없으면 예약 시작(이름도 '예약'으로)
  const sinceAt = used ? live.since : null
  const inAt = sinceAt ?? view.current?.startAt ?? null
  const outAt = view.current?.endAt ?? null
  const left = outAt ? Math.round((Date.parse(outAt) - live.now) / 60_000) : null
  return (
    <span className="ct-now">
      <span className={`cn cn-people ${used ? 'on' : ''}`}><b>{used === null ? '?' : used ? (people ?? '?') : 0}</b>명</span>
      <span className="cn"><small>{sinceAt || !inAt ? '입실' : '예약'}</small><b>{inAt ? hm(inAt) : '–'}</b></span>
      <span className="cn"><small>퇴실</small><b>{outAt ? hm(outAt) : '–'}</b>{left !== null && left >= 0 && <em>{left}분 남음</em>}</span>
      <span className={`cn cn-alert ${alerts ? 'on' : ''}`}><small>알림</small><b>{alerts}</b></span>
    </span>
  )
}

/** 네 값 한 줄(CO2·온도·습도·조도). 큰 숫자 하나만 보던 칸에서 나머지도 한눈에 */
function MetricStrip({ view }: { view: RoomView }) {
  const cells: { k: string; v: string | null; warn: boolean }[] = [
    { k: 'CO2', v: view.co2 === null ? null : `${view.co2}`, warn: view.flags.co2Over || view.flags.co2Soon },
    { k: '온도', v: view.temperatureC === null ? null : `${view.temperatureC.toFixed(1)}°`, warn: view.flags.hot },
    { k: '습도', v: view.humidityPct === null ? null : `${Math.round(view.humidityPct)}%`, warn: view.flags.dry },
    { k: '조도', v: view.light === null ? null : `${view.light}%`, warn: view.flags.lightLeftOn },
  ]
  return (
    <span className="ct-strip">
      {cells.map((c) => <span key={c.k} className={c.warn ? 'warn' : ''}><small>{c.k}</small><b>{c.v ?? '–'}</b></span>)}
    </span>
  )
}

export function RoomTile({ view, tone, advice, blocked, reports, i, big = false, metric = 'co2', onMetric, onOpen, live }: {
  view: RoomView
  live?: TileLive
  /** 에어컨·공기청정기 권유 계산용. 아직 값이 없으면 칩을 안 그린다 */
  now?: Date | null
  rules?: TipRules
  tone: TileTone
  advice: Advice[]
  blocked: string | null
  reports: number
  i: number
  big?: boolean
  /** 이 칸에 보이는 값 */
  metric?: TileMetric
  /** 공통 선택과 다르게 이 방만 따로 고른 값인지 */
  own?: boolean
  onMetric?: (m: TileMetric) => void
  onOpen: () => void
}) {
  const used = view.presence === 'OCCUPIED'
  const state = view.tone === 'off' ? 'off' : used ? 'use' : 'empty'
  const line = advice[0]?.title ?? (metric === 'co2' ? view.co2Note : '')
  return (
    <div className={`ctl-tile st-${state} tn-${tone} ${big ? 'big' : ''}`} style={{ '--k': i } as CSSProperties}>
      <button type="button" className="ct-hit" onClick={onOpen}
        aria-label={`${view.name} ${view.status.text}${view.co2 === null ? '' : `, CO2 ${view.co2}ppm`}${view.temperatureC === null ? '' : `, ${view.temperatureC.toFixed(1)}°C`}${view.humidityPct === null ? '' : `, 습도 ${view.humidityPct}%`}${view.light === null ? '' : `, 조도 ${view.light}%`}${advice.length ? `, ${line}` : ''}${reports > 0 ? `, 신고 ${reports}건` : ''}${blocked ? `, ${blocked}` : ''}. 자세히 보기`} />
      {tone === 'warn' && <span className="ctl-ring" aria-hidden="true" />}
      <span className="ct-head">
        <b className="ct-no">{view.roomId}</b>
        <span className="ct-name">{view.name}</span>
        {/* 재실 센서(11/10 재웅): 사람 모양 하나로. 채움=있음, 빈 테두리=없음, 점선=모름. 글자는 옆 상태 표시와 겹쳐 뺐다(구석 글자 줄이기) */}
        <span className={`ct-pres p-${view.presence.toLowerCase()}`}
          title={`재실 센서: ${view.presence === 'OCCUPIED' ? '있음' : view.presence === 'EMPTY' ? '없음' : '모름'}`}>
          <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8z" /></svg>
        </span>
        <span className="ct-tags">
          {reports > 0 && <span className="ct-tag warn">신고 {reports}</span>}
          {blocked && <span className="ct-tag warn">{blocked}</span>}
          <span className={`ct-tag s-${view.status.tone}`}>{view.status.text}</span>
        </span>
      </span>
      {live && <NowLine view={view} live={live} alerts={advice.length + live.open} />}
      <span className="ct-main">
        <span className="ct-co2">
          <TileValue key={metric} view={view} metric={metric} />
          {line && <em className={tone !== 'ok' ? `why ${tone}` : ''}>{line}{advice.length > 1 ? ` 외 ${advice.length - 1}` : ''}</em>}
        </span>
        <Spark view={view} metric={metric} wide={big} />
      </span>
      {live && <MetricStrip view={view} />}
      {live && <DeviceRow devices={live.devices} now={live.now} name={view.name} />}
      {live && <RoomOdi decision={live.decision} />}
      {onMetric && (
        <span className="ct-metric" role="group" aria-label={`${view.name}에서 볼 값`}>
          {TILE_METRICS.map((m) => (
            <button key={m.key} type="button" aria-pressed={metric === m.key} onClick={() => onMetric(m.key)}>{m.label}</button>
          ))}
        </span>
      )}
    </div>
  )
}
