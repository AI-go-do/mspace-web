import { describe, expect, it } from 'vitest'
import { ENV_RULES } from '../config/adminRooms'
import { runAdviceEval } from './adviceEval'

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

describe('오디 판단 채점', () => {
  it('규칙 판마다 같은 시나리오로 점수를 낸다', () => {
    const rounds = [
      // 판마다 숫자 하나만 바꾼다. 앞 판에서 채택한 값은 이어 받는다
      { name: 'v1 처음 규칙', rules: { ...ENV_RULES, co2MedianOf: 1, presenceHoldMinutes: 1, co2AlertWhenEmpty: 1 } },
      { name: 'v2 CO2 2분 이어질 때만', rules: { ...ENV_RULES, co2MedianOf: 1, co2OverHoldMinutes: 2, presenceHoldMinutes: 1, co2AlertWhenEmpty: 1 } },
      { name: 'v3 CO2 3분 가운데값', rules: { ...ENV_RULES, presenceHoldMinutes: 1, co2AlertWhenEmpty: 1 } },
      { name: 'v4 + 재실 3분 이어질 때만 불이익', rules: { ...ENV_RULES, co2AlertWhenEmpty: 1 } },
      { name: 'v5 + 빈 방 CO2는 안 알림(채택)', rules: ENV_RULES },
    ]
    const rows = rounds.map((r) => ({ ...r, s: runAdviceEval(r.rules) }))
    // 판별 결과를 표로 남긴다(npx vitest run src/lib/adviceEval.test.ts로 볼 수 있음)
    console.log(rows.map((r) => `${r.name} | 완전 일치 ${pct(r.s.exact)} | 나설 때 나섬 ${pct(r.s.recall)} | 헛나섬 ${r.s.falseAlarms} | 심각 ${r.s.severe}\n`
      + r.s.cases.filter((c) => !c.ok).map((c) => `   ✗ ${c.id} ${c.name}: 놓침 [${c.missed}] 헛나섬 [${c.extra}]`).join('\n')).join('\n'))
    // 판이 갈수록 나빠지지 않는다
    for (let i = 1; i < rows.length; i++) expect(rows[i].s.exact).toBeGreaterThanOrEqual(rows[i - 1].s.exact)
    // 채택한 규칙(지금 값): 다 맞고, 학생 불이익으로 이어지는 헛나섬 0
    const adopted = rows[rows.length - 1].s
    expect(adopted.severe).toBe(0)
    expect(adopted.exact).toBe(1)
  })
})
