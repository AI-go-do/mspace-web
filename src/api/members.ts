import { demoOn } from '../lib/demo'
import { api } from './client'

/** GET /api/members?studentId= 응답. 이름은 가려서 온다(홍*동) */
export interface FoundMember {
  studentId: string
  name: string
  /** 찾은 사람이 로그인한 본인(대표자)인지 (core #66). 그 전 core에는 없어서 선택 값 */
  me?: boolean
}

/** 참여자 학번 검색 (FR-RSV-004). 없거나 학생 인증 전이면 404 MEMBER_NOT_FOUND */
export function findMember(studentId: string): Promise<FoundMember> {
  return api(`/api/members?studentId=${encodeURIComponent(studentId)}`)
}

/**
 * GET /api/members/me 응답 (core #102, 마이 탭 머리글). 본인 것이라 이름을 가리지 않는다.
 * 학생 인증 전이면 학번이 null일 수 있다
 */
export interface MyProfile {
  studentId: string | null
  name: string
}

/** ?demo=1 예시 화면에서 core가 없거나 실패할 때 보여 줄 가짜 회원(실제 학생 정보 아님) */
export const DEMO_PROFILE: MyProfile = { studentId: '20230001', name: '홍길동' }

/**
 * 로그인한 본인의 학번·이름. 401 로그인 안 함 / 404 MEMBER_NOT_FOUND.
 * member를 주면 다른 탭에서 다른 회원으로 바뀐 토큰으로는 보내지 않는다(공용 폰에서 남의 이름이 보이지 않게)
 */
export function getMyProfile(member?: number | null): Promise<MyProfile> {
  const real = api<MyProfile>('/api/members/me', { member })
  if (!demoOn()) return real
  // 예시 화면: core가 없거나(아직 #102 전) 실패해도 머리글이 비지 않게 가짜 회원을 보여 준다
  return real.catch(() => DEMO_PROFILE)
}

/**
 * 마이 탭 머리글 글. 못 받았으면(null) 예전처럼 "내 정보"만, 받았으면 이름을 크게·학번을 작게.
 * 이름이 비어 오면 제목은 "내 정보"로, 학번이 없으면(학생 인증 전) 학번 줄을 뺀다
 */
export function profileHead(p: MyProfile | null): { title: string; sub: string | null } {
  const name = p?.name?.trim()
  const id = p?.studentId?.trim()
  return { title: name || '내 정보', sub: id ? `학번 ${id}` : null }
}
