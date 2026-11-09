import { CLIMATE_RULES, LEARN_RULES } from '../config/appliances'
import type { AcMode } from '../api/appliances'
import type { WeatherAlert } from '../api/weather'

/**
 * 에어컨 AI 학습 (11/9). 규칙이 켤지 말지를 정하고, 학습은 방마다 "얼마나 미리, 몇 도로"만 고친다.
 * 1) 데워지는·식는 속도: 지난 가동 기록(켰을 때 온도 → 끌 때 온도, 걸린 분)에서 방마다 1°C에 몇 분인지 가운데값을 배운다.
 *    다음 예약 전에 목표 온도까지 걸릴 시간 + 여유 10분 전에 켠다. 5번 방처럼 큰 방은 일찍, 작은 방은 늦게
 * 2) 손으로 끈 온도: 학생이 난방을 목표보다 일찍 끈 온도를 모아, 그 가운데값으로 목표를 반 도 단위로 낮춘다(냉방은 올린다)
 * 기록이 3개보다 적으면 배운 값을 쓰지 않는다. 배운 값도 한계(15–120분, 난방 18°C 이상·냉방 28°C 이하) 안에서만 쓴다.
 * 큰 모델 없이 가운데값(이상한 기록 하나에 흔들리지 않음)만 쓴다. 판단 근거를 화면에 그대로 보여 줄 수 있게
 */

/** 가동 기록 하나: 사람 없이 켜 둔 동안 방 온도가 fromC → toC, minutes분 */
export interface RunSample { roomId: number; mode: AcMode; fromC: number; toC: number; minutes: number }

/** 학생이 켜져 있던 에어컨을 손으로 끈 기록 (그때 방 온도) */
export interface ManualOff { roomId: number; mode: AcMode; roomC: number; at: string }

export interface ModeLearning {
  /** 1°C 바꾸는 데 걸리는 분 (가운데값). 기록이 모자라면 null */
  minutesPerC: number | null
  runs: number
  /** 손으로 끈 횟수와 그 온도 가운데값 */
  offs: number
  offMedianC: number | null
  /** 배운 목표 온도. 기본값과 같거나 기록이 모자라면 null */
  targetC: number | null
}

export interface RoomLearning { roomId: number; HEAT: ModeLearning; COOL: ModeLearning }

export function median(xs: readonly number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

type Base = Pick<typeof CLIMATE_RULES, 'heatTargetC' | 'coolTargetC' | 'coldC'>

function learnMode(roomId: number, mode: AcMode, runs: readonly RunSample[], offs: readonly ManualOff[], base: Base, L = LEARN_RULES): ModeLearning {
  // 가동 기록: 맞는 방향으로 충분히 바뀐 것만 (난방이면 올라감, 냉방이면 내려감)
  const rates = runs
    .filter((r) => r.roomId === roomId && r.mode === mode && r.minutes >= L.minRunMinutes)
    .map((r) => ({ d: mode === 'HEAT' ? r.toC - r.fromC : r.fromC - r.toC, m: r.minutes }))
    .filter((r) => r.d >= L.minRunDeltaC)
    .map((r) => r.m / r.d)
  const minutesPerC = rates.length >= L.minSamples ? median(rates) : null

  // 손으로 끈 기록: 난방은 목표보다 낮은 온도에서 끈 것, 냉방은 목표보다 높은 온도에서 끈 것만 "일찍 끔"
  const mine = offs.filter((o) => o.roomId === roomId && o.mode === mode).slice(-L.keepOffs)
  const early = mine.filter((o) => (mode === 'HEAT' ? o.roomC < base.heatTargetC : o.roomC > base.coolTargetC))
  const offMedianC = median(early.map((o) => o.roomC))
  let targetC: number | null = null
  if (early.length >= L.minSamples && offMedianC !== null) {
    const step = L.targetStepC
    if (mode === 'HEAT') {
      // 끈 온도에서 반 도 단위로 내림. 추움 기준(coldC)보다는 반 도 위, 18°C 아래로는 안 감
      const t = Math.max(Math.floor(offMedianC / step) * step, L.minHeatTargetC, base.coldC + step)
      targetC = t < base.heatTargetC ? t : null
    } else {
      const t = Math.min(Math.ceil(offMedianC / step) * step, L.maxCoolTargetC)
      targetC = t > base.coolTargetC ? t : null
    }
  }
  return { minutesPerC, runs: rates.length, offs: early.length, offMedianC, targetC }
}

/** 방 하나에서 배운 것 */
export function learnRoom(roomId: number, runs: readonly RunSample[], offs: readonly ManualOff[], base: Base = CLIMATE_RULES): RoomLearning {
  return { roomId, HEAT: learnMode(roomId, 'HEAT', runs, offs, base), COOL: learnMode(roomId, 'COOL', runs, offs, base) }
}

/** 방 여럿 → { 방 번호: 배운 것 } */
export function learnAll(roomIds: readonly number[], runs: readonly RunSample[], offs: readonly ManualOff[], base: Base = CLIMATE_RULES): Record<number, RoomLearning> {
  return Object.fromEntries(roomIds.map((id) => [id, learnRoom(id, runs, offs, base)]))
}

/**
 * 지금 온도에서 목표까지 걸릴 시간으로 정한 "미리 켜기" 분. 배운 속도가 없으면 null(기본 규칙 그대로)
 * 예: 15°C → 20°C, 1°C에 9분 → 45분 + 여유 10분 = 55분 전부터
 */
export function learnedPrecool(l: ModeLearning, nowC: number, targetC: number, alert?: WeatherAlert, L = LEARN_RULES): number | null {
  if (l.minutesPerC === null) return null
  const need = Math.abs(targetC - nowC) * l.minutesPerC * (alert ? L.alertSlowdown : 1)
  return Math.round(Math.min(L.maxPrecoolMinutes, Math.max(L.minPrecoolMinutes, need + L.marginMinutes)))
}

/** "1°C에 9분" 같은 짧은 말 */
export const rateLabel = (m: number) => `1°C에 약 ${m < 10 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)}분`
