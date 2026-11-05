import { api, ApiError } from './client'
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
  /**
   * 지금 이 방에 끝나지 않은 예약이 걸쳐 있는지 (core #54). 지금 시각이 든 칸은 지난 칸이라
   * available만으로는 알 수 없어서 따로 온다. 예전 core·예시 데이터에는 없어서 선택 값
   */
  occupiedNow?: boolean
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

export async function getAvailability(date: string, signal?: AbortSignal): Promise<Loaded<DayAvailability>> {
  if (useMock) return { data: mockAvailability(date), sample: true }
  try {
    const data = await api<DayAvailability>(`/api/rooms/availability?date=${date}`, { signal })
    return { data, sample: false }
  } catch (e) {
    // 부른 쪽이 끊은 요청(시간 초과·화면 떠남)은 예시로 바꾸지 않고 그대로 던진다
    if (signal?.aborted) throw e
    // 개발 중 core가 안 떠 있어도 화면을 볼 수 있게 예시로 대신한다(화면에 '예시' 표시).
    // core에 닿지 못한 경우만: 네트워크 오류, 또는 Vite 개발 프록시의 502. 401·403 등은 그대로 보여 준다.
    const coreUnreachable = !(e instanceof ApiError) || e.status === 502
    if (import.meta.env.DEV && coreUnreachable) return { data: mockAvailability(date), sample: true }
    throw e
  }
}
