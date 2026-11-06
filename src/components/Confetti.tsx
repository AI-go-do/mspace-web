import { useEffect, useRef, useState } from 'react'
import { CELEBRATE_EVENT } from '../lib/celebrate'
import { spawnConfetti, stepConfetti, type Piece } from '../lib/confetti'

/** 폭죽이 떠 있는 시간. 끝 0.6초 동안 흐려진다 */
const DURATION_MS = 2600
const FADE_MS = 600

/** 움직임 줄이기를 켠 사람에게는 폭죽을 띄우지 않는다 */
function reducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * 예약 성공 폭죽(11/6 스크럼 "이벤트 당첨된 느낌"). celebrate()가 보내는 신호를 받아
 * 화면 전체 위에 캔버스를 잠깐 깔고 그린다. 누르는 건 막지 않고(pointer-events: none), 끝나면 캔버스를 뺀다.
 * 라이브러리 없이 캔버스로 그려 화면 파일이 거의 늘지 않는다
 */
export default function Confetti() {
  const [run, setRun] = useState(0)
  const canvas = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const go = () => { if (!reducedMotion()) setRun((n) => n + 1) }
    window.addEventListener(CELEBRATE_EVENT, go)
    return () => window.removeEventListener(CELEBRATE_EVENT, go)
  }, [])

  useEffect(() => {
    const el = canvas.current
    if (!run || !el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const width = window.innerWidth
    const height = window.innerHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.width = Math.round(width * dpr)
    el.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const pieces: Piece[] = spawnConfetti(width, height)
    const started = performance.now()
    let last = started
    let frame = 0
    const draw = (t: number) => {
      // 탭을 숨겼다 돌아오면 한꺼번에 크게 움직이지 않게 한 번에 최대 50ms만 간다
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      const age = t - started
      if (age >= DURATION_MS) {
        setRun(0)
        return
      }
      stepConfetti(pieces, dt)
      ctx.clearRect(0, 0, width, height)
      ctx.globalAlpha = age > DURATION_MS - FADE_MS ? (DURATION_MS - age) / FADE_MS : 1
      for (const p of pieces) {
        if (p.y > height + 20) continue
        ctx.save()
        ctx.translate(p.x, p.y)
        ctx.rotate(p.angle)
        // 앞뒤로 뒤집히듯 가로 폭만 줄었다 늘었다
        ctx.scale(Math.cos((age / 1000) * p.flip), 1)
        ctx.fillStyle = p.color
        if (p.round) {
          ctx.beginPath()
          ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2)
          ctx.fill()
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        }
        // 흰 조각이 흰 바탕에서도 보이게 얇은 테두리
        if (p.color === '#ffffff') {
          ctx.strokeStyle = 'rgba(21, 35, 61, 0.18)'
          ctx.lineWidth = 1
          if (p.round) ctx.stroke()
          else ctx.strokeRect(-p.w / 2, -p.h / 2, p.w, p.h)
        }
        ctx.restore()
      }
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    // 다시 터뜨리거나 화면이 사라지면 그리던 것을 멈춘다
    return () => cancelAnimationFrame(frame)
  }, [run])

  if (!run) return null
  return <canvas ref={canvas} className="confetti" aria-hidden="true" />
}
