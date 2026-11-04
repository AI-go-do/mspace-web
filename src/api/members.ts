import { api } from './client'

/** GET /api/members?studentId= 응답. 이름은 가려서 온다(홍*동) */
export interface FoundMember {
  studentId: string
  name: string
}

/** 참여자 학번 검색 (FR-RSV-004). 없거나 학생 인증 전이면 404 MEMBER_NOT_FOUND */
export function findMember(studentId: string): Promise<FoundMember> {
  return api(`/api/members?studentId=${encodeURIComponent(studentId)}`)
}
