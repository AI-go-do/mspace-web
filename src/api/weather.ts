import { useEffect, useState } from 'react'
import { WEATHER_RULES } from '../config/appliances'

/**
 * 바깥 날씨 창구. 에어컨 권유가 계절(여름·겨울)과 한파·폭염을 보고 미리 켜는 시간·기준 온도를 바꾸는 데 쓴다.
 * - 기본(mock): 광주 월평균 기온(평년값, 확인 필요)으로 오늘 값을 만든다. 같은 날 = 같은 값
 * - 시연: 주소에 ?weather=cold(한파) / ?weather=hot(폭염) / ?weather=0(끔)을 붙이면 그 탭에서만 바뀐다
 * - VITE_WEATHER_SOURCE=open-meteo 로 빌드하면 Open-Meteo(무료, 키 없음)에서 조선대 위치 오늘 값을 받는다
 * 기상청 공식 한파·폭염 특보는 API 키가 필요해 core에서 받는 쪽으로 제안(core-API 초안)
 */
export type WeatherAlert = 'COLD_WAVE' | 'HEAT_WAVE' | null

export interface OutdoorWeather {
  /** 지금 바깥 기온 */
  tempC: number
  /** 오늘 최저·최고 */
  minC: number
  maxC: number
  /** 이 달 평년 평균 (광주) */
  normalC: number
  alert: WeatherAlert
  source: 'mock' | 'demo' | 'open-meteo'
}

/** 광주 월평균 기온 평년값(1991–2020, 대략값 · 확인 필요). 1월이 [0] */
export const GWANGJU_NORMAL_C = [1.0, 2.9, 7.6, 13.5, 18.9, 23.0, 26.4, 27.0, 22.6, 16.3, 9.8, 3.4] as const

const KEY = 'mspace:weather'

/** 주소의 ?weather=cold|hot|0 을 이 탭 설정으로 옮긴다. 앱을 열 때 한 번 부른다 */
export function syncWeatherFromUrl(search: string): void {
  const v = new URLSearchParams(search).get('weather')
  if (v === null) return
  try {
    if (v === 'cold' || v === 'hot') sessionStorage.setItem(KEY, v)
    else sessionStorage.removeItem(KEY)
  } catch { /* 저장소를 못 쓰면 시연 날씨를 켜지 않는다 */ }
}

export function demoWeather(): 'cold' | 'hot' | null {
  try {
    const v = sessionStorage.getItem(KEY)
    return v === 'cold' || v === 'hot' ? v : null
  } catch {
    return null
  }
}

/** 기상청 특보 기준을 흉내 낸 판단: 아침 최저 -12°C 이하면 한파, 낮 최고 33°C 이상이면 폭염 */
export function alertOf(minC: number, maxC: number): WeatherAlert {
  if (minC <= WEATHER_RULES.coldWaveMinC) return 'COLD_WAVE'
  if (maxC >= WEATHER_RULES.heatWaveMaxC) return 'HEAT_WAVE'
  return null
}

const seoulMonth = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', month: 'numeric' }).format(d)) - 1
const seoulHour = (d: Date) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: 'numeric', hourCycle: 'h23' }).format(d))

/** 평년값으로 만든 오늘 바깥 날씨 (+ 시연 한파·폭염) */
export function mockWeather(now: Date, demo: 'cold' | 'hot' | null = demoWeather()): OutdoorWeather {
  const normalC = GWANGJU_NORMAL_C[seoulMonth(now)]
  if (demo === 'cold') return { tempC: -9.5, minC: -13.2, maxC: -4.1, normalC, alert: 'COLD_WAVE', source: 'demo' }
  if (demo === 'hot') return { tempC: 34.1, minC: 26.8, maxC: 35.2, normalC, alert: 'HEAT_WAVE', source: 'demo' }
  // 하루 중 새벽 5시가 가장 춥고 오후 3시가 가장 덥다(일교차 8°C로 가정)
  const h = seoulHour(now)
  const minC = normalC - 4
  const maxC = normalC + 4
  const tempC = Math.round((normalC - 4 * Math.cos(((h - 5) / 24) * 2 * Math.PI)) * 10) / 10
  return { tempC, minC, maxC, normalC, alert: alertOf(minC, maxC), source: 'mock' }
}

/** 조선대 IT융합대학 근처 */
const LAT = 35.14
const LON = 126.93

async function openMeteo(now: Date): Promise<OutdoorWeather> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}`
    + '&current=temperature_2m&daily=temperature_2m_min,temperature_2m_max&timezone=Asia%2FSeoul&forecast_days=1'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`날씨 ${res.status}`)
  const body = await res.json()
  const tempC = Number(body?.current?.temperature_2m)
  const minC = Number(body?.daily?.temperature_2m_min?.[0])
  const maxC = Number(body?.daily?.temperature_2m_max?.[0])
  if (![tempC, minC, maxC].every(Number.isFinite)) throw new Error('날씨 응답 모양이 달라요')
  return { tempC, minC, maxC, normalC: GWANGJU_NORMAL_C[seoulMonth(now)], alert: alertOf(minC, maxC), source: 'open-meteo' }
}

const SOURCE = import.meta.env.VITE_WEATHER_SOURCE === 'open-meteo' ? 'open-meteo' : 'mock'

const REFRESH_MS = 30 * 60_000
/** 여러 화면이 같이 써도 30분에 한 번만 받는다 */
let cache: { at: number; w: Promise<OutdoorWeather> } | null = null

export function loadOutdoorWeather(now = new Date()): Promise<OutdoorWeather> {
  if (SOURCE === 'mock' || demoWeather()) return Promise.resolve(mockWeather(now))
  if (!cache || now.getTime() - cache.at >= REFRESH_MS) {
    cache = { at: now.getTime(), w: openMeteo(now).catch(() => { cache = null; return mockWeather(now) }) }
  }
  return cache.w
}

/** 화면용: 30분마다 새로. 못 받으면 평년값으로(권유는 계속 돈다) */
export function useOutdoorWeather(): OutdoorWeather {
  const [w, setW] = useState<OutdoorWeather>(() => mockWeather(new Date()))
  useEffect(() => {
    let alive = true
    const load = () => { loadOutdoorWeather().then((x) => alive && setW(x)) }
    load()
    const t = setInterval(load, REFRESH_MS)
    return () => { alive = false; clearInterval(t) }
  }, [])
  return w
}

/** "바깥 -9.5°C · 한파" */
export function weatherLabel(w: OutdoorWeather): string {
  const a = w.alert === 'COLD_WAVE' ? '한파' : w.alert === 'HEAT_WAVE' ? '폭염' : `평년 ${w.normalC.toFixed(0)}°C`
  return `바깥 ${w.tempC.toFixed(1)}°C · ${a}`
}

/** 시연 한파·폭염일 때 가짜 실내 온도를 옮기는 값 (가짜 단계 전용) */
export function demoIndoorShiftC(demo: 'cold' | 'hot' | null = demoWeather()): number {
  return demo === 'cold' ? WEATHER_RULES.demoColdIndoorShiftC : demo === 'hot' ? WEATHER_RULES.demoHotIndoorShiftC : 0
}
