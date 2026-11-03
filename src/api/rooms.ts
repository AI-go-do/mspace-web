import { api } from './client'
import { mockAvailability } from './mock'

// GET /api/rooms/availability?date=YYYY-MM-DD 응답 (core RoomAvailabilityService.DayAvailability)
export interface Slot {
  startAt: string
  endAt: string
  available: boolean
}
export interface RoomSlots {
  roomId: number
  roomName: string
  minPeople: number
  maxPeople: number
  slots: Slot[]
}
export interface DayAvailability {
  date: string
  slotMinutes: number
  rooms: RoomSlots[]
}

export interface Loaded<T> {
  data: T
  /** 서버에 닿지 못해 예시 데이터를 보여 주는 중인지 */
  sample: boolean
}

const useMock = import.meta.env.VITE_API_MOCK === 'true'

export async function getAvailability(date: string): Promise<Loaded<DayAvailability>> {
  if (useMock) return { data: mockAvailability(date), sample: true }
  try {
    const data = await api<DayAvailability>(`/api/rooms/availability?date=${date}`)
    return { data, sample: false }
  } catch (e) {
    // 개발 중 core가 안 떠 있어도 화면을 볼 수 있게 예시로 대신한다(화면에 '예시' 표시)
    if (import.meta.env.DEV) return { data: mockAvailability(date), sample: true }
    throw e
  }
}
