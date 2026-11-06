import type { DayAvailability } from './rooms'

// 시안과 같은 예시: [방, 시작 시, 끝 시] (30분은 .5)
const BOOKED: [number, number, number][] = [
  [5, 15, 17], [5, 21.5, 23.5],
  [4, 20, 22],
  [3, 14, 16], [3, 18, 20.5],
  [2, 10, 12], [2, 16, 18],
  [1, 13, 15], [1, 19, 21],
]

export function mockAvailability(date: string, now = new Date()): DayAvailability {
  const dayStart = new Date(`${date}T00:00:00+09:00`)
  const nowH = (now.getTime() - dayStart.getTime()) / 3_600_000
  const rooms = [1, 2, 3, 4, 5].map((id) => ({
    roomId: id,
    // 예시에도 지금 사용 여부를 넣는다(없으면 화면이 '상태 확인 중'으로 본다)
    occupiedNow: BOOKED.some(([r, a, b]) => r === id && nowH >= a && nowH < b),
    roomName: `창작실 ${id}`,
    minPeople: id === 5 ? 5 : 3,
    maxPeople: id === 5 ? 8 : 5,
    slots: Array.from({ length: 48 }, (_, i) => {
      const s = new Date(dayStart.getTime() + i * 30 * 60_000)
      const e = new Date(s.getTime() + 30 * 60_000)
      const h = i / 2
      const taken = BOOKED.some(([r, a, b]) => r === id && h >= a && h < b)
      return { startAt: s.toISOString(), endAt: e.toISOString(), available: s >= now && !taken }
    }),
  }))
  return { date, slotMinutes: 30, rooms }
}
