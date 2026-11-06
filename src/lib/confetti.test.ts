import { describe, expect, it } from 'vitest'
import { spawnConfetti, stepConfetti } from './confetti'

/** 늘 같은 순서로 나오는 가짜 난수 */
function seeded(seed = 1) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

describe('폭죽', () => {
  it('양쪽 아래 모서리에서 반씩 나와 가운데 위로 날아간다', () => {
    // given
    const width = 390, height = 800
    // when
    const pieces = spawnConfetti(width, height, 40, seeded())
    // then
    expect(pieces).toHaveLength(40)
    const left = pieces.filter((p) => p.x < 0)
    const right = pieces.filter((p) => p.x > width)
    expect(left).toHaveLength(20)
    expect(right).toHaveLength(20)
    expect(left.every((p) => p.vx > 0 && p.vy < 0)).toBe(true)
    expect(right.every((p) => p.vx < 0 && p.vy < 0)).toBe(true)
  })

  it('올라갔다가 중력으로 결국 화면 아래로 떨어진다', () => {
    // given
    const height = 800
    const pieces = spawnConfetti(390, height, 20, seeded(7))
    // when: 1초 동안 60번 나눠 움직이면 한 번은 위로 올라간다
    let highest = Infinity
    for (let i = 0; i < 60; i++) {
      stepConfetti(pieces, 1 / 60)
      highest = Math.min(highest, ...pieces.map((p) => p.y))
    }
    expect(highest).toBeLessThan(height / 2)
    // 3초 더 지나면 모두 화면 아래로 사라진다
    for (let i = 0; i < 180; i++) stepConfetti(pieces, 1 / 60)
    // then
    expect(pieces.every((p) => p.y > height)).toBe(true)
  })
})
