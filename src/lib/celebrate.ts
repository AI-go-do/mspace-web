/** 폭죽을 터뜨리라는 신호 이름. 화면이 바뀌어도 앱 맨 위의 <Confetti />가 받는다 */
export const CELEBRATE_EVENT = 'mspace:celebrate'

/**
 * 예약 성공 폭죽(11/6 스크럼 결정). 화면을 옮기기 직전에 불러도 된다:
 * 폭죽은 화면과 따로 앱 맨 위에서 그려져 새 화면 위로 이어진다
 */
export function celebrate(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(CELEBRATE_EVENT))
}
