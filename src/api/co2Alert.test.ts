import { afterEach, describe, expect, it } from 'vitest'
import { co2AlertText, demoCo2Alerts, isCo2DemoId, noteCo2Demo, readCo2Demo, stepCo2Alert, type Co2Track } from './co2Alert'
import { notificationAction } from './notifications'
import type { RoomView } from '../lib/roomHealth'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const MIN = 60_000
const flags = { co2Soon: false, co2Over: false, hot: false, dry: false, overtime: false, unbooked: false, offline: false, stuck: false, doorLeftOpen: false, noEntry: false, nightDoor: false }
const view = (state: 'ok' | 'soon' | 'over') => ({
  name: '창작실 2',
  co2: state === 'over' ? 1080 : state === 'soon' ? 930 : 700,
  etaMinutes: state === 'soon' ? 12 : null,
  flags: { ...flags, co2Soon: state === 'soon', co2Over: state === 'over' },
}) as unknown as RoomView

/** 경고 여부를 분마다 넣어 보고 몇 번 알림이 갔는지 센다 */
function run(seq: boolean[]): number[] {
  let t: Co2Track | undefined
  const fired: number[] = []
  seq.forEach((urgent, i) => {
    const r = stepCo2Alert(t, urgent, i * MIN)
    t = r.track
    if (r.fire) fired.push(i)
  })
  return fired
}

describe('숨 막히기 알림 (예약당 최대 2번)', () => {
  afterEach(() => store.clear())

  it('경고가 처음 뜨면 한 번 보내고, 계속 떠 있는 동안은 다시 보내지 않는다', () => {
    expect(run([false, true, true, true, true])).toEqual([1])
  })
  it('창문을 열어 내려간 뒤 10분 넘게 괜찮다가 다시 오르면 한 번 더 보낸다', () => {
    const seq = [true, ...Array(10).fill(false), true]
    expect(run(seq)).toEqual([0, 11])
  })
  it('기준 언저리에서 잠깐 내려갔다 오르면(10분 안) 다시 보내지 않는다', () => {
    expect(run([true, false, false, true, false, true])).toEqual([0])
  })
  it('세 번째로 올라도 더는 보내지 않는다', () => {
    const calm = Array(11).fill(false)
    expect(run([true, ...calm, true, ...calm, true])).toEqual([0, 12])
  })

  it('곧 넘음은 "숨 막히기 N분 전", 넘음은 "기준을 넘었어요". 두 번째는 "다시"와 마지막이라고 알린다', () => {
    expect(co2AlertText(view('soon'), 1).title).toBe('창작실 2: 숨 막히기 12분 전')
    expect(co2AlertText(view('soon'), 1).body).toContain('창문을 조금 열어 주세요')
    expect(co2AlertText(view('over'), 2).title).toBe('창작실 2: CO2가 다시 기준을 넘었어요')
    expect(co2AlertText(view('over'), 2).body).toContain('마지막')
  })

  it('예시 화면: 예약마다 따로 세고, 알림함에 넣고, 하나씩 읽음으로 바꾼다', () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 9, 5, m))
    expect(noteCo2Demo(7, view('ok'), at(0))).toBeNull()
    const first = noteCo2Demo(7, view('soon'), at(1))
    expect(first?.kind).toBe('CO2_SOON')
    expect(first?.reservationId).toBe(7)
    expect(isCo2DemoId(first!.id)).toBe(true)
    expect(noteCo2Demo(7, view('soon'), at(2))).toBeNull()
    // 다른 예약은 따로 센다
    const other = noteCo2Demo(8, view('over'), at(3))
    expect(other).not.toBeNull()
    expect(other!.id).not.toBe(first!.id)
    expect(demoCo2Alerts().map((n) => n.id)).toEqual([other!.id, first!.id])
    readCo2Demo(first!.id)
    expect(demoCo2Alerts().map((n) => n.read)).toEqual([false, true])
    readCo2Demo(null)
    expect(demoCo2Alerts().every((n) => n.read)).toBe(true)
  })

  it('알림을 누르면 홈의 내 방 공기 카드로 간다', () => {
    const n = noteCo2Demo(7, view('soon'), new Date())!
    expect(notificationAction(n)).toEqual({ to: '/', label: '내 방 공기 보기' })
  })
  it('방의 사과 예시 번호(-1)는 CO2 알림 번호가 아니다', () => {
    expect(isCo2DemoId(-1)).toBe(false)
  })
})
