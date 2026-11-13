import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { clearReportDraft, isNeighborRoom, loadReportDraft, reportBadge, MAX_REPORT_CONTENT, reportErrorMessage, reportProblem, saveReportDraft } from './reports'

const base = { roomId: 2, category: 'BROKEN' as const, content: '', noiseConfirmed: false }

describe('신고 보내기 전 확인 (FR-RPT-101)', () => {
  it('방·종류를 고르면 보낼 수 있다', () => {
    expect(reportProblem(base)).toBeNull()
  })
  it('방이나 종류가 없으면 막는다', () => {
    expect(reportProblem({ ...base, roomId: null })).toContain('방')
    expect(reportProblem({ ...base, category: null })).toContain('문제')
  })
  it('소음은 "정말 소란인가요?" 확인이 있어야 한다', () => {
    expect(reportProblem({ ...base, category: 'NOISE' })).toContain('소란')
    expect(reportProblem({ ...base, category: 'NOISE', noiseConfirmed: true })).toBeNull()
  })
  it('소음은 내 방이면 막고 옆 방이면 보낸다 (11/13)', () => {
    const noise = { ...base, category: 'NOISE' as const, noiseConfirmed: true, ownRoom: 2 }
    expect(reportProblem(noise)).toContain('옆 방')
    expect(reportProblem({ ...noise, roomId: 3 })).toBeNull()
    expect(reportProblem({ ...noise, ownRoom: null })).toBeNull()
    expect(reportProblem({ ...base, ownRoom: 2 })).toBeNull()
  })
  it('옆 방은 번호가 하나 차이 (core V8 1–2 … 4–5)', () => {
    expect(isNeighborRoom(2, 1)).toBe(true)
    expect(isNeighborRoom(2, 3)).toBe(true)
    expect(isNeighborRoom(2, 2)).toBe(false)
    expect(isNeighborRoom(2, 4)).toBe(false)
    expect(isNeighborRoom(5, 4)).toBe(true)
  })
  it('어질러짐은 화면에서 방을 막지 않고 core에 맡긴다 (core #96)', () => {
    expect(reportProblem({ ...base, category: 'MESSY' })).toBeNull()
  })
  it('메모가 500자를 넘으면 막는다(앞뒤 공백은 세지 않음)', () => {
    expect(reportProblem({ ...base, content: ` ${'가'.repeat(MAX_REPORT_CONTENT)} ` })).toBeNull()
    expect(reportProblem({ ...base, content: '가'.repeat(MAX_REPORT_CONTENT + 1) })).toContain('500')
  })
})

describe('신고 오류 문구', () => {
  it('신고 정지(core #70)는 정지 안내', () => {
    expect(reportErrorMessage(new ApiError(403, 'REPORT_SUSPENDED', 'x'))).toContain('정지')
  })
  it('어질러짐 조건 거절(core #96)은 각각 안내', () => {
    expect(reportErrorMessage(new ApiError(403, 'REPORT_MESSY_OWN_ROOM_ONLY', 'x'))).toContain('지금 쓰는 방')
    expect(reportErrorMessage(new ApiError(409, 'REPORT_MESSY_TOO_LATE', 'x'))).toContain('5분')
    expect(reportErrorMessage(new ApiError(409, 'REPORT_CHECKIN_PHOTO_REQUIRED', 'x'))).toContain('입실 사진')
  })
  it('내 방 소음 거절(core 400)은 옆 방 안내', () => {
    expect(reportErrorMessage(new ApiError(400, 'REPORT_NOISE_NEIGHBOR_ONLY', 'x'))).toContain('옆 방')
  })
  it('모르는 code는 서버 문구', () => {
    expect(reportErrorMessage(new ApiError(400, 'INVALID_REQUEST', '서버 문구'))).toBe('서버 문구')
  })
})

describe('신고 초안 (입실 사진 올리러 다녀와도 남게)', () => {
  function memStore() {
    const m = new Map<string, string>()
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, removeItem: (k: string) => { m.delete(k) } }
  }
  it('같은 예약이면 되살리고, 다른 예약이거나 지운 뒤면 없다', () => {
    const store = memStore()
    saveReportDraft({ reservationId: 7, roomId: 2, category: 'MESSY', content: '쓰레기' }, store)
    expect(loadReportDraft(7, store)).toEqual({ reservationId: 7, roomId: 2, category: 'MESSY', content: '쓰레기' })
    expect(loadReportDraft(8, store)).toBeNull()
    expect(loadReportDraft(null, store)).toBeNull()
    clearReportDraft(store)
    expect(loadReportDraft(7, store)).toBeNull()
  })
  it('깨진 값이나 모르는 종류는 버린다', () => {
    const store = memStore()
    store.setItem('mspace.reportDraft.v1', '{깨짐')
    expect(loadReportDraft(7, store)).toBeNull()
    store.setItem('mspace.reportDraft.v1', JSON.stringify({ reservationId: 7, roomId: 2, category: 'FIRE', content: 1 }))
    expect(loadReportDraft(7, store)).toEqual({ reservationId: 7, roomId: 2, category: null, content: '' })
  })
})

describe('관리자 신고 배지 (11/13)', () => {
  it('판정하지 않는 소음은 확인 기다림이 아니라 판정 안 함', () => {
    expect(reportBadge({ category: 'NOISE', verdict: 'OPEN' })).toEqual({ key: 'not-judged', label: '판정 안 함' })
    expect(reportBadge({ category: 'MESSY', verdict: 'OPEN' })).toEqual({ key: 'open', label: '확인 기다림' })
    expect(reportBadge({ category: 'BROKEN', verdict: 'UNVERIFIED' })).toEqual({ key: 'unverified', label: '확인 불가' })
  })
})
