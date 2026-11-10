import { useEffect, useState } from 'react'

/**
 * 오디가 판단해 가는 단계를 차례로 보여 준다. 시연(sample)에서는 몇 초씩 걸어 가며 움직이고,
 * 실제 값일 때는 정해진 단계(at)에 멈춰 있다. last가 'live'면 마지막 단계는 끝나지 않고 계속 도는 일(다시 확인)이다
 */
export function Steps({ steps, sample, at: fixedAt, ms, label, live }: { steps: string[]; sample: boolean; at: number; ms: number[]; label: string; live?: boolean }) {
  const [step, setStep] = useState(sample ? 0 : fixedAt)
  useEffect(() => {
    if (!sample) { setStep(fixedAt); return }
    setStep(0)
    const timers = ms.slice(1, steps.length).map((t, i) => setTimeout(() => setStep(i + 1), t))
    return () => timers.forEach(clearTimeout)
  }, [sample, fixedAt, steps.length, ms])
  const last = steps.length - 1
  const cls = (k: number) => (k < step || (k === step && k === last && !live) ? 's-done' : k === step ? 's-now' : 's-next')
  return (
    <ol className="ca-steps" aria-label={label}>
      {steps.map((t, k) => (
        <li key={k} className={cls(k)}>
          <i aria-hidden="true" />{t}{cls(k) === 's-now' && <span className="sr-only"> (진행 중)</span>}
        </li>
      ))}
    </ol>
  )
}

export const STEP_MS = [0, 1800, 3600, 6000]

/** 시간 넘김처럼 오디가 끝까지 스스로 판단하는 일. 경고 매기기는 core 규칙이 없어 시연 값에서만 끝까지 간다 */
export function Judge({ steps, sample }: { steps: string[]; sample: boolean }) {
  const shown = sample ? steps : steps.slice(0, -1)
  return (
    <div className="cf-steps">
      <Steps steps={shown} sample={sample} at={shown.length - 1} ms={STEP_MS} label="오디가 판단하는 과정" live={!sample} />
      {sample && <small className="ca-note">시연: 경고까지 기다리는 시간은 팀 규칙 전 임시 값이에요.</small>}
    </div>
  )
}

