import Spacey from '../components/Spacey'

/** 앱을 열 때 로그인 상태를 확인하는 동안 보이는 화면. 로그인 화면이 깜빡이지 않게 한다 */
export default function Splash() {
  return (
    <main className="splash" aria-busy="true">
      <Spacey size={88} />
      <span className="splash-name">M-space</span>
      <span className="splash-sub" role="status">확인하는 중…</span>
    </main>
  )
}
