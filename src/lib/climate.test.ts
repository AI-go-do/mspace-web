import { describe, expect, it } from 'vitest'
import type { ApplianceState } from '../api/appliances'
import type { RoomEnvironment } from '../api/environment'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { autoText, climateTips, josa, stateLabel } from './climate'
import { toRoomView } from './roomHealth'

const now = new Date('2026-11-09T14:00:00+09:00')
const iso = (minAgo: number) => new Date(now.getTime() - minAgo * 60_000).toISOString()
const busy = { current: { reservationId: 9, startAt: iso(30), endAt: iso(-60), people: 4 } }

function room(ppm: (i: number) => number, extra: Partial<RoomEnvironment> = {}, temp = 24, n = 45): RoomEnvironment {
  const series = Array.from({ length: n }, (_, i) => ({ at: iso(n - 1 - i), ppm: ppm(i), temperatureC: temp, humidityPct: 45 }))
  return {
    roomId: 1, roomName: '창작실 1', presence: 'OCCUPIED', lastSignalAt: iso(0), offline: false,
    co2: { ppm: series[n - 1].ppm!, at: iso(0) }, temperatureC: temp, humidityPct: 45, series,
    current: null, next: null, ...extra,
  }
}
const view = (env: RoomEnvironment) => toRoomView(env, ADMIN_ROOMS[0], now)
const off = (id: string): ApplianceState => ({ applianceId: id, power: 'OFF', changedAt: null, by: null })
const states = (on: Record<string, Partial<ApplianceState>>) => (id: string): ApplianceState =>
  on[id] ? { ...off(id), power: 'ON', ...on[id] } : off(id)

describe('climateTips', () => {
  it('공기가 괜찮고 온도도 적당하면 권유가 없다', () => {
    expect(climateTips(view(room((i) => 600 + (i % 2), busy)), now, off)).toEqual([])
  })

  it('곧 CO2 기준을 넘으면 "숨 막히기 N분 전"과 환기, 공기청정기 켜기를 권한다', () => {
    const tips = climateTips(view(room((i) => 460 + 10 * i, busy)), now, off)
    expect(tips).toHaveLength(1)
    expect(tips[0].title).toMatch(/^숨 막히기 \d+분 전$/)
    expect(tips[0].sub).toContain('창문')
    expect(tips[0].command).toEqual({ power: 'ON' })
    expect(tips[0].appliance?.kind).toBe('purifier')
  })

  it('공기청정기가 이미 켜져 있으면 창문 안내만 남고 버튼이 없다', () => {
    const tips = climateTips(view(room((i) => 460 + 10 * i, busy)), now, states({ 'r1-purifier': {} }))
    expect(tips).toHaveLength(1)
    expect(tips[0].button).toBeUndefined()
    expect(tips[0].auto).toBe(false)
  })

  it('빈 방 CO2는 혼자 내려가서 권하지 않는다', () => {
    expect(climateTips(view(room((i) => 460 + 10 * i, { presence: 'EMPTY' })), now, off).filter((t) => t.why === 'air')).toEqual([])
  })

  it('더우면 냉방 26°C, 추우면 난방 22°C를 권한다', () => {
    const hot = climateTips(view(room((i) => 600 + (i % 2), busy, 28.2)), now, off)
    expect(hot.map((t) => t.why)).toEqual(['cool'])
    expect(hot[0].command).toEqual({ power: 'ON', mode: 'COOL', targetC: 26 })
    const cold = climateTips(view(room((i) => 600 + (i % 2), busy, 16.5)), now, off)
    expect(cold[0].command).toEqual({ power: 'ON', mode: 'HEAT', targetC: 22 })
  })

  it('이미 냉방 중이면 다시 권하지 않는다', () => {
    expect(climateTips(view(room((i) => 600 + (i % 2), busy, 28.2)), now, states({ 'r1-ac': { mode: 'COOL', targetC: 26 } }))).toEqual([])
  })

  it('빈 방이라도 다음 예약이 1시간 안이면 미리 냉방을 권한다', () => {
    const next = { presence: 'EMPTY' as const, next: { startAt: iso(-40), people: 4 } }
    const tips = climateTips(view(room((i) => 480 + (i % 2), next, 28)), now, off)
    expect(tips).toHaveLength(1)
    expect(tips[0].sub).toMatch(/^다음 예약 14:40 전에/)
  })

  it('빈 방이고 곧 올 사람도 없는데 켜져 있으면 끄기를 권한다', () => {
    const tips = climateTips(view(room((i) => 480 + (i % 2), { presence: 'EMPTY' })), now, states({ 'r1-ac': { mode: 'COOL', targetC: 26 }, 'r1-purifier': {} }))
    expect(tips.map((t) => t.title)).toEqual(['빈 방인데 에어컨이 켜져 있어요', '빈 방인데 공기청정기가 켜져 있어요'])
    expect(tips.every((t) => t.command?.power === 'OFF')).toBe(true)
  })

  it('재실을 모르면 끄지 않는다', () => {
    expect(climateTips(view(room((i) => 480 + (i % 2), { presence: 'UNKNOWN' })), now, states({ 'r1-ac': {} }))).toEqual([])
  })

  it('센서가 끊기거나 멈췄으면 값을 믿지 않고 아무것도 권하지 않는다', () => {
    expect(climateTips(view(room((i) => 460 + 10 * i, { ...busy, offline: true })), now, off)).toEqual([])
    expect(climateTips(view(room(() => 452, busy, 30)), now, off)).toEqual([])
  })
})

describe('글 만들기', () => {
  it('받침에 따라 조사를 고른다', () => {
    expect(josa('에어컨', '이', '가')).toBe('에어컨이')
    expect(josa('공기청정기', '이', '가')).toBe('공기청정기가')
  })

  it('상태 한 줄과 자동 기록', () => {
    expect(stateLabel(off('x'))).toBe('꺼짐')
    expect(stateLabel({ applianceId: 'x', power: 'ON', mode: 'COOL', targetC: 26, changedAt: iso(0), by: 'AUTO' })).toBe('켜짐 · 냉방 26°C · 14:00 자동')
    const [tip] = climateTips(view(room((i) => 480 + (i % 2), { presence: 'EMPTY' })), now, states({ 'r1-purifier': {} }))
    expect(autoText(tip)).toBe('빈 방이라 공기청정기를 껐어요')
  })
})
