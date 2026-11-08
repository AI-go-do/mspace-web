import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { clearReportDraft, loadReportDraft, MAX_REPORT_CONTENT, reportErrorMessage, reportProblem, saveReportDraft } from './reports'

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
  it('어질러짐은 지금 쓰는 방이 아니면 막고, 쓰는 방을 모르면 core에 맡긴다 (core #96)', () => {
    const messy = { ...base, category: 'MESSY' as const }
    expect(reportProblem({ ...messy, ownRoomId: 3 })).toContain('지금 쓰는 방')
    expect(reportProblem({ ...messy, ownRoomId: 2 })).toBeNull()
    expect(reportProblem({ ...messy, ownRoomId: null })).toBeNull()
    expect(reportProblem({ ...base, ownRoomId: 3 })).toBeNull()
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
