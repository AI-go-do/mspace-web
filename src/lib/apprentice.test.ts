import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _isStateForTest, _noticeForTest, _peekForTest, _resetForTest, decideProposal, refreshApprentice, resetApprentice, undoAutoDone, type ApprenticeState,
} from '../api/apprentice'
import { mockEnvironment } from '../api/environmentMock'
import { ADMIN_ROOMS } from '../config/adminRooms'
import { actsAlone, initialTrainees, proposalsFromRooms, score, traineeNote, type Trainee } from './apprentice'
import { toRoomView } from './roomHealth'

const base = (o: Partial<Trainee> = {}): Trainee => ({ kind: 'sensor', name: '센서 고장 알림', level: 1, maxLevel: 3, streak: 0, right: 0, total: 0, locked: false, ...o })

describe('score (채점 규칙)', () => {
  it('10번 연속 맞으면 한 단계 올라가고 연속 기록은 0부터', () => {
    let t = base({ streak: 8 })
    t = score(t, true).next
    expect(t.streak).toBe(9)
    const r = score(t, true)
    expect(r.result).toBe('up')
    expect(r.next.level).toBe(2)
    expect(r.next.streak).toBe(0)
    expect(r.next.right).toBe(2)
    expect(r.next.total).toBe(2)
  })

  it('한 번 틀리면 연속 기록이 0이 되고 바로 한 단계 내려간다', () => {
    const r = score(base({ level: 2, streak: 7 }), false)
    expect(r.result).toBe('down')
    expect(r.next.level).toBe(1)
    expect(r.next.streak).toBe(0)
  })

  it('레벨 1에서 틀리면 내려가지 않고 연속 기록만 0', () => {
    const r = score(base({ streak: 5 }), false)
    expect(r.result).toBe('reset')
    expect(r.next.level).toBe(1)
    expect(r.next.streak).toBe(0)
  })

  it('벌이 걸린 일(신고 판정)은 아무리 맞아도 레벨 1 그대로', () => {
    let t = base({ kind: 'report', maxLevel: 1, locked: true })
    for (let i = 0; i < 30; i++) t = score(t, true).next
    expect(t.level).toBe(1)
    expect(t.right).toBe(30)
    expect(actsAlone(t)).toBe(false)
    expect(traineeNote(t)).toBe('벌이 걸린 일 · 레벨 1 고정')
  })

  it('노쇼 무르기는 최대 레벨 2까지만', () => {
    let t = base({ kind: 'noshow', maxLevel: 2 })
    for (let i = 0; i < 40; i++) t = score(t, true).next
    expect(t.level).toBe(2)
    expect(traineeNote(t)).toContain('레벨 2까지')
  })

  it('처음 기록에서 벌이 걸린 일은 신고 판정 하나이고 레벨 1 고정', () => {
    const locked = initialTrainees().filter((t) => t.locked)
    expect(locked.map((t) => t.kind)).toEqual(['report'])
    expect(locked[0].maxLevel).toBe(1)
  })
})

