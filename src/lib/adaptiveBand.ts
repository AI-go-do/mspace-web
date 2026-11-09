/**
 * 자동 기준(재웅 11/9): 고정 숫자 대신 방마다·센서마다 "평소 값"을 배워 위아래 선을 긋고,
 * 값이 그 선 밖에 오래 머물 때만 알린다. 실제 값이 오는 화면(dev·운영)은 실제 값으로, ?demo=1은 가짜 값으로 계산한다.
 *
 * 1. 튐 거르기: 앞뒤 값과 둘 다 크게 다르고 같은 쪽으로 혼자 뛴 값은 "튐"으로 보고 계산에서 뺀다
 * 2. 평소 값: 최근 몇 시간(마지막 sustain분은 빼고) 값의 가운데값. 평균보다 튀는 값에 덜 흔들린다
 * 3. 폭: 흔들림 폭(MAD × 1.4826 ≈ 표준편차)의 k배. 너무 좁으면 최소 폭을 쓴다
 * 4. 사람이 있을 때와 없을 때를 따로 배운다(사람이 있으면 CO2가 오르는 게 정상이라). 한쪽 값이 모자라면 둘 다 섞는다
 * 5. 알림: 튐이 아닌 값이 sustain분 넘게 계속 같은 쪽 선 밖이면
 * 숫자(k·최소 폭·sustain)는 config/adminRooms ADAPTIVE_RULES에서만 고친다
 */

export type AdaptiveMetric = 'co2' | 'temp' | 'hum' | 'light'

export interface AdaptiveRules {
  /** 기준을 정하는 데 필요한 최소 값 개수(분). 모자라면 "기준 배우는 중" */
  minSamples: number
  /** 흔들림 폭의 몇 배를 선으로 쓸지 */
  k: number
  /** 선 밖에 이만큼(분) 머물러야 알린다 */
  sustainMinutes: number
  /** 선 폭의 절반 최솟값 */
  floor: Record<AdaptiveMetric, number>
  /** 앞뒤 값과 이만큼 넘게 다르면 튐 */
  spike: Record<AdaptiveMetric, number>
}

export interface Band {
  median: number
  lo: number
  hi: number
  /** 기준에 쓴 값 개수 */
  samples: number
  /** 어떤 값으로 배웠나: 사람 있을 때만·없을 때만·섞어서 */
  basis: 'occupied' | 'empty' | 'all'
}

export interface Deviation {
  dir: 'high' | 'low'
  /** 지금 값 - 평소 값 */
  diff: number
  /** 선 밖에 머문 분 */
  minutes: number
}

export interface Adaptive {
  band: Band | null
  /** values와 같은 길이. 튐이면 true */
  spikes: boolean[]
  deviation: Deviation | null
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** 앞뒤 가장 가까운 값과 둘 다 jump 넘게 다르고, 같은 쪽으로 뛴 값. 맨 앞·맨 뒤는 판단하지 않는다(다음 값이 와야 안다) */
export function findSpikes(values: (number | null)[], jump: number): boolean[] {
  const out = values.map(() => false)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v === null) continue
    let p = i - 1
    while (p >= 0 && values[p] === null) p--
    let n = i + 1
    while (n < values.length && values[n] === null) n++
    if (p < 0 || n >= values.length) continue
    const a = v - (values[p] as number)
    const b = v - (values[n] as number)
    if (Math.abs(a) > jump && Math.abs(b) > jump && Math.sign(a) === Math.sign(b)) out[i] = true
  }
  return out
}

export function adaptive(
  metric: AdaptiveMetric,
  values: (number | null)[],
  occupancy: (boolean | null)[],
  occupiedNow: boolean | null,
  rules: AdaptiveRules,
): Adaptive {
  const spikes = findSpikes(values, rules.spike[metric])
  const learnEnd = Math.max(0, values.length - rules.sustainMinutes)
  const pick = (want: boolean | null) => {
    const xs: number[] = []
    for (let i = 0; i < learnEnd; i++) {
      const v = values[i]
      if (v === null || spikes[i]) continue
      if (want !== null && occupancy[i] !== want) continue
      xs.push(v)
    }
    return xs
  }
  let basis: Band['basis'] = 'all'
  let xs: number[] = []
  if (occupiedNow !== null) {
    xs = pick(occupiedNow)
    basis = occupiedNow ? 'occupied' : 'empty'
  }
  if (xs.length < rules.minSamples) { xs = pick(null); basis = 'all' }
  if (xs.length < rules.minSamples) return { band: null, spikes, deviation: null }

  const med = median(xs)
  const mad = median(xs.map((x) => Math.abs(x - med))) * 1.4826
  const half = Math.max(rules.k * mad, rules.floor[metric])
  let lo = med - half
  let hi = med + half
  if (metric === 'light' || metric === 'hum') { lo = Math.max(0, lo); hi = Math.min(100, hi) }
  const band: Band = { median: med, lo, hi, samples: xs.length, basis }

  // 끝에서부터 튐이 아닌 값이 같은 쪽 선 밖으로 이어진 분
  let dir: Deviation['dir'] | null = null
  let minutes = 0
  let latest: number | null = null
  for (let i = values.length - 1; i >= 0; i--) {
    const v = values[i]
    if (v === null) break
    if (spikes[i]) { minutes++; continue }
    const side = v > hi ? 'high' : v < lo ? 'low' : null
    if (side === null || (dir !== null && side !== dir)) break
    dir = side
    if (latest === null) latest = v
    minutes++
  }
  const deviation = dir !== null && latest !== null && minutes >= rules.sustainMinutes
    ? { dir, diff: latest - med, minutes } : null
  return { band, spikes, deviation }
}
