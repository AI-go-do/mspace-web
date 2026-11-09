import { describe, expect, it } from 'vitest'
import type { ApplianceState } from '../api/appliances'
import type { RoomEnvironment } from '../api/environment'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { mockWeather, type OutdoorWeather } from '../api/weather'
import { autoText, climateTips, josa, manualHold, seasonOf, seasonRules, stateLabel } from './climate'
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

  it('더우면 냉방 26°C, 추우면 난방 20°C를 권한다', () => {
    const hot = climateTips(view(room((i) => 600 + (i % 2), busy, 28.2)), now, off)
    expect(hot.map((t) => t.why)).toEqual(['cool'])
    expect(hot[0].command).toEqual({ power: 'ON', mode: 'COOL', targetC: 26 })
    const cold = climateTips(view(room((i) => 600 + (i % 2), busy, 16.5)), now, off)
    expect(cold[0].command).toEqual({ power: 'ON', mode: 'HEAT', targetC: 20 })
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

  it('문이 열려 있으면 냉방을 권하되 자동으로 켜지는 않는다', () => {
    const env = { ...room((i) => 600 + (i % 2), busy, 28.2), door: { open: true, since: iso(12) } }
    const view1 = toRoomView(env, { ...ADMIN_ROOMS[0], sensors: [...ADMIN_ROOMS[0].sensors, 'door'] }, now)
    const [tip] = climateTips(view1, now, off)
    expect(tip.why).toBe('cool')
    expect(tip.auto).toBe(false)
    expect(tip.sub).toContain('문을 먼저 닫아')
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

describe('manualHold', () => {
  const s = (by: ApplianceState['by'], minAgo: number): ApplianceState => ({ applianceId: 'x', power: 'OFF', changedAt: iso(minAgo), by })
  it('관리자가 10분 안에 바꾼 기기는 자동이 건드리지 않고, 자동이 바꾼 것·오래된 것은 건드린다', () => {
    expect(manualHold(s('STUDENT', 3), now)).toBe(true)
    expect(manualHold(s('ADMIN', 9), now)).toBe(true)
    expect(manualHold(s('ADMIN', 11), now)).toBe(false)
    expect(manualHold(s('AUTO', 1), now)).toBe(false)
    expect(manualHold(off('x'), now)).toBe(false)
  })

  it('학생이 예약 중에 끈 기기는 그 예약이 끝날 때까지 자동이 다시 켜지 않는다', () => {
    // 예약은 30분 전 시작, 60분 뒤 끝. 학생이 20분 전에 난방을 껐다
    expect(manualHold(s('STUDENT', 20), now, busy.current)).toBe(true)
    // 예약이 끝나면 풀린다
    const after = new Date(now.getTime() + 61 * 60_000)
    expect(manualHold(s('STUDENT', 20), after, busy.current)).toBe(false)
    // 예약 전에 바꾼 건 10분만
    expect(manualHold(s('STUDENT', 40), now, busy.current)).toBe(false)
    // 관리자는 예약과 상관없이 10분
    expect(manualHold(s('ADMIN', 20), now, busy.current)).toBe(false)
  })
})

describe('에어컨 모드 바꾸기', () => {
  it('에어컨이 이미 냉방으로 켜져 있는데 추우면 난방을 권하지만 자동으로 바꾸지는 않는다', () => {
    const [tip] = climateTips(view(room((i) => 600 + (i % 2), busy, 16.5)), now, states({ 'r1-ac': { mode: 'COOL', targetC: 26 } }))
    expect(tip.why).toBe('heat')
    expect(tip.button).toBe('난방 켜기')
    expect(tip.auto).toBe(false)
  })
})

describe('seasonRules', () => {
  const w = (over: Partial<OutdoorWeather>): OutdoorWeather => ({ tempC: 10, minC: 6, maxC: 14, normalC: 9.8, alert: null, source: 'mock', ...over })

  it('계절은 광주 평년 기온으로 나눈다: 11–3월 겨울, 6–9월 여름', () => {
    expect(seasonOf(9.8)).toBe('winter') // 11월
    expect(seasonOf(13.5)).toBe('mid') // 4월
    expect(seasonOf(26.4)).toBe('summer') // 7월
  })

  it('겨울엔 19°C 아래면 난방, 여름엔 27°C부터 냉방', () => {
    const winter = seasonRules(w({}))
    expect(climateTips(view(room((i) => 600 + (i % 2), busy, 18.5)), now, off, winter).map((t) => t.why)).toEqual(['heat'])
    expect(climateTips(view(room((i) => 600 + (i % 2), busy, 18.5)), now, off).map((t) => t.why)).toEqual([])
    const summer = seasonRules(w({ normalC: 27, tempC: 31, minC: 25, maxC: 32 }))
    expect(climateTips(view(room((i) => 600 + (i % 2), busy, 27.2)), now, off, summer).map((t) => t.why)).toEqual(['cool'])
  })

  it('한파인 날은 빈 방도 다음 예약 90분 전부터 미리 데운다', () => {
    const next = { presence: 'EMPTY' as const, next: { startAt: iso(-80), people: 4 } }
    const env = room((i) => 480 + (i % 2), next, 16)
    expect(climateTips(view(env), now, off, seasonRules(w({}))).map((t) => t.why)).toEqual([])
    const cold = seasonRules(mockWeather(now, 'cold'))
    expect(cold.alert).toBe('COLD_WAVE')
    const [tip] = climateTips(view(env), now, off, cold)
    expect(tip.why).toBe('heat')
    expect(tip.sub).toContain('오늘 한파(최저 -13°C)라')
    expect(tip.sub).toContain('미리')
    expect(tip.auto).toBe(true)
  })

  it('봄·가을에 바깥이 시원하면 에어컨보다 창문을 권하고 자동으로 켜지 않는다', () => {
    const spring = seasonRules(w({ normalC: 16.3, tempC: 18 }))
    const [tip] = climateTips(view(room((i) => 600 + (i % 2), busy, 28.2)), now, off, spring)
    expect(tip.sub).toContain('창문을 열면')
    expect(tip.auto).toBe(false)
  })

  it('날씨를 모르면 기본 기준 그대로', () => {
    expect(seasonRules(null).precoolMinutes).toBe(60)
  })
})
