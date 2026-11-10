import { useSyncExternalStore } from 'react'
import { api, ApiError } from './client'
import { CLIMATE_RULES } from '../config/appliances'

/**
 * 에어컨·공기청정기 창구 (가짜 단계). 화면은 useAppliances()와 sendApplianceCommand()만 쓴다.
 * 지금은 core API가 없어 이 브라우저 안에서만 켜짐·꺼짐을 바꾼다(실제 기기에 아무것도 가지 않는다).
 * core에 API가 생기면 VITE_APPLIANCE_SOURCE=api 로 빌드해 아래 초안 모양 그대로 보낸다(화면 코드는 그대로).
 * 초안: POST /api/rooms/{roomId}/appliances/{applianceId}/commands → 200 ApplianceState
 *  - 관리자는 아무 방, 학생은 지금 IN_USE인 자기 예약 방만 (아니면 403 NOT_IN_ROOM). 권한 검사는 core가 한다
 */
export type Power = 'ON' | 'OFF'
export type AcMode = 'COOL' | 'HEAT'
export type CommandBy = 'ADMIN' | 'STUDENT' | 'AUTO'

export interface ApplianceCommand {
  power: Power
  mode?: AcMode
  targetC?: number
}

export interface ApplianceState {
  applianceId: string
  power: Power
  mode?: AcMode
  targetC?: number
  changedAt: string | null
  by: CommandBy | null
}

/** 자동 제어가 한 일 (방 상세 창 "자동으로 한 일") */
export interface AutoLogEntry {
  at: string
  roomId: number
  applianceId: string
  text: string
}

export const APPLIANCE_SOURCE: 'api' | 'mock' = import.meta.env.VITE_APPLIANCE_SOURCE === 'api' ? 'api' : 'mock'

interface Store {
  states: Readonly<Record<string, ApplianceState>>
  log: readonly AutoLogEntry[]
  /** 자동 제어 켜짐 (관리자가 지금 화면에서 켠다. 이 브라우저에만 기억) */
  auto: boolean
}

const AUTO_KEY = 'mspace.admin.climateAuto'
function readAuto(): boolean {
  // 10차 회의: 기기는 에이전트가 알아서 켜고 끈다 → 기본은 켜짐(끈 적이 있을 때만 꺼짐)
  try { return localStorage.getItem(AUTO_KEY) !== '0' } catch { return false }
}

let store: Store = { states: {}, log: [], auto: readAuto() }
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }
const get = () => store
function set(next: Store) { store = next; listeners.forEach((fn) => fn()) }

const OFF = (applianceId: string): ApplianceState => ({ applianceId, power: 'OFF', changedAt: null, by: null })

/** 기기 하나의 지금 상태. 받은 적이 없으면 꺼짐 */
export function applianceState(applianceId: string, s: Store = store): ApplianceState {
  return s.states[applianceId] ?? OFF(applianceId)
}

/** 보내는 중인 기기 (같은 기기에 두 번 겹쳐 보내지 않게) */
const pending = new Set<string>()
export function isSending(applianceId: string): boolean {
  return pending.has(applianceId)
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 켜기·끄기 명령. 가짜 단계에서는 잠깐 기다렸다가 이 브라우저 상태만 바꾼다 */
export async function sendApplianceCommand(
  roomId: number,
  applianceId: string,
  cmd: ApplianceCommand,
  by: CommandBy,
  opts: { member?: number | null; now?: Date } = {},
): Promise<ApplianceState> {
  // 이미 보내는 중이면 보내지 않았다고 알린다(부른 쪽이 "켰어요"·자동 기록을 남기지 않게)
  if (pending.has(applianceId)) throw new ApiError(409, 'APPLIANCE_BUSY', '이미 보내는 중이에요')
  pending.add(applianceId)
  set({ ...store }) // 보내는 중 표시
  try {
    let next: ApplianceState
    if (APPLIANCE_SOURCE === 'mock') {
      await wait(CLIMATE_RULES.mockDelayMs)
      next = { applianceId, ...cmd, changedAt: (opts.now ?? new Date()).toISOString(), by }
    } else {
      next = await api<ApplianceState>(`/api/rooms/${roomId}/appliances/${encodeURIComponent(applianceId)}/commands`, {
        method: 'POST', body: JSON.stringify({ ...cmd, by }), member: opts.member,
      })
    }
    set({ ...store, states: { ...store.states, [applianceId]: next } })
    return next
  } finally {
    pending.delete(applianceId)
    set({ ...store })
  }
}

export function setClimateAuto(on: boolean): void {
  try { if (on) localStorage.setItem(AUTO_KEY, '1'); else localStorage.setItem(AUTO_KEY, '0') } catch { /* 기억 못 해도 이 화면에서는 켜진다 */ }
  set({ ...store, auto: on })
}

export function addAutoLog(e: AutoLogEntry): void {
  set({ ...store, log: [e, ...store.log].slice(0, 30) })
}

/** 시연 처음으로 (테스트·발표 다시 시작) */
export function resetAppliances(): void {
  pending.clear()
  set({ states: {}, log: [], auto: store.auto })
}

/** 화면용: 켜짐·꺼짐·보내는 중이 바뀌면 다시 그린다 */
export function useAppliances(): Store {
  return useSyncExternalStore(subscribe, get, get)
}
