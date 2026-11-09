import { afterEach, describe, expect, it } from 'vitest'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

// 이 탭에 망가진 기록이 남아 있던 상태로 시작한다 (모양이 맞는 것만 학습에 들어가야 한다)
store.set('mspace:demo:climate-offs', JSON.stringify([
  { roomId: 1, mode: 'HEAT', roomC: null, at: 'x' },
  { roomId: 1, mode: 'FAN', roomC: 19, at: 'x' },
  { roomId: 1, mode: 'HEAT', roomC: 19.1, at: 'x' },
]))
const { climateLearning, recordManualOff, resetClimateLearning } = await import('./climateLearnData')

describe('AI 학습 기록 (가짜 단계)', () => {
  it('망가진 기록(온도 없음·모르는 모드)은 버리고 맞는 것만 센다', () => {
    expect(climateLearning()[1].HEAT.offs).toBe(1)
  })
  afterEach(() => resetClimateLearning())

  it('만든 기록으로 방마다 속도를 배운다. 5번 방이 가장 느리다', () => {
    const l = climateLearning()
    expect(l[1].HEAT.minutesPerC).not.toBeNull()
    expect(l[5].HEAT.minutesPerC!).toBeGreaterThan(l[1].HEAT.minutesPerC!)
  })
  it('학생이 끈 기록이 3번 쌓이면 그 방 목표 온도가 바뀐다', () => {
    expect(climateLearning()[3].HEAT.targetC).toBeNull()
    for (const roomC of [19.1, 19.3, 19.2]) recordManualOff({ roomId: 3, mode: 'HEAT', roomC, at: '2026-11-09T14:00:00+09:00' })
    expect(climateLearning()[3].HEAT.targetC).toBe(19)
    expect(JSON.parse(store.get('mspace:demo:climate-offs')!)).toHaveLength(3)
  })
})
