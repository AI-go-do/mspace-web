import Spacey from './Spacey'
import './Odi.css'

/**
 * 비서 "오디" 얼굴. 11/12 재웅 요청으로 예전에 쓰던 새(머리에 안테나, 파란 몸, 흰 배, 노란 부리)로 되돌렸다.
 * 그림은 Spacey와 같다(로그인·입실·PWA 아이콘과 한 캐릭터).
 * badge가 있으면 오른쪽 위에 주황 숫자(오디가 먼저 챙긴 것 수)를 단다
 */
export default function Odi({ size = 44, badge = 0, label = '' }: { size?: number; badge?: number; label?: string }) {
  return (
    <span className="odi" style={{ width: size, height: size }}>
      <Spacey size={size} label={label} />
      {badge > 0 && <span className="odi-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}
    </span>
  )
}
