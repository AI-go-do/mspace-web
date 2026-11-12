import { afterEach, describe, expect, it, vi } from 'vitest'
import { addAutoLog, applianceState, isSending, resetAppliances, sendApplianceCommand } from './appliances'

afterEach(() => { vi.useRealTimers(); resetAppliances() })

describe('에어컨·공기청정기 가짜 창구', () => {
  it('처음에는 꺼짐이고, 켜기를 보내면 잠깐 보내는 중이었다가 켜진다', async () => {
    vi.useFakeTimers()
    expect(applianceState('r1-ac').power).toBe('OFF')
    const p = sendApplianceCommand(1, 'r1-ac', { power: 'ON', mode: 'COOL', targetC: 26 }, 'ADMIN', { now: new Date('2026-11-09T05:00:00Z') })
    expect(isSending('r1-ac')).toBe(true)
    await vi.runAllTimersAsync()
    const s = await p
    expect(s).toMatchObject({ power: 'ON', mode: 'COOL', targetC: 26, by: 'ADMIN' })
    expect(applianceState('r1-ac').power).toBe('ON')
    expect(isSending('r1-ac')).toBe(false)
  })

  it('보내는 중에 같은 기기를 또 누르면 겹쳐 보내지 않는다', async () => {
    vi.useFakeTimers()
    const a = sendApplianceCommand(1, 'r1-purifier', { power: 'ON' }, 'STUDENT')
    await expect(sendApplianceCommand(1, 'r1-purifier', { power: 'OFF' }, 'STUDENT')).rejects.toMatchObject({ code: 'APPLIANCE_BUSY' })
    await vi.runAllTimersAsync()
    expect((await a).power).toBe('ON')
    expect(applianceState('r1-purifier').power).toBe('ON')
  })

  it('자동 기록은 최근 30개만 남는다', () => {
    for (let i = 0; i < 35; i++) addAutoLog({ at: new Date(i * 1000).toISOString(), roomId: 1, applianceId: 'r1-ac', text: `${i}` })
    resetAppliances()
    expect(applianceState('r1-ac').power).toBe('OFF')
  })
})