describe('proposalsFromRooms', () => {
  const now = new Date('2026-11-08T14:41:00+09:00')
  const views = mockEnvironment(now, 60).rooms.map((r, i) => toRoomView(r, ADMIN_ROOMS[i], now))

  it('센서 멈춤·시간 넘김 방에서 처리안을 만든다', () => {
    const kinds = proposalsFromRooms(views, now).map((p) => `${p.kind}:${p.roomId}`)
    expect(kinds).toContain('sensor:4')
    expect(kinds).toContain('overtime:2')
  })

  it('더운 빈 방이라도 다음 예약이 없으면 다음 팀 준비 안내를 만들지 않는다', () => {
    const base = views[0]
    const hotEmpty = {
      ...base,
      flags: { co2Soon: false, co2Over: false, hot: true, dry: false, overtime: false, unbooked: false, offline: false, stuck: false, doorLeftOpen: false, noEntry: false, nightDoor: false },
      status: { text: '비어 있음', tone: 'empty' as const },
      temperatureC: 28.4,
    }
    const none = proposalsFromRooms([{ ...hotEmpty, slot: '다음 예약 없음', nextAt: null }], now)
    expect(none.some((p) => p.kind === 'prep')).toBe(false)
    const next = proposalsFromRooms([{ ...hotEmpty, slot: '다음 16:00 (예약 4명)', nextAt: '2026-11-08T16:00:00+09:00' }], now)
    expect(next.filter((p) => p.kind === 'prep').map((p) => p.title)).toEqual(['16:00 (예약 4명) 예약 전에 방이 28.4°C예요'])
  })

  it('근거는 3줄 안이고 방 안 사람 수(Q-17)를 넣지 않는다', () => {
    for (const p of proposalsFromRooms(views, now)) {
      expect(p.reasons.length).toBeLessThanOrEqual(3)
      expect(p.reasons.join(' ')).not.toMatch(/카메라|사람 수/)
    }
  })
})

describe('가짜 수습사원 저장소', () => {
  const at = new Date('2026-11-08T14:41:00+09:00')
  beforeEach(() => {
    _resetForTest()
    resetApprentice()
  })

  it('레벨 1 일(센서 고장 알림)은 결재함에 올리고, 같은 상황은 한 번만 올린다', () => {
    refreshApprentice(at)
    const s = _read()
    expect(s.inbox.some((p) => p.kind === 'sensor' && p.roomId === 4)).toBe(true) // 센서 고장 알림: 레벨 1
    // 같은 상황은 다시 불러도 한 번만
    const n = s.inbox.length
    refreshApprentice(new Date(at.getTime() + 10_000))
    expect(_read().inbox.length).toBe(n)
  })

  it('[맞아요]는 결재함에서 빼고 점수를 올린다. 센서 고장 알림은 한 번 더 맞으면 레벨 2', () => {
    refreshApprentice(at)
    const p = _read().inbox.find((x) => x.kind === 'sensor')!
    decideProposal(p.id, true)
    const s = _read()
    expect(s.inbox.find((x) => x.id === p.id)).toBeUndefined()
    expect(s.trainees.find((t) => t.kind === 'sensor')!.level).toBe(2)
    expect(s.stats.human).toBe(1)
  })

  it('[되돌리기]하면 그 일은 한 단계 내려가고 되돌림으로 남는다', () => {
    const d = _read().done[0]
    undoAutoDone(d.id)
    const s = _read()
    expect(s.done.find((x) => x.id === d.id)!.undone).toBe(true)
    expect(s.trainees.find((t) => t.kind === d.kind)!.level).toBe(1)
    expect(s.stats.undone).toBe(1)
    // 두 번 눌러도 한 번만
    undoAutoDone(d.id)
    expect(_read().stats.undone).toBe(1)
  })

  it('같은 일을 두 번째로 되돌리면 이미 레벨 1이라 레벨이 바뀌었다고 하지 않는다', () => {
    const [a, b] = _read().done.filter((x) => x.kind === 'vent')
    undoAutoDone(a.id)
    undoAutoDone(b.id)
    const t = _read().trainees.find((x) => x.kind === 'vent')!
    expect(t.level).toBe(1)
    expect(_read().stats.undone).toBe(2)
    expect(_noticeForTest()?.result).toBe('reset')
    expect(_noticeForTest()?.text).not.toContain('→')
  })

  it('레벨 3에서 되돌리면 레벨 2라 아직 먼저 처리한다고 안내한다', () => {
    const s = _read()
    const d = s.done[0]
    _resetForTest({ ...s, trainees: s.trainees.map((t) => (t.kind === d.kind ? { ...t, level: 3 } : t)) })
    undoAutoDone(d.id)
    expect(_read().trainees.find((t) => t.kind === d.kind)!.level).toBe(2)
    expect(_noticeForTest()?.text).toContain('아직 먼저 처리')
    expect(_noticeForTest()?.text).not.toContain('먼저 물어봐요')
  })
})

