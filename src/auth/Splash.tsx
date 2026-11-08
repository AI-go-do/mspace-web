import Spacey from '../components/Spacey'

/**
 * 로딩 화면이 너무 빨리 사라지면 깜빡임처럼 보여 학생이 "로딩 화면이 없다"고 느낀다(11/8 재웅).
 * 페이지를 연 때부터 이 시간은 로딩 화면을 보여 준다. index.html의 첫 로딩 화면이 보인 시간도 함께 센다.
 */
export const MIN_SPLASH_MS = 800

/** 페이지를 연 때부터 MIN_SPLASH_MS가 지날 때까지 남은 시간 */
export function splashLeftMs(sinceOpenMs: number, min = MIN_SPLASH_MS): number {
  return Math.max(0, Math.ceil(min - sinceOpenMs))
}

/** 페이지를 연 때부터 MIN_SPLASH_MS가 지날 때까지 기다린다 */
export function waitMinSplash(): Promise<void> {
  const left = splashLeftMs(performance.now())
  return left === 0 ? Promise.resolve() : new Promise((r) => setTimeout(r, left))
}

/**
 * 앱을 열 때 자동 로그인을 확인하는 동안 보이는 화면 (FR-AUTH-002). 로그인 화면이 깜빡이지 않게 한다.
 * index.html의 첫 로딩 화면과 모양이 같아서, 스크립트가 다 받아져 이 화면으로 바뀌어도 이어져 보인다.
 */
export default function Splash() {
  return (
    <main className="splash" aria-busy="true">
      <Spacey size={88} />
      <span className="splash-name">M-space</span>
      <span className="splash-sub" role="status">
        자동 로그인 중
        <span className="typing" aria-hidden="true"><i /><i /><i /></span>
      </span>
    </main>
  )
}
