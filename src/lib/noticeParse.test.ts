import { describe, expect, it } from 'vitest'
import { NOTICE_EXAMPLES, parseNotice, splitBySpans } from './noticeParse'

// 2026-11-08(일) 22:00 서울
const now = new Date('2026-11-08T22:00:00+09:00')
const kst = (s: string) => new Date(`${s}+09:00`).toISOString()

describe('공지 한 줄 → 막기안', () => {
  it('날짜·오전 시각 범위·방·사유를 읽는다', () => {
    const d = parseNotice(NOTICE_EXAMPLES[0], now)
    expect(d.problem).toBeNull()
    expect(d.rows).toEqual([{ roomId: 5, startAt: kst('2026-11-12T09:00:00'), endAt: kst('2026-11-12T12:00:00') }])
    expect(d.reason).toBe('INSPECTION')
    expect(d.memo).toBe('에어컨 점검')
    expect(d.notes).toEqual([])
    expect(new Set(d.spans.map((s) => s.kind))).toEqual(new Set(['date', 'time', 'room', 'reason']))
  })

  it('"다음 주 화요일", 오전·오후 없는 2시~5시, 방 두 개', () => {
    const d = parseNotice(NOTICE_EXAMPLES[1], now)
    expect(d.rows).toEqual([
      { roomId: 1, startAt: kst('2026-11-10T14:00:00'), endAt: kst('2026-11-10T17:00:00') },
      { roomId: 2, startAt: kst('2026-11-10T14:00:00'), endAt: kst('2026-11-10T17:00:00') },
    ])
    expect(d.reason).toBe('RENTAL')
    expect(d.notes.join(' ')).toContain('오후 2시')
  })

  it('시각 없는 날짜 범위 + 전체 방은 첫날 0시부터 끝날 다음 0시까지 한 번에', () => {
    const d = parseNotice(NOTICE_EXAMPLES[2], now)
    expect(d.rows).toHaveLength(5)
    expect(d.rows[0]).toEqual({ roomId: 1, startAt: kst('2026-11-16T00:00:00'), endAt: kst('2026-11-18T00:00:00') })
    expect(d.reason).toBe('CONSTRUCTION')
    expect(d.memo).toBe('바닥 공사')
    expect(d.notes).toContain('시각이 없어 하루 종일로 읽었어요.')
  })

  it('여러 날 + 시각이면 날마다 같은 시각', () => {
    const d = parseNotice('11월 12일~14일 13:00-15:30 창작실 3 소독', now)
    expect(d.rows.map((r) => r.startAt)).toEqual([kst('2026-11-12T13:00:00'), kst('2026-11-13T13:00:00'), kst('2026-11-14T13:00:00')])
    expect(d.rows.every((r) => r.roomId === 3)).toBe(true)
    expect(d.notes.join(' ')).toContain('3일 동안')
  })

  it('내일, 오후 2시 반~4시 10분은 30분 칸으로 넓힌다', () => {
    const d = parseNotice('내일 오후 2시 반부터 4시 10분까지 4번 방 청소', now)
    expect(d.rows).toEqual([{ roomId: 4, startAt: kst('2026-11-09T14:30:00'), endAt: kst('2026-11-09T16:30:00') }])
    expect(d.notes.join(' ')).toContain('30분 칸')
  })

  it('방이 없으면 모든 방 + 확인 안내, 사유가 없으면 기타', () => {
    const d = parseNotice('11/20 하루 종일 이용 불가', now)
    expect(d.rows).toHaveLength(5)
    expect(d.reason).toBe('OTHER')
    expect(d.notes.join(' ')).toMatch(/모든 방.*확인/)
  })

  it('날짜가 없으면 막기안을 만들지 않는다', () => {
    expect(parseNotice('5번 방 에어컨 점검', now).problem).toMatch(/날짜/)
    expect(parseNotice('   ', now).problem).toMatch(/붙여 넣어/)
  })

  it('"3번 틀리면" 같은 숫자는 방으로 읽지 않는다', () => {
    const d = parseNotice('11/12 2번 방 점검, 번호를 3번 틀리면 잠겨요', now)
    expect(d.rows.map((r) => r.roomId)).toEqual([2])
  })

  it('연말에 1월 공지는 내년으로 읽는다', () => {
    const d = parseNotice('1월 5일 1번 방 점검', new Date('2026-12-20T10:00:00+09:00'))
    expect(d.rows[0].startAt).toBe(kst('2027-01-05T00:00:00'))
  })

  it('읽은 곳으로 글을 자른다', () => {
    const t = '11/12 5번 방 점검'
    const d = parseNotice(t, now)
    const parts = splitBySpans(t, d.spans)
    expect(parts.map((p) => p.text).join('')).toBe(t)
    expect(parts.filter((p) => p.kind).map((p) => p.kind)).toEqual(['date', 'room', 'reason'])
  })
  it('없는 방 번호만 적으면 모든 방으로 넘겨짚지 않고 되묻는다', () => {
    const d = parseNotice('11/12 6번 방 점검', now)
    expect(d.rows).toEqual([])
    expect(d.problem).toContain('6번 방은 없어요')
  })

  it('있는 방과 없는 방이 섞이면 없는 방만 빼고 알려 준다', () => {
    const d = parseNotice('11/12 2, 7번 방 점검', now)
    expect(d.rows.map((r) => r.roomId)).toEqual([2])
    expect(d.notes.join(' ')).toContain('7번 방은 없어요')
  })

  it('없는 날짜·24시 넘는 시각은 오류 없이 되묻는다', () => {
    expect(parseNotice('2월 30일 3번 방 점검', now).problem).toContain('날짜')
    expect(parseNotice('2027-02-29 3번 방 점검', now).problem).toContain('날짜')
    expect(() => parseNotice('11/12 24:30 3번 방 점검', now)).not.toThrow()
  })
})
