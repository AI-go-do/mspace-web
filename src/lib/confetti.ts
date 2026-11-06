/** 폭죽 조각 하나. 위치·속도는 CSS 픽셀, 각도는 라디안 */
export interface Piece {
  x: number
  y: number
  vx: number
  vy: number
  angle: number
  spin: number
  /** 앞뒤로 뒤집히는 빠르기(종이가 팔랑이는 느낌) */
  flip: number
  w: number
  h: number
  color: string
  round: boolean
}

/** 앱 색(tokens.css)만 쓴다: 파랑·하늘·노랑·흰색 */
export const CONFETTI_COLORS = ['#0a4da2', '#7dbbff', '#ffc53d', '#ffffff', '#ffc53d', '#7dbbff']

/** 아래 기운 쪽(중력, px/s²) */
const GRAVITY = 1400
/** 공기 저항(1초에 남는 속도 비율) */
const DRAG = 0.35

/**
 * 화면 아래 왼쪽·오른쪽 모서리에서 가운데 위로 쏘아 올리는 조각들.
 * rand를 넘기면 테스트에서 같은 결과가 나온다
 */
export function spawnConfetti(width: number, height: number, count = 140, rand: () => number = Math.random): Piece[] {
  const out: Piece[] = []
  for (let i = 0; i < count; i++) {
    const left = i % 2 === 0
    // 왼쪽은 오른쪽 위로, 오른쪽은 왼쪽 위로(위쪽 기준 20°–45° 기울게)
    const tilt = (20 + rand() * 25) * (Math.PI / 180)
    const speed = height * (1.5 + rand() * 0.9)
    out.push({
      x: left ? -10 : width + 10,
      y: height * (0.82 + rand() * 0.1),
      vx: (left ? 1 : -1) * Math.sin(tilt) * speed,
      vy: -Math.cos(tilt) * speed,
      angle: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 14,
      flip: 6 + rand() * 10,
      w: 6 + rand() * 6,
      h: 8 + rand() * 8,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)],
      round: rand() < 0.25,
    })
  }
  return out
}

/** dt초만큼 움직인다(조각을 그 자리에서 바꾼다) */
export function stepConfetti(pieces: Piece[], dt: number): void {
  const keep = Math.pow(DRAG, dt)
  for (const p of pieces) {
    p.vx *= keep
    p.vy = p.vy * keep + GRAVITY * dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.angle += p.spin * dt
  }
}
