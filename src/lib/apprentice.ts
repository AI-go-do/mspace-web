import type { RoomView } from './roomHealth'
import { ENV_RULES } from '../config/adminRooms'

/**
 * AI 수습사원 규칙 (11/8 최종안, 11/9 회의에서 기준 확정 예정).
 * - 일 종류마다 따로 채점한다. 10번 연속 맞으면 한 단계 올라가고, 틀리거나 되돌리면 바로 내려간다
 * - 레벨 1: 처리안만 올림(사람이 [맞아요]) · 레벨 2: 먼저 하고 아침에 보고 · 레벨 3: 혼자 처리(기록·되돌리기는 남음)
 * - 벌(경고·정지)이 걸린 일은 레벨 1 고정(늘 사람). 학생에게 유리한 일(노쇼 무르기)은 최대 레벨 2
 * 화면과 가짜 저장소가 같이 쓰는 순수 함수만 둔다(시각은 밖에서 받는다)
 */
export const STREAK_TO_LEVEL_UP = 10

export type TaskKind = 'vent' | 'sensor' | 'prep' | 'overtime' | 'unbooked' | 'noshow' | 'report'

export interface Trainee {
  kind: TaskKind
  name: string
  level: 1 | 2 | 3
  maxLevel: 1 | 2 | 3
  /** 지금 이어서 맞힌 횟수 */
  streak: number
  right: number
  total: number
  /** 벌이 걸린 일: 점수와 상관없이 레벨 1 */
  locked: boolean
}

/** AI가 올린 처리안 하나: 무엇을, 왜(근거 3줄 안) */
export interface Proposal {
  id: string
  kind: TaskKind
  roomId: number
  title: string
  plan: string
  reasons: string[]
  createdAt: string
}

/** AI가 먼저 처리한 일 (레벨 2·3). 아침 보고에 쌓이고 되돌릴 수 있다 */
export interface AutoDone extends Proposal {
  level: 2 | 3
  doneAt: string
  undone: boolean
}

export const WRONG_REASONS = ['근거가 부족해요', '상황이 달라요', '너무 세거나 약해요'] as const

/** 처음 상태(가짜 기록). 지난 며칠 채점한 것처럼 숫자를 넣어 둔다 */
export function initialTrainees(): Trainee[] {
  const t = (kind: TaskKind, name: string, level: 1 | 2, maxLevel: 1 | 2 | 3, streak: number, right: number, total: number, locked = false): Trainee =>
    ({ kind, name, level, maxLevel, streak, right, total, locked })
  return [
    t('vent', '미리 환기 안내', 2, 3, 6, 31, 32),
    t('sensor', '센서 고장 알림', 1, 3, 9, 14, 15),
    t('prep', '다음 예약 전 더움 안내', 1, 3, 4, 9, 10),
    t('overtime', '시간 넘김 안내', 1, 3, 5, 11, 13),
    t('unbooked', '예약 없는 사용 기록', 1, 3, 2, 4, 5),
    t('noshow', '억울한 노쇼 무르기', 1, 2, 3, 6, 8),
    t('report', '신고 판정 초안', 1, 1, 0, 17, 19, true),
  ]
}

export type ScoreResult = 'up' | 'down' | 'reset' | 'same'

/** 사람이 [맞아요]/[아니에요]를 눌렀을 때. 새 값을 돌려준다(원본은 안 바꾼다) */
export function score(t: Trainee, ok: boolean): { next: Trainee; result: ScoreResult } {
  const next = { ...t, total: t.total + 1 }
  if (ok) {
    next.right++
    if (t.locked || t.level >= t.maxLevel) return { next, result: 'same' }
    next.streak++
    if (next.streak >= STREAK_TO_LEVEL_UP) {
      next.level = (t.level + 1) as Trainee['level']
      next.streak = 0
      return { next, result: 'up' }
    }
    return { next, result: 'same' }
  }
  next.streak = 0
  if (t.level > 1) {
    next.level = (t.level - 1) as Trainee['level']
    return { next, result: 'down' }
  }
  return { next, result: 'reset' }
}

/** AI가 먼저 처리한 일을 사람이 되돌렸을 때: 틀린 것과 같이 센다 */
export function undoScore(t: Trainee): { next: Trainee; result: ScoreResult } {
  return score(t, false)
}

