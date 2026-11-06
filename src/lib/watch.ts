import { useCallback, useEffect, useState } from 'react'
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

/** 지켜보는 방 목록과 켜고 끄기. 회원이나 날짜가 바뀌면 그 렌더에서 바로 그 회원·그 날의 목록으로 바꾼다 */
export function useWatched(member: number | null, now: Date): { watched: number[]; toggle: (roomId: number) => void; unwatch: (roomId: number) => void } {
  const today = seoulDate(now)
  const scope = `${member ?? 'anon'}|${today}`
  const [state, setState] = useState(() => ({ scope, rooms: read(member, today) }))
  // 회원·날짜가 바뀐 렌더에서 앞 회원(또는 어제) 목록을 한 번도 내주지 않게, 효과를 기다리지 않고 렌더 중에 바꾼다
  // (앞 목록으로 "방이 비었어요" 카드나 진동이 나가지 않게)
  let watched = state.rooms
  if (state.scope !== scope) {
    watched = read(member, today)
    setState({ scope, rooms: watched })
  }
  // 바꾸는 기준은 화면 상태다(저장소를 못 쓰면 다시 읽어도 비어 있으므로). 함수형 갱신이라 연달아 눌러도 앞 변경을 잃지 않는다
  const update = useCallback((change: (rooms: number[]) => number[]) => {
    setState((prev) => {
      const base = prev.scope === scope ? prev.rooms : read(member, today)
      const next = change(base)
      write(member, today, next)
      return { scope, rooms: next }
    })
  }, [member, today, scope])
  // 다른 탭에서 바꾸면 이 탭도 따라간다(서로 앞 목록으로 덮어써 지운 방이 되살아나거나 켠 방이 사라지지 않게)
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY(member) && e.key !== null) return
      setState({ scope, rooms: read(member, today) })
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [member, today, scope])
  const toggle = useCallback((roomId: number) => update((rooms) => toggled(rooms, roomId)), [update])
  const unwatch = useCallback((roomId: number) => update((rooms) => rooms.filter((r) => r !== roomId)), [update])
  return { watched, toggle, unwatch }
}
