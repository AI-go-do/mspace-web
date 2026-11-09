import { useSyncExternalStore } from 'react'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { LEARN_RULES } from '../config/appliances'
import { learnAll, type ManualOff, type RoomLearning, type RunSample } from '../lib/climateLearn'
import { APPLIANCE_SOURCE } from './appliances'

/**
 * AI 학습에 쓰는 기록 (가짜 단계). 실제로는 core가 센서 값과 기기 명령 기록으로 가동 기록·손으로 끈 기록을 만들어 준다
 * (core-API-초안.md "학습 기록"). 지금은 방마다 지난 가동 5번을 만든 값으로 두고, 이 탭에서 학생이 끈 것은 sessionStorage에 더한다.
 * VITE_APPLIANCE_SOURCE=api면 core가 기록을 주기 전까지 아무것도 배우지 않는다(기본 규칙 그대로)
 */

/** 방마다 1°C 바꾸는 데 걸린 분(만든 값). 5번 방은 크고(5–8명) 창이 넓어 느리다 */
const MOCK_MIN_PER_C: Record<number, { HEAT: number; COOL: number }> = {
  1: { HEAT: 8, COOL: 10 }, 2: { HEAT: 9, COOL: 11 }, 3: { HEAT: 8.5, COOL: 10 }, 4: { HEAT: 11, COOL: 13 }, 5: { HEAT: 16, COOL: 19 },
}
const JITTER = [-0.08, 0.05, 0, 0.1, -0.04]

export const MOCK_RUNS: readonly RunSample[] = Object.entries(MOCK_MIN_PER_C).flatMap(([id, r]) => JITTER.flatMap((j, i) => {
  const roomId = Number(id)
  const heatFrom = 14 + i * 0.7
  const coolFrom = 30 - i * 0.6
  const heat: RunSample = { roomId, mode: 'HEAT', fromC: heatFrom, toC: 20, minutes: Math.round((20 - heatFrom) * r.HEAT * (1 + j)) }
  const cool: RunSample = { roomId, mode: 'COOL', fromC: coolFrom, toC: 26, minutes: Math.round((coolFrom - 26) * r.COOL * (1 + j)) }
  return [heat, cool]
}))

/** 만든 값: 2번 방은 난방을 20°C 전에 자주 끄고(19.5–19.9°C), 4번 방은 냉방을 26°C 전에 자주 끈다(26.6–26.8°C) */
export const MOCK_OFFS: readonly ManualOff[] = [
  ...[19.6, 19.8, 19.5, 19.9].map((roomC, i) => ({ roomId: 2, mode: 'HEAT' as const, roomC, at: `2026-11-0${i + 2}T15:00:00+09:00` })),
  ...[26.6, 26.8, 26.7].map((roomC, i) => ({ roomId: 4, mode: 'COOL' as const, roomC, at: `2026-09-0${i + 2}T15:00:00+09:00` })),
]

const KEY = 'mspace:demo:climate-offs'

function readOffs(): ManualOff[] {
  try {
    const raw = sessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? (list as ManualOff[]) : []
  } catch { return [] }
}

let offs: ManualOff[] = readOffs()
let cache: Record<number, RoomLearning> | null = null
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }

/** 학생이 켜져 있던 에어컨을 손으로 껐을 때 (그때 방 온도와 함께). 다음 계산부터 목표 온도에 반영된다 */
export function recordManualOff(o: ManualOff): void {
  offs = [...offs, o].slice(-LEARN_RULES.keepOffs * 10)
  try { sessionStorage.setItem(KEY, JSON.stringify(offs)) } catch { /* 이 화면에서만 기억 */ }
  cache = null
  listeners.forEach((fn) => fn())
}

/** 지금까지 배운 것 (방마다) */
export function climateLearning(): Record<number, RoomLearning> {
  if (APPLIANCE_SOURCE === 'api') return {}
  cache ??= learnAll(ADMIN_ROOMS.map((r) => r.roomId), MOCK_RUNS, [...MOCK_OFFS, ...offs])
  return cache
}

export function useClimateLearning(): Record<number, RoomLearning> {
  return useSyncExternalStore(subscribe, climateLearning)
}

/** 시험용: 이 탭에서 쌓은 기록 지우기 */
export function resetClimateLearning(): void {
  offs = []
  cache = null
  try { sessionStorage.removeItem(KEY) } catch { /* 없음 */ }
  listeners.forEach((fn) => fn())
}