/** 이 종류를 AI가 먼저 처리해도 되는지 */
export function actsAlone(t: Trainee): boolean {
  return !t.locked && t.level >= 2
}

/** 인사 카드 아래 한 줄 */
export function traineeNote(t: Trainee): string {
  if (t.locked) return '벌이 걸린 일 · 레벨 1 고정'
  if (t.level >= t.maxLevel) return `가장 높은 단계${t.maxLevel < 3 ? ' (학생에게 유리한 일은 레벨 2까지)' : ''}`
  return `연속 맞음 ${t.streak}/${STREAK_TO_LEVEL_UP} · 레벨 ${t.level + 1}까지 ${STREAK_TO_LEVEL_UP - t.streak}번`
}

/** 같은 방·같은 일은 상황이 이어지는 동안 한 번만 올린다 */
export const proposalKey = (kind: TaskKind, roomId: number) => `${kind}:${roomId}`

/**
 * "지금" 탭 방 상태에서 처리안 만들기 (가짜 값 단계에서 AI 대신. 실제는 젯슨 이상 탐지 → core → 비서 문장).
 * 근거에는 방 안 사람 수(Q-17 결정 전)와 학생 이름·학번을 넣지 않는다
 */
export function proposalsFromRooms(views: RoomView[], now: Date): Omit<Proposal, 'id'>[] {
  const at = now.toISOString()
  const out: Omit<Proposal, 'id'>[] = []
  for (const v of views) {
    const f = v.flags
    if (f.stuck) {
      out.push({ kind: 'sensor', roomId: v.roomId, createdAt: at, title: `CO2 값이 ${v.sameForMinutes}분째 똑같아요`,
        plan: '이 방 환기 알림을 멈추고 장치 담당에게 확인을 부탁해요',
        reasons: [`CO2 ${v.co2}ppm에서 ${v.sameForMinutes}분째 그대로`, '사람이 없어도 값은 조금씩 흔들려야 해요', '신호는 계속 들어와요(끊긴 게 아니라 값이 멈춤)'] })
      continue
    }
    if (f.offline) continue
    if (f.co2Soon && v.etaMinutes !== null) {
      out.push({ kind: 'vent', roomId: v.roomId, createdAt: at, title: `${v.etaMinutes}분 뒤 CO2가 1000ppm을 넘을 것 같아요`,
        plan: '대표자에게 "10분 안에 창문을 잠깐 열어 주세요"를 미리 보내요',
        reasons: [`지금 ${v.co2}ppm`, v.forecastFrom === 'model' ? '젯슨 15분 예측' : '최근 10분 추세', v.slot] })
    }
    if (f.overtime) {
      out.push({ kind: 'overtime', roomId: v.roomId, createdAt: at, title: `예약이 끝난 지 ${v.overtimeMinutes}분인데 재실이에요`,
        plan: '대표자에게 "다음 예약이 없으면 연장하고, 아니면 정리해 주세요" 안내를 보내요',
        reasons: [v.slot, `끝난 뒤 ${v.overtimeMinutes}분 동안 재실 센서 '있음'`] })
    }
    if (f.hot && v.status.tone === 'empty' && v.nextAt !== null) {
      out.push({ kind: 'prep', roomId: v.roomId, createdAt: at, title: `${v.slot.replace('다음 ', '')} 예약 전에 방이 ${v.temperatureC?.toFixed(1)}°C예요`,
        plan: '다음 팀 대표자에게 "들어가면 에어컨부터 켜 주세요" 안내를 보내요',
        reasons: ['빈 방 온도가 계속 올라요', `더움 기준 ${ENV_RULES.hotC}°C 넘음`] })
    }
    if (f.unbooked) {
      out.push({ kind: 'unbooked', roomId: v.roomId, createdAt: at, title: '예약이 없는데 CO2가 오르고 있어요',
        plan: '교학팀 아침 보고에 "예약 없이 사용 의심"으로 남겨요 (학생에게 벌은 주지 않아요)',
        reasons: ['지금 걸린 예약 없음', `CO2 ${v.co2}ppm, 최근 10분 계속 오름`] })
    }
  }
  return out
}
