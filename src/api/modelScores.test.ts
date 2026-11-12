import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLatestModelScore, isModelScore } from './modelScores'
import * as client from './client'

const ok = { kind: 'TIDY', model: 'yolov8s', accuracy: 0.87, cases: 60, medianSeconds: 2.5, measuredAt: '2026-11-12T13:00:00+09:00' }

afterEach(() => vi.restoreAllMocks())

describe('모델 시험 점수', () => {
  it('칸이 다 맞으면 점수로 본다', () => {
    expect(isModelScore(ok)).toBe(true)
  })

  it('정확도가 0–1 밖이거나 시각이 이상하면 버린다', () => {
    expect(isModelScore({ ...ok, accuracy: 87 })).toBe(false)
    expect(isModelScore({ ...ok, measuredAt: 'x' })).toBe(false)
    expect(isModelScore({ ...ok, cases: 0 })).toBe(false)
    expect(isModelScore({ ...ok, kind: undefined })).toBe(false)
  })

  it('다른 종류 모델 점수는 더 최근이어도 고르지 않는다', async () => {
    const other = { ...ok, kind: 'PRESENCE', accuracy: 0.99, measuredAt: '2026-11-12T14:00:00+09:00' }
    vi.spyOn(client, 'api').mockResolvedValue({ items: [ok, other] })
    expect((await getLatestModelScore('TIDY'))?.accuracy).toBe(0.87)
  })

  it('여러 개면 가장 최근에 잰 값을 고른다', async () => {
    const old = { ...ok, model: 'yolov8n', accuracy: 0.766, measuredAt: '2026-11-11T21:00:00+09:00' }
    vi.spyOn(client, 'api').mockResolvedValue({ items: [old, ok] })
    expect((await getLatestModelScore('TIDY'))?.accuracy).toBe(0.87)
  })

  it('기록이 없으면 null (화면은 기록해 둔 값을 쓴다)', async () => {
    vi.spyOn(client, 'api').mockResolvedValue({ items: [] })
    expect(await getLatestModelScore('TIDY')).toBeNull()
  })
})
