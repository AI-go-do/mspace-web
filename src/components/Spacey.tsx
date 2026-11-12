/** 마스코트 새(7.6). 11/12부터 비서 "오디"의 얼굴도 이 그림(Odi.tsx). 부리 노랑(#F2B705)이 4색 규칙의 유일한 예외 */
export default function Spacey({ size = 104, ring = '#FFFFFF', label = '오디' }: { size?: number; ring?: string; label?: string }) {
  const brand = '#0A4DA2'
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role={label ? 'img' : undefined}
      aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <circle cx="50" cy="15" r="7" fill="none" stroke={ring} strokeWidth="8" />
      <circle cx="50" cy="15" r="7" fill="none" stroke={brand} strokeWidth="4" />
      <path d="M50 22 V32 M50 27 H56" fill="none" stroke={brand} strokeWidth="4" strokeLinecap="round" />
      <ellipse cx="50" cy="60" rx="34" ry="32" fill={brand} stroke={ring} strokeWidth="3" />
      <ellipse cx="50" cy="73" rx="19" ry="14" fill="#FFFFFF" />
      <circle cx="38" cy="48" r="8" fill="#FFFFFF" />
      <circle cx="62" cy="48" r="8" fill="#FFFFFF" />
      <circle cx="40" cy="49" r="4" fill="#15233D" />
      <circle cx="64" cy="49" r="4" fill="#15233D" />
      <path d="M45 57 H55 L50 63 Z" fill="#F2B705" stroke="#F2B705" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  )
}
