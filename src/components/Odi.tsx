import './Odi.css'

/**
 * 비서 "오디" 얼굴(11/10 재웅 시안). 파란 동그라미 안에 흰 오디 열매, 초록 꼭지.
 * badge가 있으면 오른쪽 위에 주황 숫자(오디가 먼저 챙긴 것 수)를 단다
 */
export default function Odi({ size = 44, badge = 0, label = '' }: { size?: number; badge?: number; label?: string }) {
  const berries: [number, number][] = [[43, 37], [57, 37], [36, 47], [50, 47], [64, 47], [42, 58], [58, 58], [50, 68]]
  return (
    <span className="odi" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox="0 0 100 100" role={label ? 'img' : undefined}
        aria-label={label || undefined} aria-hidden={label ? undefined : true}>
        <circle cx="50" cy="50" r="50" fill="#0A4DA2" />
        <path d="M50 30 C51 25 54 21 59 19" fill="none" stroke="#3FA34D" strokeWidth="4" strokeLinecap="round" />
        <path d="M55 22 C60 16 68 17 70 20 C66 24 60 25 55 22 Z" fill="#3FA34D" />
        {berries.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="8.5" fill="#FFFFFF" />)}
        <circle cx="45" cy="50" r="2.4" fill="#15233D" />
        <circle cx="55" cy="50" r="2.4" fill="#15233D" />
        <path d="M46 56 Q50 59.5 54 56" fill="none" stroke="#15233D" strokeWidth="2" strokeLinecap="round" />
      </svg>
      {badge > 0 && <span className="odi-badge" aria-hidden="true">{badge > 9 ? '9+' : badge}</span>}
    </span>
  )
}
