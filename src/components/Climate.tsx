import { useEffect, useRef, useState } from 'react'
import { APPLIANCE_SOURCE, applianceState, isSending, sendApplianceCommand, useAppliances, type ApplianceCommand, type CommandBy } from '../api/appliances'
import { CLIMATE_RULES, ROOM_APPLIANCES, type ApplianceConfig } from '../config/appliances'
import { ENV_RULES } from '../config/adminRooms'
import { climateTips, josa, stateLabel, type ClimateTip } from '../lib/climate'
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
export function ClimatePanel({ view, now, by, member, compact }: {
  view: RoomView
  now: Date
  by: CommandBy
  member?: number | null
  compact?: boolean
}) {
  const store = useAppliances()
  const [flash, setFlash] = useFlash()
  const [error, setError] = useState<string | null>(null)
  const appliances = ROOM_APPLIANCES[view.roomId] ?? []
  const get = (id: string) => applianceState(id, store)
  const tips = climateTips(view, now, get)

  const send = (a: ApplianceConfig, cmd: ApplianceCommand) => {
    setError(null)
    sendApplianceCommand(view.roomId, a.id, cmd, by, { member, now: new Date() })
      .then(() => setFlash(cmd.power === 'OFF' ? `${a.name} 껐어요` : cmd.mode === 'HEAT' ? `${a.name} 난방으로 켰어요` : cmd.mode === 'COOL' ? `${a.name} 냉방으로 켰어요` : `${a.name} 켰어요`))
      .catch((e: Error) => setError(`${josa(a.name, '을', '를')} 바꾸지 못했어요. ${e.message}`))
  }
  // 손으로 켤 때 에어컨 모드: 추우면 난방, 아니면 냉방
  const manualOn = (a: ApplianceConfig): ApplianceCommand => {
    if (a.kind !== 'ac') return { power: 'ON' }
    const cold = view.temperatureC !== null && view.temperatureC < CLIMATE_RULES.coldC
    return cold ? { power: 'ON', mode: 'HEAT', targetC: CLIMATE_RULES.heatTargetC } : { power: 'ON', mode: 'COOL', targetC: CLIMATE_RULES.coolTargetC }
  }

  if (!appliances.length) return null
  return (
    <div className={`cl ${compact ? 'compact' : ''}`}>
      {tips.length > 0 && (
        <ul className="cl-tips">
          {tips.map((t: ClimateTip) => {
            const busy = t.appliance ? isSending(t.appliance.id) : false
            return (
              <li key={t.key} className={`cl-tip w-${t.why} ${t.urgent ? 'urgent' : ''}`}>
                <span className="cl-tip-text">
                  <b>{t.title}</b>
                  <span>{t.sub}</span>
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
          const busy = isSending(a.id)
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
                        ? { power: 'ON', mode: 'COOL', targetC: CLIMATE_RULES.coolTargetC }
                        : { power: 'ON', mode: 'HEAT', targetC: CLIMATE_RULES.heatTargetC })}>
                      {m === 'COOL' ? `냉방 ${CLIMATE_RULES.coolTargetC}°C` : `난방 ${CLIMATE_RULES.heatTargetC}°C`}
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
            : APPLIANCE_SOURCE === 'mock' ? '시연: 화면에서만 켜져요. 실제 기기에는 아무 신호도 가지 않아요.' : '에어컨은 적외선 리모컨, 공기청정기는 스마트 플러그로 켜요.'}
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
        </div>
      </div>
      <ClimatePanel view={view} now={now} by="STUDENT" compact />
    </section>
  )
}
