import type { ApplianceCommand, ApplianceState } from '../api/appliances'
import { ENV_RULES, type EnvRules } from '../config/adminRooms'
import type { OutdoorWeather, WeatherAlert } from '../api/weather'
import { CLIMATE_RULES, ROOM_APPLIANCES, WEATHER_RULES, type ApplianceConfig } from '../config/appliances'
import type { RoomView } from './roomHealth'
import { seoulClock } from './time'

/**
 * 방 공기·온도를 보고 "지금 켜면 좋은 기기" 권유를 만든다. 관리자 방 상세 창·지금 화면, 학생 홈이 같이 쓴다.
 * - CO2: 기준(1000ppm)을 넘을 것 같으면 "숨 막히기 N분 전". CO2는 환기로만 내려가서 창문을 먼저 권하고,
 *   공기청정기는 창문 열 때 들어오는 먼지를 거르는 용도로만 권한다(공기청정기는 CO2를 못 낮춘다)
 * - 온도: 덥거나 추우면 에어컨 냉방·난방. 빈 방이어도 다음 예약이 곧이면 미리 켜기
 * - 빈 방인데 켜져 있으면 끄기 (전기 아끼기)
 * - 계절·한파·폭염(seasonRules): 켤지 말지는 방 안 센서로, 바깥 날씨는 기준 온도와 "얼마나 미리"만 바꾼다
 * 센서가 끊기거나 멈췄으면 값을 믿을 수 없어 아무것도 권하지 않는다
 */
export type TipWhy = 'air' | 'cool' | 'heat' | 'idle'

export interface ClimateTip {
  key: string
  roomId: number
  why: TipWhy
  title: string
  sub: string
  /** 누를 기기와 명령. 없으면 안내만 (예: 공기청정기가 이미 켜져 있어도 창문은 사람이 연다) */
  appliance?: ApplianceConfig
  command?: ApplianceCommand
  button?: string
  /** 자동 제어가 대신 실행해도 되는지 */
  auto: boolean
  urgent: boolean
}

type Rules = typeof CLIMATE_RULES
export type Season = 'winter' | 'summer' | 'mid'

/** 계절·바깥 날씨를 반영한 기준. 없는 칸은 기본값(CLIMATE_RULES·ENV_RULES.hotC)을 쓴다 */
export interface TipRules extends Rules {
  /** 이 온도 이상이면 냉방 (없으면 ENV_RULES.hotC) */
  hotC?: number
  season?: Season
  alert?: WeatherAlert
  outdoor?: OutdoorWeather | null
}

export function seasonOf(normalC: number, w = WEATHER_RULES): Season {
  if (normalC < w.winterNormalBelowC) return 'winter'
  if (normalC >= w.summerNormalFromC) return 'summer'
  return 'mid'
}

/**
 * 오늘 기준: 겨울엔 19°C 아래면 난방 20°C, 여름엔 27°C 이상이면 냉방 26°C.
 * 한파·폭염인 날은 다음 예약 90분 전부터 미리 켠다(보통 60분). 날씨를 모르면 기본값 그대로
 */
export function seasonRules(weather: OutdoorWeather | null, base: Rules = CLIMATE_RULES, w = WEATHER_RULES): TipRules {
  if (!weather) return base
  const season = seasonOf(weather.normalC, w)
  const out: TipRules = { ...base, season, alert: weather.alert, outdoor: weather }
  if (season === 'winter') out.coldC = w.winterColdC
  if (season === 'summer') out.hotC = w.summerHotC
  if (weather.alert) out.precoolMinutes = Math.max(base.precoolMinutes, w.alertPrecoolMinutes)
  return out
}

const alertWord = (a: WeatherAlert | undefined) => (a === 'COLD_WAVE' ? '한파' : a === 'HEAT_WAVE' ? '폭염' : '')

/** 받침 있으면 a, 없으면 b ("에어컨이" / "공기청정기가") */
export function josa(word: string, a: string, b: string): string {
  const c = word.charCodeAt(word.length - 1)
  const has = c >= 0xac00 && c <= 0xd7a3 ? (c - 0xac00) % 28 !== 0 : false
  return word + (has ? a : b)
}

const isOn = (s: ApplianceState, mode?: ApplianceState['mode']) => s.power === 'ON' && (mode === undefined || s.mode === mode)

