import { useEffect, useMemo, useRef, useState } from 'react'
import { APPLIANCE_SOURCE, applianceState, isSending, sendApplianceCommand, useAppliances, type ApplianceCommand, type CommandBy } from '../api/appliances'
import { ROOM_APPLIANCES, type ApplianceConfig } from '../config/appliances'
import { useOutdoorWeather, weatherLabel, type OutdoorWeather } from '../api/weather'
import { ENV_RULES } from '../config/adminRooms'
import { climateTips, josa, roomTargets, seasonRules, stateLabel, type ClimateTip, type TipRules } from '../lib/climate'
import { recordManualOff, useClimateLearning } from '../api/climateLearnData'
import { rateLabel } from '../lib/climateLearn'
import type { RoomView } from '../lib/roomHealth'
import './Climate.css'

function Icon({ kind, on }: { kind: ApplianceConfig['kind']; on: boolean }) {
  if (kind === 'ac') {
    return (
      <svg className={`cl-ico ${on ? 'spin-slow' : ''}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 2v20M4.9 6l14.2 12M19.1 6 4.9 18" /><path d="m9 4 3 2 3-2M9 20l3-2 3 2" />
      </svg>
    )
  }
  return (
    <svg className={`cl-ico ${on ? 'spin' : ''}`} width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="2" /><path d="M12 10c0-4 1-7 4-7 2 0 2 3 0 5M14 12c4 0 7 1 7 4 0 2-3 2-5 0M12 14c0 4-1 7-4 7-2 0-2-3 0-5M10 12c-4 0-7-1-7-4 0-2 3-2 5 0" />
    </svg>
  )
}

/** "바깥 -9.5°C · 한파" (한파는 파랑, 폭염은 빨강) */
export function WeatherChip({ w }: { w: OutdoorWeather }) {
  const tone = w.alert === 'COLD_WAVE' ? 'cold' : w.alert === 'HEAT_WAVE' ? 'hot' : ''
  const title = `오늘 최저 ${w.minC.toFixed(1)}°C · 최고 ${w.maxC.toFixed(1)}°C · 이 달 평년 ${w.normalC.toFixed(1)}°C${w.source === 'demo' ? ' (시연 날씨)' : w.source === 'mock' ? ' (평년값으로 만든 가짜 날씨)' : ''}`
  return <span className={`cl-weather ${tone}`} title={title}>{weatherLabel(w)}</span>
}

/** 오늘 기준(계절·한파·폭염) + 방마다 배운 값. 관리자 지금 화면·방 상세·학생 카드가 같이 쓴다 */
export function useClimateRules(): { weather: OutdoorWeather; rules: TipRules } {
  const weather = useOutdoorWeather()
  const learned = useClimateLearning()
  const rules = useMemo<TipRules>(() => ({ ...seasonRules(weather), learned }), [weather, learned])
  return { weather, rules }
}

/** 방 상세 "AI가 배운 것": 데워지는·식는 속도와 고친 목표 온도. 배운 게 없으면 안 보인다 */
function LearnedNote({ rules, roomId }: { rules: TipRules; roomId: number }) {
  const l = rules.learned?.[roomId]
  if (!l) return null
  const t = roomTargets(rules, roomId)
  const lines: string[] = []
  if (l.HEAT.minutesPerC !== null) lines.push(`난방 ${rateLabel(l.HEAT.minutesPerC)} · 냉방 ${l.COOL.minutesPerC !== null ? rateLabel(l.COOL.minutesPerC) : '기록 모자람'} (지난 가동 ${l.HEAT.runs + l.COOL.runs}번)`)
  if (l.HEAT.targetC !== null && l.HEAT.offMedianC !== null) lines.push(`학생들이 난방을 ${l.HEAT.offMedianC.toFixed(1)}°C쯤에서 ${l.HEAT.offs}번 꺼서 이 방은 ${t.heatTargetC}°C로 맞춰요`)
  if (l.COOL.targetC !== null && l.COOL.offMedianC !== null) lines.push(`학생들이 냉방을 ${l.COOL.offMedianC.toFixed(1)}°C쯤에서 ${l.COOL.offs}번 꺼서 이 방은 ${t.coolTargetC}°C로 맞춰요`)
  if (!lines.length) return null
  return (
    <div className="cl-learn">
      <b><span className="cl-ai">AI</span>이 방에서 배운 것</b>
      <ul>{lines.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  )
}

/** 누른 뒤 잠깐 "켜졌어요"를 보여 준다 */
function useFlash(): [string | null, (s: string) => void] {
  const [msg, setMsg] = useState<string | null>(null)
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  return [msg, (s) => { setMsg(s); clearTimeout(t.current); t.current = setTimeout(() => setMsg(null), 2400) }]
}

/**
 * 방 하나의 에어컨·공기청정기. 위에는 "지금 켜면 좋은 것" 권유, 아래에는 기기마다 켜기·끄기.
 * 관리자 방 상세 창과 학생 홈 카드가 같이 쓴다. 가짜 단계라 누르면 이 화면 안에서만 켜진다
 */
export function ClimatePanel({ view, now, by, member, compact, locked = false }: {
  view: RoomView
  now: Date
  by: CommandBy
  member?: number | null
  compact?: boolean
  /** 가짜(시연) 값을 보고 실제 기기에 명령을 보내지 않게 단추를 막는다 */
  locked?: boolean
}) {
  const store = useAppliances()
  const [flash, setFlash] = useFlash()
  const [error, setError] = useState<string | null>(null)
  const appliances = ROOM_APPLIANCES[view.roomId] ?? []
  const get = (id: string) => applianceState(id, store)
  const { weather, rules } = useClimateRules()
  const targets = roomTargets(rules, view.roomId)
  const tips = climateTips(view, now, get, rules)

  const send = (a: ApplianceConfig, cmd: ApplianceCommand) => {
    setError(null)
    if (locked) { setError('시연 값이라 실제 기기는 움직이지 않아요.'); return }
    // 학생이 켜져 있던 에어컨을 끄면 그때 방 온도를 배운다(자주 일찍 끄는 방은 목표를 반 도씩 고친다). 끄기가 성공했을 때만
    const prev = get(a.id)
    const off = by === 'STUDENT' && a.kind === 'ac' && cmd.power === 'OFF' && prev.power === 'ON' && prev.mode && view.temperatureC !== null
      ? { roomId: view.roomId, mode: prev.mode, roomC: view.temperatureC, at: new Date().toISOString() }
      : null
    sendApplianceCommand(view.roomId, a.id, cmd, by, { member, now: new Date() })
      .then(() => { if (off) recordManualOff(off) })
      .then(() => setFlash(cmd.power === 'OFF' ? `${a.name} 껐어요` : cmd.mode === 'HEAT' ? `${a.name} 난방으로 켰어요` : cmd.mode === 'COOL' ? `${a.name} 냉방으로 켰어요` : `${a.name} 켰어요`))
      .catch((e: Error) => setError(`${josa(a.name, '을', '를')} 바꾸지 못했어요. ${e.message}`))
  }
  // 손으로 켤 때 에어컨 모드: 추우면 난방, 아니면 냉방
  const manualOn = (a: ApplianceConfig): ApplianceCommand => {
    if (a.kind !== 'ac') return { power: 'ON' }
    // 겨울(난방철)엔 방이 덥지 않으면 난방, 다른 철엔 방이 추울 때만 난방
    const t = view.temperatureC
    const winter = rules.season === 'winter'
    const cold = t === null ? winter : t < rules.coldC || (winter && t < (rules.hotC ?? ENV_RULES.hotC))
    return cold ? { power: 'ON', mode: 'HEAT', targetC: targets.heatTargetC } : { power: 'ON', mode: 'COOL', targetC: targets.coolTargetC }
  }

  if (!appliances.length) return null
  return (
    <div className={`cl ${compact ? 'compact' : ''}`}>
      {!compact && <WeatherChip w={weather} />}
      {!compact && <LearnedNote rules={rules} roomId={view.roomId} />}
      {tips.length > 0 && (
        <ul className="cl-tips">
          {tips.map((t: ClimateTip) => {
            const busy = locked || (t.appliance ? isSending(t.appliance.id) : false)
            return (
              <li key={t.key} className={`cl-tip w-${t.why} ${t.urgent && !(by === 'ADMIN' && (t.why === 'cool' || t.why === 'heat')) ? 'urgent' : ''}`}>
                <span className="cl-tip-text">
                  <b>{t.title}</b>
                  <span>{t.sub}</span>
                  {t.ai && <span className="cl-tip-ai"><i className="cl-ai">AI</i>{t.ai}</span>}
                </span>
                {t.appliance && t.command && t.button && (
                  <button type="button" className="cl-go" disabled={busy} onClick={() => send(t.appliance!, t.command!)}>
                    {busy ? <><i className="cl-spin" aria-hidden="true" />보내는 중</> : t.button}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <ul className="cl-devs" aria-label="기기">
        {appliances.map((a) => {
          const s = get(a.id)
          const on = s.power === 'ON'
          const busy = locked || isSending(a.id)
          return (
            <li key={a.id} className={`cl-dev ${on ? 'on' : ''} ${busy ? 'busy' : ''}`}>
              <span className="cl-dev-ico"><Icon kind={a.kind} on={on} /></span>
              <span className="cl-dev-text">
                <b>{a.name}</b>
                <small>{busy ? (a.via === 'ir' ? '리모컨 신호 보내는 중…' : '플러그에 보내는 중…') : stateLabel(s)}</small>
              </span>
              <button type="button" className={`cl-sw ${on ? 'on' : ''}`} role="switch" aria-checked={on} disabled={busy}
                aria-label={`${a.name} ${on ? '끄기' : '켜기'}`} onClick={() => send(a, on ? { power: 'OFF' } : manualOn(a))}>
                <i aria-hidden="true" />
              </button>
              {/* 에어컨은 켜진 뒤 냉방·난방을 바로 바꿀 수 있다 (11월처럼 추운 날은 난방) */}
              {a.kind === 'ac' && on && (
                <span className="cl-mode" role="group" aria-label="에어컨 모드">
                  {(['COOL', 'HEAT'] as const).map((m) => (
                    <button key={m} type="button" className={s.mode === m ? 'on' : ''} aria-pressed={s.mode === m} disabled={busy || s.mode === m}
                      onClick={() => send(a, m === 'COOL'
                        ? { power: 'ON', mode: 'COOL', targetC: targets.coolTargetC }
                        : { power: 'ON', mode: 'HEAT', targetC: targets.heatTargetC })}>
                      {m === 'COOL' ? `냉방 ${targets.coolTargetC}°C` : `난방 ${targets.heatTargetC}°C`}
                    </button>
                  ))}
                </span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="cl-foot" role="status">
        {error ? <span className="cl-err">{error}</span>
          : flash ? <span className="cl-ok">✓ {flash}</span>
            : APPLIANCE_SOURCE === 'mock' ? '시연 화면이에요' : '에어컨은 적외선 리모컨, 공기청정기는 스마트 플러그로 켜요.'}
      </p>
    </div>
  )
}

/**
 * 학생 홈 "내 방 공기" 카드 (예시 화면 ?demo=1). 지금 쓰는 방의 CO2를 크게, 넘기 전이면 "숨 막히기 N분 전".
 * 학생은 자기가 쓰는 방만 켜고 끌 수 있다(실제 단계에서 core가 IN_USE 예약으로 확인)
 */
export function ClimateCard({ view, now, top }: { view: RoomView; now: Date; top?: boolean }) {
  const { flags } = view
  const weather = useOutdoorWeather()
  const eta = flags.co2Soon && view.etaMinutes !== null ? view.etaMinutes : null
  const level = flags.co2Over ? 'over' : eta !== null ? 'soon' : 'ok'
  const after = view.forecast.length ? view.forecast[view.forecast.length - 1] : null
  return (
    <section className={`card cl-card l-${level} ${top ? 'cl-top' : ''}`} aria-labelledby="cl-title">
      <header className="cl-card-head">
        <span className="cl-eyebrow">내 방 공기 · {view.name}</span>
        {level === 'soon' && <span className="cl-badge">숨 막히기 {eta}분 전</span>}
        {level === 'over' && <span className="cl-badge">환기 필요</span>}
      </header>
      <div className="cl-card-now">
        <div className="cl-big">
          <small>CO2</small>
          <b id="cl-title">{view.co2 ?? '–'}<i>ppm</i></b>
          <em>{after !== null ? `${ENV_RULES.forecastMinutes}분 뒤 약 ${after}` : '예측 없음'} · 기준 {ENV_RULES.co2LimitPpm}</em>
        </div>
        <div className="cl-gauge" aria-hidden="true">
          <i style={{ width: `${Math.min(100, ((view.co2 ?? 0) / (ENV_RULES.co2LimitPpm * 1.2)) * 100)}%` }} />
          <span style={{ left: `${(1 / 1.2) * 100}%` }} />
        </div>
        <div className="cl-small">
          <span><small>온도</small><b>{view.temperatureC?.toFixed(1) ?? '–'}°C</b></span>
          <span><small>습도</small><b>{view.humidityPct ?? '–'}%</b></span>
          <WeatherChip w={weather} />
        </div>
      </div>
      <ClimatePanel view={view} now={now} by="STUDENT" compact />
    </section>
  )
}
