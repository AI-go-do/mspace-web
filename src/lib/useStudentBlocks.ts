import { useRoomBlocks } from '../api/roomBlocks'
import { demoOn } from './demo'
import type { RoomBlock } from './roomBlocks'

const NONE: RoomBlock[] = []

/**
 * 학생 화면에 덮을 막힌 기간. core가 빈방 조회에 사유를 넣어 주기 전까지는 예시 화면(?demo=1)에서만
 * 관리자 "기간 막기" 탭의 가짜 기록(이 브라우저)을 쓴다. 보통 학생 화면에는 아무것도 덮지 않는다
 */
export function useStudentBlocks(): RoomBlock[] {
  const { blocks } = useRoomBlocks()
  return demoOn() ? blocks : NONE
}
