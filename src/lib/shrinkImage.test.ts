import { describe, expect, it } from 'vitest'
import { encodeUnder, fitSize, MAX_UPLOAD_BYTES } from './shrinkImage'

describe('캡처 줄이기 (학교 nginx 1MB 한도)', () => {
  it('긴 변을 1600에 맞추고, 작은 사진은 그대로 둔다', () => {
    expect(fitSize(3200, 1800)).toEqual({ width: 1600, height: 900 })
    expect(fitSize(1170, 2532)).toEqual({ width: 739, height: 1600 })
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 })
  })

  it('화질을 0.85부터 낮추다가 900KB 아래가 되면 멈춘다', async () => {
    const tried: number[] = []
    const blob = await encodeUnder(async (_s, q) => {
      tried.push(q)
      return new Blob([new Uint8Array(q > 0.7 ? MAX_UPLOAD_BYTES + 1 : 1000)])
    })
    expect(tried).toEqual([0.85, 0.75, 0.65])
    expect(blob?.size).toBe(1000)
  })

  it('화질을 다 낮춰도 크면 크기를 줄이고, 끝까지 크면 null', async () => {
    const scales = new Set<number>()
    const big = await encodeUnder(async (s) => {
      scales.add(s)
      return new Blob([new Uint8Array(MAX_UPLOAD_BYTES + 1)])
    })
    expect([...scales]).toEqual([1, 0.75, 0.5])
    expect(big).toBeNull()
  })
})
