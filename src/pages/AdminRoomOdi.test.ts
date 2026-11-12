import { describe, expect, it } from 'vitest'
import { odiView } from './AdminRoomOdi'
import type { Decision } from '../api/climate'

const AT = '2026-11-12T18:05:00+09:00'
const dec = (steps: Decision['steps'], open = true): Decision => ({
  id: 'd1', roomId: 1, roomName: '창작실 1', metric: 'CO2', group: 'HIGH', kind: 'OVER', openedAt: AT, closedAt: null, open, steps,
})
const s = (key: Decision['steps'][number]['key'], status: Decision['steps'][number]['status'], text: string) => ({ key, status, text, at: AT })

describe('odiView', () => {
  it('여는 중에도 끝난 단계를 "하는 중"으로 보이지 않는다: 점은 연 만큼만, 크게는 연 단계 중 마지막', () => {
    const d = dec([s('DETECT', 'DONE', 'CO2 1649ppm'), s('PREDICT', 'DONE', '30분 뒤 1823ppm'), s('NOTIFY', 'SKIPPED', '30분 안 같은 알림')])
    const v = odiView(d, 1)
    expect(v.dots.map((x) => x.state)).toEqual(['ok', 'wait', 'wait', 'wait', 'wait'])
    expect(v.head).toMatchObject({ label: '탐지', text: 'CO2 1649ppm', busy: false, at: AT })
    const w = odiView(d, 2)
    expect(w.head).toMatchObject({ label: '예측', text: '30분 뒤 1823ppm', busy: false })
    expect(w.why).toBe('CO2 1649ppm')
  })

  it('다 열고 끝나면 마지막 단계와 왜·한 일', () => {
    const d = dec([s('DETECT', 'DONE', 'CO2 1649ppm'), s('PREDICT', 'DONE', '예측'), s('NOTIFY', 'SKIPPED', '쉬어요'),
      s('CONTROL', 'DONE', '환풍기 켬'), s('VERIFY', 'DONE', '평소 범위로 돌아왔어요')], false)
    const v = odiView(d, Number.POSITIVE_INFINITY)
    expect(v.dots.map((x) => x.state)).toEqual(['ok', 'ok', 'skip', 'ok', 'ok'])
    expect(v.head).toMatchObject({ label: '다시 확인', text: '평소 범위로 돌아왔어요', busy: false, at: AT })
    expect(v.did).toBe('환풍기 켬')
    expect(v.busy).toBe(false)
  })

  it('서버에서 하는 중인 단계가 있으면 그 단계가 크게', () => {
    const v = odiView(dec([s('DETECT', 'DONE', '온도 높음'), s('CONTROL', 'RUNNING', '켤 기기 고르는 중')]), Number.POSITIVE_INFINITY)
    expect(v.head).toMatchObject({ label: '제어', text: '켤 기기 고르는 중', busy: true })
    expect(v.dots.find((x) => x.key === 'CONTROL')?.state).toBe('doing')
  })
})