/** 저장소 지금 상태 */
const _read = (): ApprenticeState => _peekForTest()

describe('가짜 수습사원 저장소: 레벨 2 이상', () => {
  it('미리 환기 안내(레벨 2)는 결재함에 올리지 않고 AI가 먼저 처리한 일로 남긴다', () => {
    _resetForTest()
    resetApprentice()
    const start = new Date('2026-11-08T14:41:00+09:00')
    // 90분 안에 1번 방이 기준을 넘을 것 같은 때가 온다
    for (let m = 0; m < 90; m++) refreshApprentice(new Date(start.getTime() + m * 60_000))
    const s = _read()
    expect(s.inbox.some((p) => p.kind === 'vent')).toBe(false)
    expect(s.done.some((d) => d.kind === 'vent' && d.id.startsWith('p'))).toBe(true)
    expect(s.stats.auto).toBeGreaterThan(0)
  })
})

describe('저장된 값 검사', () => {
  it('칸이 빠졌거나 일 종류가 모자라면 쓰지 않고 처음 값으로 돌아간다', () => {
    _resetForTest()
    resetApprentice()
    const ok = _read()
    expect(_isStateForTest(ok)).toBe(true)
    expect(_isStateForTest({ ...ok, activeKeys: undefined } as unknown as ApprenticeState)).toBe(false)
    expect(_isStateForTest({ ...ok, stats: { auto: 0 } } as unknown as ApprenticeState)).toBe(false)
    expect(_isStateForTest({ ...ok, trainees: ok.trainees.slice(1) })).toBe(false)
  })

  it('배열 안 항목이 깨졌거나 모르는 일 종류면 쓰지 않는다', () => {
    _resetForTest()
    resetApprentice()
    const ok = _read()
    const bad = (o: object) => ({ ...ok, ...o }) as unknown as ApprenticeState
    expect(_isStateForTest(bad({ inbox: [null] }))).toBe(false)
    expect(_isStateForTest(bad({ inbox: [{ ...ok.inbox[0], kind: 'unknown' }] }))).toBe(false)
    expect(_isStateForTest(bad({ inbox: [{ ...ok.inbox[0], reasons: undefined }] }))).toBe(false)
    expect(_isStateForTest(bad({ done: [{ ...ok.done[0], undone: 'no' }] }))).toBe(false)
    expect(_isStateForTest(bad({ trainees: [...ok.trainees.slice(1), { ...ok.trainees[0], level: '2' }] }))).toBe(false)
    expect(_isStateForTest(bad({ activeKeys: [3] }))).toBe(false)
  })
})

describe('저장된 기록 불러오기 (localStorage)', () => {
  const stored = (v: unknown) => {
    const raw = JSON.stringify(v)
    vi.stubGlobal('localStorage', { getItem: () => raw, setItem: () => {}, removeItem: () => {} })
    _resetForTest()
  }
  afterEach(() => {
    vi.unstubAllGlobals()
    _resetForTest()
  })

  it('맞는 모양이면 저장된 값을 그대로 쓴다', () => {
    _resetForTest()
    resetApprentice()
    const ok = { ..._read(), stats: { auto: 3, human: 4, undone: 1 } }
    stored(ok)
    expect(_read().stats).toEqual({ auto: 3, human: 4, undone: 1 })
  })

  it('항목이 깨진 값이 저장돼 있으면 처음 값으로 돌아간다', () => {
    _resetForTest()
    resetApprentice()
    stored({ ..._read(), stats: { auto: 3, human: 4, undone: 1 }, inbox: [null] })
    const s = _read()
    expect(s.stats).toEqual({ auto: 0, human: 0, undone: 0 })
    expect(s.inbox.map((p) => p.id)).toEqual(['s1', 's2'])
  })
})