export function climateTips(
  v: RoomView,
  now: Date,
  state: (applianceId: string) => ApplianceState,
  rules: TipRules = CLIMATE_RULES,
  env: EnvRules = ENV_RULES,
  appliances: readonly ApplianceConfig[] = ROOM_APPLIANCES[v.roomId] ?? [],
): ClimateTip[] {
  const hotC = rules.hotC ?? env.hotC
  const alert = alertWord(rules.alert)
  const o = rules.outdoor
  if (v.flags.offline || v.flags.stuck) return []
  const out: ClimateTip[] = []
  const ac = appliances.find((a) => a.kind === 'ac')
  const purifier = appliances.find((a) => a.kind === 'purifier')
  const occupied = v.presence === 'OCCUPIED'
  const nextMin = v.nextAt ? (new Date(v.nextAt).getTime() - now.getTime()) / 60_000 : null
  const nextSoon = (within: number) => nextMin !== null && nextMin >= 0 && nextMin <= within
  // 예약이 시작됐는데 아직 안 온 사람(조금 늦음)도 곧 올 사람으로 본다. 노쇼 처리 전까지
  const t0 = now.getTime()
  const reservedNow = !!v.current && new Date(v.current.startAt).getTime() <= t0 && t0 < new Date(v.current.endAt).getTime()
  // 지금 쓰는 사람이 있거나 곧 올 사람이 있으면 편하게 만들 이유가 있다
  const someone = occupied || reservedNow || nextSoon(rules.precoolMinutes)
  const nextLabel = v.nextAt ? seoulClock(new Date(v.nextAt)) : ''

  // 1) CO2: 사람이 있을 때만 (빈 방 CO2는 혼자 내려간다)
  if (occupied && v.co2 !== null && (v.flags.co2Over || v.flags.co2Soon)) {
    const pState = purifier ? state(purifier.id) : null
    const title = v.flags.co2Over
      ? `CO2 ${v.co2}ppm, 기준 ${env.co2LimitPpm}을 넘었어요`
      : `숨 막히기 ${v.etaMinutes}분 전`
    const why = v.flags.co2Over ? '졸리고 머리가 아파지기 쉬워요.' : `약 ${v.etaMinutes}분 뒤 CO2가 ${env.co2LimitPpm}ppm을 넘을 것 같아요.`
    const canPurify = !!purifier && !!pState && !isOn(pState)
    out.push({
      key: `${v.roomId}:air`, roomId: v.roomId, why: 'air', title,
      sub: `${why} 창문이나 문을 조금 열어 환기해 주세요.${canPurify ? ' 공기청정기를 같이 켜면 들어오는 먼지를 걸러요.' : ''}`,
      appliance: canPurify ? purifier : undefined,
      command: canPurify ? { power: 'ON' } : undefined,
      button: canPurify ? '공기청정기 켜기' : undefined,
      auto: canPurify,
      urgent: true,
    })
  }

  // 2) 온도: 덥거나 추우면 에어컨 (냉방·난방)
  if (ac && v.temperatureC !== null && someone) {
    const s = state(ac.id)
    const t = v.temperatureC.toFixed(1)
    const ahead = !occupied && nextLabel ? `다음 예약 ${nextLabel} 전에 ` : ''
    // 문이 열려 있으면 냉난방이 새 나가서, 권하되 자동으로 켜지는 않고 문 먼저 닫자고 한다
    const doorOpen = !!v.door?.open
    const doorNote = doorOpen ? (alert ? ` ${alert}라 문이 열려 있으면 금방 ${rules.alert === 'COLD_WAVE' ? '식어요' : '더워져요'}. 문을 먼저 닫아 주세요.` : ' 문이 열려 있어요. 문을 먼저 닫아 주세요.') : ''
    // 한파·폭염인 날 빈 방: "오늘 한파(최저 -13°C)라 미리 데워 둘까요?"
    const alertNote = alert && o ? `오늘 ${alert}(${rules.alert === 'COLD_WAVE' ? `최저 ${o.minC.toFixed(0)}°C` : `최고 ${o.maxC.toFixed(0)}°C`})라 ` : ''
    const lead = !occupied && alertNote ? `${alertNote}${ahead}미리 ` : ahead
    if (v.temperatureC >= hotC && !isOn(s, 'COOL')) {
      // 봄·가을에 바깥이 충분히 시원하면 에어컨보다 창문 (자동으로 켜지 않는다)
      const windowFirst = !!o && rules.season === 'mid' && !rules.alert
        && o.tempC >= WEATHER_RULES.windowMinOutdoorC && o.tempC <= v.temperatureC - WEATHER_RULES.windowCoolerByC
      out.push({
        key: `${v.roomId}:cool`, roomId: v.roomId, why: 'cool',
        title: occupied ? `${t}°C, 더워요` : `빈 방이 ${t}°C까지 올랐어요`,
        sub: windowFirst
          ? `바깥이 ${o!.tempC.toFixed(0)}°C라 창문을 열면 금방 시원해져요. 그래도 더우면 에어컨을 ${rules.coolTargetC}°C 냉방으로 켜요.${doorNote}`
          : `${lead}에어컨을 ${rules.coolTargetC}°C 냉방으로 켜 둘까요?${doorNote}`,
        appliance: ac, command: { power: 'ON', mode: 'COOL', targetC: rules.coolTargetC }, button: '냉방 켜기',
        // 에어컨이 이미 다른 모드로 켜져 있으면 사람이 고른 것일 수 있어 자동으로 바꾸지 않는다(버튼은 남김)
        auto: !doorOpen && !windowFirst && !isOn(s), urgent: occupied,
      })
    } else if (v.temperatureC < rules.coldC && !isOn(s, 'HEAT')) {
      out.push({
        key: `${v.roomId}:heat`, roomId: v.roomId, why: 'heat',
        title: occupied ? `${t}°C, 추워요` : `빈 방이 ${t}°C로 차가워요`,
        sub: `${lead}에어컨을 ${rules.heatTargetC}°C 난방으로 켜 둘까요?${doorNote}`,
        appliance: ac, command: { power: 'ON', mode: 'HEAT', targetC: rules.heatTargetC }, button: '난방 켜기',
        auto: !doorOpen && !isOn(s), urgent: occupied,
      })
    }
  }

  // 3) 빈 방이고 지금 예약도, 곧 올 사람도 없는데 켜져 있으면 끄기. 재실을 모르면(UNKNOWN) 끄지 않는다
  if (v.presence === 'EMPTY' && !reservedNow && !nextSoon(rules.precoolMinutes)) {
    for (const a of appliances) {
      if (!isOn(state(a.id))) continue
      out.push({
        key: `${v.roomId}:idle:${a.id}`, roomId: v.roomId, why: 'idle',
        title: `빈 방인데 ${josa(a.name, '이', '가')} 켜져 있어요`,
        sub: nextLabel ? `다음 예약은 ${nextLabel}이에요. 그때까지 꺼 둘까요?` : '오늘 남은 예약이 없어요. 꺼 둘까요?',
        appliance: a, command: { power: 'OFF' }, button: '끄기', auto: true, urgent: false,
      })
    }
  }
  return out
}

