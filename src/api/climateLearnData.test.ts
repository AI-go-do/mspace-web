import { afterEach, describe, expect, it } from 'vitest'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const { climateLearning, recordManualOff, resetClimateLearning } = await import('./climateLearnData')

describe('AI 학습 기록 (가짜 단계)', () => {
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
