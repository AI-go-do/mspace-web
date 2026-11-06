import { describe, expect, it } from 'vitest'
import { ApiError } from './client'
import { MAX_REPORT_CONTENT, reportErrorMessage, reportProblem } from './reports'

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
  it('메모가 500자를 넘으면 막는다(앞뒤 공백은 세지 않음)', () => {
    expect(reportProblem({ ...base, content: ` ${'가'.repeat(MAX_REPORT_CONTENT)} ` })).toBeNull()
    expect(reportProblem({ ...base, content: '가'.repeat(MAX_REPORT_CONTENT + 1) })).toContain('500')
  })
})

describe('신고 오류 문구', () => {
  it('신고 정지(core #70)는 정지 안내', () => {
    expect(reportErrorMessage(new ApiError(403, 'REPORT_SUSPENDED', 'x'))).toContain('정지')
  })
  it('모르는 code는 서버 문구', () => {
    expect(reportErrorMessage(new ApiError(400, 'INVALID_REQUEST', '서버 문구'))).toBe('서버 문구')
  })
})