/**
 * 사람이 손으로 바꾼 기기는 자동 제어가 건드리지 않는다. 사람 마음이 자동보다 먼저다.
 * - 학생: 지금 예약 중에 바꿨으면 그 예약이 끝날 때까지 (더위를 많이 타서 난방을 끈 걸 다시 켜지 않게)
 * - 관리자, 또는 예약을 모를 때: manualHoldMinutes(10분) 동안
 * 권유 카드는 계속 보여서, 마음이 바뀌면 직접 누르면 된다
 */
export function manualHold(s: ApplianceState, now: Date, current?: RoomView['current'], rules: Rules = CLIMATE_RULES): boolean {
  if ((s.by !== 'ADMIN' && s.by !== 'STUDENT') || !s.changedAt) return false
  const at = new Date(s.changedAt).getTime()
  const t = now.getTime()
  // 손으로 바꾼 시각(브라우저 시계)이 자동이 보는 시각(마지막 환경 값, 최대 10초 전)보다 뒤일 수 있다. 그건 "방금 바꿈"이다
  if (at >= t) return true
  if (s.by === 'STUDENT' && current) {
    const start = new Date(current.startAt).getTime()
    const end = new Date(current.endAt).getTime()
    if (at >= start && t < end) return true
  }
  return t - at < rules.manualHoldMinutes * 60_000
}

/** 기기 상태 한 줄: "켜짐 · 냉방 26°C · 14:32 자동" */
export function stateLabel(s: ApplianceState): string {
  if (s.power === 'OFF') return s.changedAt ? `꺼짐 · ${seoulClock(new Date(s.changedAt))} ${byLabel(s.by)}` : '꺼짐'
  const mode = s.mode === 'COOL' ? `냉방 ${s.targetC}°C` : s.mode === 'HEAT' ? `난방 ${s.targetC}°C` : ''
  return ['켜짐', mode, s.changedAt ? `${seoulClock(new Date(s.changedAt))} ${byLabel(s.by)}` : ''].filter(Boolean).join(' · ')
}

function byLabel(by: ApplianceState['by']): string {
  return by === 'AUTO' ? '자동' : by === 'ADMIN' ? '관리자' : by === 'STUDENT' ? '학생' : ''
}

/** 자동 제어 기록 한 줄 */
export function autoText(tip: ClimateTip): string {
  const what = tip.appliance?.name ?? ''
  if (tip.command?.power === 'OFF') return `빈 방이라 ${josa(what, '을', '를')} 껐어요`
  if (tip.why === 'air') return `${tip.title} → ${josa(what, '을', '를')} 켰어요`
  if (tip.why === 'cool') return `${tip.title} → 냉방 ${tip.command?.targetC}°C로 켰어요`
  return `${tip.title} → 난방 ${tip.command?.targetC}°C로 켰어요`
}
