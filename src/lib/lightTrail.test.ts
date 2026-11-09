import { describe, expect, it } from 'vitest'
import { flattenLight, isRoomsEnvironment, type RoomsEnvironment, type RoomEnvironment } from '../api/environment'
import { withLightTrail, type LightTrail } from './lightTrail'

const MIN = 60_000
const t0 = Date.parse('2026-11-09T02:40:00Z')
const iso = (ms: number) => new Date(ms).toISOString()

function room(over: Partial<RoomEnvironment> = {}): RoomEnvironment {
  return {
    roomId: 1, roomName: '1번 방', presence: 'EMPTY', lastSignalAt: iso(t0), offline: false,
    co2: null, temperatureC: null, humidityPct: null,
    series: [0, 1, 2].map((i) => ({ at: iso(t0 + i * MIN), ppm: null, temperatureC: null, humidityPct: null })),
    current: null, next: null, ...over,
  }
}
const env = (nowMs: number, r: RoomEnvironment): RoomsEnvironment => ({ now: iso(nowMs), rooms: [r] })

describe('core 조도 모양', () => {
  it('core의 light { raw, at }와 pir를 받아들이고 숫자로 편다', () => {
    // given
    const raw = { now: iso(t0), rooms: [{ ...room(), light: { raw: 612, at: iso(t0) }, pir: { detected: true, at: iso(t0) } }] }
    // when
    const ok = isRoomsEnvironment(raw)
    const flat = flattenLight(raw as unknown as RoomsEnvironment)
    // then
    expect(ok).toBe(true)
    expect(flat.rooms[0].light).toBe(612)
    expect(flat.rooms[0].lightAt).toBe(iso(t0))
    expect(flat.rooms[0].pir?.detected).toBe(true)
  })

  it('light 묶음에 raw가 없으면 모양이 다르다고 본다', () => {
    const raw = { now: iso(t0), rooms: [{ ...room(), light: { at: iso(t0) } }] }
    expect(isRoomsEnvironment(raw)).toBe(false)
  })
})

describe('조도 쌓기', () => {
  it('받은 최신 값을 분마다 쌓아 series 칸에 채운다', () => {
    // given
    const trail: LightTrail = new Map()
    // when: 2:40과 2:42에 한 번씩 받음
    withLightTrail(env(t0 + 10_000, room({ light: 600, presence: 'OCCUPIED' })), trail, 60)
    const out = withLightTrail(env(t0 + 2 * MIN + 5_000, room({ light: 80 })), trail, 60)
    // then
    const s = out.rooms[0].series
    expect(s[0]).toMatchObject({ light: 600, occupied: true })
    expect(s[1].light).toBeUndefined()
    expect(s[2]).toMatchObject({ light: 80, occupied: false })
  })

  it('같은 분에 여러 번 받으면 마지막 값만 남긴다', () => {
    const trail: LightTrail = new Map()
    withLightTrail(env(t0 + 10_000, room({ light: 600 })), trail, 60)
    const out = withLightTrail(env(t0 + 40_000, room({ light: 300 })), trail, 60)
    expect(out.rooms[0].series[0].light).toBe(300)
    expect(trail.get(1)).toHaveLength(1)
  })

  it('조도가 한 번도 안 온 방은 그대로 둔다', () => {
    const trail: LightTrail = new Map()
    const r = room()
    const out = withLightTrail(env(t0, r), trail, 60)
    expect(out.rooms[0]).toBe(r)
  })

  it('core가 분별 조도를 주면 손대지 않는다', () => {
    const trail: LightTrail = new Map()
    const r = room({ light: 500, series: [{ at: iso(t0), ppm: null, light: 510 }] })
    const out = withLightTrail(env(t0, r), trail, 60)
    expect(out.rooms[0]).toBe(r)
  })
})
