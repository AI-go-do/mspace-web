import { useCallback, useEffect, useRef, useState } from 'react'
import { seoulDate } from './time'

/**
 * "빈방 지켜보기" (11/6 2차 시안): 사용 중인 방에 눈 표시를 켜 두면, 홈이 1분마다 받는 현황에서 그 방이 비는 순간
 * 비서 카드가 먼저 "창작실 N이 비었어요"라고 말을 건다. 서버 푸시 없이 화면이 가진 자료로만 한다(core 변경 없음).
 * 목록은 이 폰에만, 회원 번호별로, 오늘 하루만 둔다(날이 바뀌면 비운다). 개인정보는 없고 방 번호뿐이다
 */
export interface WatchList {
  date: string
  rooms: number[]
}

const KEY = (member: number | null) => `mspace:watch:${member ?? 'anon'}`

function read(member: number | null, today: string): number[] {
  try {
    const raw = localStorage.getItem(KEY(member))
    if (!raw) return []
    const parsed = JSON.parse(raw) as Partial<WatchList>
    if (parsed.date !== today || !Array.isArray(parsed.rooms)) return []
    return parsed.rooms.filter((n): n is number => Number.isInteger(n) && n > 0)
  } catch {
    return []
  }
}

function write(member: number | null, today: string, rooms: number[]): void {
  try {
    if (rooms.length === 0) localStorage.removeItem(KEY(member))
    else localStorage.setItem(KEY(member), JSON.stringify({ date: today, rooms } satisfies WatchList))
  } catch { /* 저장소를 못 쓰면(사생활 모드) 이 화면에서만 기억한다 */ }
}

/** 오늘 지켜보는 방 번호. 저장소를 못 써도 화면이 열려 있는 동안은 동작한다 */
export function loadWatched(member: number | null, now = new Date()): number[] {
  return read(member, seoulDate(now))
}

/** 켜져 있으면 끄고, 꺼져 있으면 켠 새 목록 */
export function toggled(rooms: number[], roomId: number): number[] {
  return rooms.includes(roomId) ? rooms.filter((r) => r !== roomId) : [...rooms, roomId].sort((a, b) => a - b)
}

/** 지켜보는 방 목록과 켜고 끄기. 회원이 바뀌면 그 회원의 목록으로 바꾼다 */
export function useWatched(member: number | null, now: Date): { watched: number[]; toggle: (roomId: number) => void; unwatch: (roomId: number) => void } {
  const today = seoulDate(now)
  const [watched, setWatched] = useState<number[]>(() => read(member, today))
  // 지금 목록은 화면 상태가 기준이다(저장소를 못 쓰면 다시 읽어도 비어 있으므로). 연달아 눌러도 앞 변경을 잃지 않게 ref로 최신 값을 든다
  const current = useRef(watched)
  useEffect(() => {
    const next = read(member, today)
    current.current = next
    setWatched(next)
  }, [member, today])
  const save = useCallback((next: number[]) => {
    current.current = next
    setWatched(next)
    write(member, today, next)
  }, [member, today])
  const toggle = useCallback((roomId: number) => save(toggled(current.current, roomId)), [save])
  const unwatch = useCallback((roomId: number) => save(current.current.filter((r) => r !== roomId)), [save])
  return { watched, toggle, unwatch }
}
