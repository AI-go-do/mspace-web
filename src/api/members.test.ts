import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import { DEMO_PROFILE, getMyProfile, profileHead } from './members'

const store = new Map<string, string>()
Object.assign(globalThis, {
  sessionStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
})

const api = vi.hoisted(() => vi.fn())
vi.mock('./client', async (orig) => ({ ...(await orig<typeof import('./client')>()), api }))

afterEach(() => {
  store.clear()
  api.mockReset()
})

describe('마이 탭 머리글 이름·학번', () => {
  it('받으면 이름을 제목으로, 학번을 아래 줄로', () => {
    expect(profileHead({ studentId: '20230001', name: '홍길동' })).toEqual({ title: '홍길동', sub: '학번 20230001' })
  })
  it('못 받았으면 예전처럼 "내 정보"만', () => {
    expect(profileHead(null)).toEqual({ title: '내 정보', sub: null })
  })
  it('학생 인증 전이라 학번이 없으면 학번 줄을 뺀다', () => {
    expect(profileHead({ studentId: null, name: '홍길동' })).toEqual({ title: '홍길동', sub: null })
    expect(profileHead({ studentId: '  ', name: '홍길동' })).toEqual({ title: '홍길동', sub: null })
  })
  it('이름이 비어 오면 제목은 "내 정보"로 둔다', () => {
    expect(profileHead({ studentId: '20230001', name: ' ' })).toEqual({ title: '내 정보', sub: '학번 20230001' })
  })
})

describe('GET /api/members/me', () => {
  it('본인 회원 토큰으로만 부른다', async () => {
    api.mockResolvedValue({ studentId: '20230002', name: '김철수' })
    await expect(getMyProfile(7)).resolves.toEqual({ studentId: '20230002', name: '김철수' })
    expect(api).toHaveBeenCalledWith('/api/members/me', { member: 7 })
  })
  it('보통 화면에서 실패하면 그대로 던진다(가짜 이름을 보여 주지 않는다)', async () => {
    api.mockRejectedValue(new ApiError(404, 'MEMBER_NOT_FOUND', '없음'))
    await expect(getMyProfile(7)).rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' })
  })
  it('예시 화면(?demo=1)에서는 core가 없어도 가짜 회원을 보여 준다', async () => {
    store.set('mspace:demo', '1')
    api.mockRejectedValue(new ApiError(404, 'NOT_FOUND', '없음'))
    await expect(getMyProfile(7)).resolves.toEqual(DEMO_PROFILE)
  })
  it('예시 화면이어도 core가 답하면 진짜 값을 쓴다', async () => {
    store.set('mspace:demo', '1')
    api.mockResolvedValue({ studentId: '20230003', name: '이영희' })
    await expect(getMyProfile(7)).resolves.toEqual({ studentId: '20230003', name: '이영희' })
  })
})
