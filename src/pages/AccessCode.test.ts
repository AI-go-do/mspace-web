import { describe, expect, it } from 'vitest'
import { CHECKIN_REFRESH_MS, checkInDeadline, deadlineOf, deadlineText, isInstantStart, justEntered, mmss, refreshDelay } from './AccessCode'

describe('입실 마감 (FR-ACC-001)', () => {
  it('미리 예약은 30분 경계에서 시작하고 15분 뒤가 마감', () => {
    expect(isInstantStart('2026-11-05T14:30:00+09:00')).toBe(false)
    expect(checkInDeadline('2026-11-05T14:30:00+09:00').toISOString()).toBe('2026-11-05T05:45:00.000Z')
  })
  it('즉시 시작은 누른 시각에서 시작하고 10분 뒤가 마감(새로 열어도 같다)', () => {
    expect(isInstantStart('2026-11-05T14:17:23+09:00')).toBe(true)
    expect(checkInDeadline('2026-11-05T14:17:23+09:00').toISOString()).toBe('2026-11-05T05:27:23.000Z')
  })
})

describe('deadlineOf', () => {
  it('서버가 준 checkinDeadline을 먼저 쓴다(시작 뒤에 한 미리 예약)', () => {
    const r = { startAt: '2026-11-05T14:30:00+09:00', checkinDeadline: '2026-11-05T14:52:00+09:00' }
    expect(deadlineOf(r).toISOString()).toBe('2026-11-05T05:52:00.000Z')
  })
  it('서버 값이 없으면 시작 시각으로 계산한다', () => {
    expect(deadlineOf({ startAt: '2026-11-05T14:30:00+09:00' }).toISOString()).toBe('2026-11-05T05:45:00.000Z')
  })
})

describe('입실하면 번호 화면 닫기', () => {
  const r = { status: 'BOOKED', owner: true, startAt: '2026-11-06T14:30:00+09:00' }
  const at = (t: string) => Date.parse(t)

  it('입실할 수 있는 때(시작 10분 전 ~ 마감 1분 뒤)는 3초마다 본다', () => {
    expect(refreshDelay(r, at('2026-11-06T14:20:00+09:00'), true)).toBe(CHECKIN_REFRESH_MS)
    expect(refreshDelay(r, at('2026-11-06T14:46:00+09:00'), true)).toBe(CHECKIN_REFRESH_MS)
  })
  it('그 밖의 때, 화면을 안 볼 때, 대표자가 아니거나 이미 입실했으면 30초', () => {
    expect(refreshDelay(r, at('2026-11-06T14:00:00+09:00'), true)).toBe(30_000)
    expect(refreshDelay(r, at('2026-11-06T14:46:01+09:00'), true)).toBe(30_000)
    expect(refreshDelay(r, at('2026-11-06T14:30:00+09:00'), false)).toBe(30_000)
    expect(refreshDelay({ ...r, owner: false }, at('2026-11-06T14:30:00+09:00'), true)).toBe(30_000)
    expect(refreshDelay({ ...r, status: 'IN_USE' }, at('2026-11-06T14:30:00+09:00'), true)).toBe(30_000)
    expect(refreshDelay(null, at('2026-11-06T14:30:00+09:00'), true)).toBe(30_000)
  })
  it('입실 시간이 곧 시작되면 그때 맞춰 한 번 더 본다(최소 3초)', () => {
    expect(refreshDelay(r, at('2026-11-06T14:19:50+09:00'), true)).toBe(10_000)
    expect(refreshDelay(r, at('2026-11-06T14:19:59+09:00'), true)).toBe(CHECKIN_REFRESH_MS)
  })
  it('서버 입실 마감(checkinDeadline)이 있으면 그 시각까지 자주 본다', () => {
    const late = { ...r, checkinDeadline: '2026-11-06T14:52:00+09:00' }
    expect(refreshDelay(late, at('2026-11-06T14:52:30+09:00'), true)).toBe(CHECKIN_REFRESH_MS)
  })
  it('열어 둔 동안 예약됨 → 사용 중으로 바뀔 때만 닫는다(처음부터 사용 중이면 그대로)', () => {
    expect(justEntered('BOOKED', 'IN_USE')).toBe(true)
    expect(justEntered(undefined, 'IN_USE')).toBe(false)
    expect(justEntered('IN_USE', 'IN_USE')).toBe(false)
    expect(justEntered('BOOKED', 'NO_SHOW')).toBe(false)
  })
})

describe('입실 마감 안내 (문 앞 카운트다운)', () => {
  const start = '2026-11-06T14:30:00+09:00'
  const deadline = new Date('2026-11-06T14:45:00+09:00')
  const at = (t: string) => Date.parse(t)
  it('남은 시간은 m:ss, 한 시간 넘으면 h:mm:ss, 0 아래는 0:00', () => {
    expect(mmss(7 * 60_000 + 42_000)).toBe('7:42')
    expect(mmss(3_600_000 + 7 * 60_000 + 2_000)).toBe('1:07:02')
    expect(mmss(-5)).toBe('0:00')
  })
  it('입실할 수 있는 때(시작 10분 전부터)는 카운트다운, 그 전에는 마감 시각, 지나면 지났다고', () => {
    expect(deadlineText(deadline, start, at('2026-11-06T14:00:00+09:00'))).toBe('14:45까지 입실하지 않으면 방이 풀려요')
    expect(deadlineText(deadline, start, at('2026-11-06T14:20:00+09:00'))).toBe('입실 마감까지 25:00')
    expect(deadlineText(deadline, start, at('2026-11-06T14:37:18+09:00'))).toBe('입실 마감까지 7:42')
    expect(deadlineText(deadline, start, at('2026-11-06T14:45:00+09:00'))).toBe('입실 마감이 지났어요')
  })
})
