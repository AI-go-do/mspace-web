import { useRoomBlocks } from '../api/roomBlocks'
import { demoOn } from './demo'
import type { RoomBlock } from './roomBlocks'

const NONE: RoomBlock[] = []

/**
 * 학생 화면에 덮을 막힌 기간. 실제 막힌 칸은 core 빈방 조회가 사유(block·blockedNow, core #103)와 같이 준다.
 * 예시 화면(?demo=1)에서만 관리자 "기간 막기" 탭의 가짜 기록(이 브라우저)을 덮는다. 보통 학생 화면에는 아무것도 덮지 않는다.
 * 학생은 관리자 API를 부를 수 없으므로 목록을 읽지 않는다(load=false)
 */
export function useStudentBlocks(): RoomBlock[] {
  const { blocks } = useRoomBlocks(false)
  return demoOn() ? blocks : NONE
}
