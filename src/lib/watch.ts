import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { getMyWatches, unwatchRoom, watchApiOn, watchRoom, WATCH_FREE } from '../api/roomWatches'
import { seoulDate } from './time'

/**
 * "빈방 지켜보기" (11/6 2차 시안): 사용 중인 방에 눈 표시를 켜 두면, 홈이 1분마다 받는 현황에서 그 방이 비는 순간
 * 비서 카드가 먼저 "창작실 N이 비었어요"라고 말을 건다. 목록은 이 폰에도, 회원 번호별로, 오늘 하루만 둔다(날이 바뀌면 비운다).
 * 개인정보는 없고 방 번호뿐이다.
 * core 빈방 알림(#109, api/roomWatches.ts)을 쓰는 빌드면 켜고 끄기를 core에도 보낸다. 그러면 앱을 닫아 둬도 알림함으로 온다.
 * 화면 목록은 이 폰 목록이 기준이다: core는 알린 방을 목록에서 빼지만, 화면은 학생이 비서 카드를 누를 때까지 그 방을 들고 있어야
 * 카드가 남는다. 그래서 core 목록은 이 폰 목록에 더하기만 한다(다른 기기에서 켠 방)
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

/** core에 켜 둔 방을 이 폰 목록에 더한 새 목록. 지금 누르는 중인 방(skip)은 누른 쪽을 따라 건드리지 않는다 */
export function withServer(rooms: number[], server: number[], skip: ReadonlySet<number> = new Set()): number[] {
  const add = server.filter((id) => Number.isInteger(id) && id > 0 && !skip.has(id) && !rooms.includes(id))
  return add.length ? [...rooms, ...add].sort((a, b) => a - b) : rooms
}

/** 두 시점의 방별 누른 차례를 견줘, 그사이 한 번이라도 누른 방 */
export function changedRooms(before: ReadonlyMap<number, number>, after: ReadonlyMap<number, number>): number[] {
  return [...after].filter(([id, turn]) => before.get(id) !== turn).map(([id]) => id)
}

/** core에 켜기(on)·끄기를 못 보냈을 때 그 방만 누르기 전으로 되돌린 새 목록 */
export function reverted(rooms: number[], roomId: number, on: boolean): number[] {
  if (on) return rooms.filter((r) => r !== roomId)
  return rooms.includes(roomId) ? rooms : toggled(rooms, roomId)
}

/** 서버에 켜고 끄기를 못 했을 때 화면에 보일 말 */
const WATCH_FAILED = '알림 켜기·끄기를 서버에 보내지 못했어요. 잠시 후 다시 눌러 주세요'

/**
 * 지켜보는 방 목록과 켜고 끄기. 회원이나 날짜가 바뀌면 그 렌더에서 바로 그 회원·그 날의 목록으로 바꾼다.
 * core 빈방 알림을 쓰는 빌드면 켜고 끄기를 core에도 보내고, 못 보내면 눈 표시를 되돌리고 error로 알린다
 */
export function useWatched(member: number | null, now: Date): { watched: number[]; toggle: (roomId: number) => void; unwatch: (roomId: number) => void; error: string | null } {
  const today = seoulDate(now)
  const scope = `${member ?? 'anon'}|${today}`
  const [state, setState] = useState(() => ({ scope, rooms: read(member, today) }))
  const [failure, setFailure] = useState<{ scope: string; message: string } | null>(null)
  // 회원·날짜가 바뀐 렌더에서 앞 회원(또는 어제) 목록을 한 번도 내주지 않게, 효과를 기다리지 않고 렌더 중에 바꾼다
  // (앞 목록으로 "방이 비었어요" 카드나 진동이 나가지 않게)
  let watched = state.rooms
  if (state.scope !== scope) {
    watched = read(member, today)
    setState({ scope, rooms: watched })
  }
  // 누를 때 켜는지 끄는지 정하려고 지금 목록을 들고 있는다
  // 그린 뒤 맞추고(렌더 중에 ref를 쓰지 않게), 다시 그리기 전에 누른 것은 toggle이 바로 맞춘다
  const latest = useRef(watched)
  useEffect(() => { latest.current = watched }, [watched])
  // 방마다 마지막으로 누른 차례. 앞 요청이 늦게 실패해도 그 뒤에 다시 누른 것을 되돌리지 않게, 서버 목록이 방금 누른 것을 덮지 않게 쓴다
  const turns = useRef(new Map<number, number>())
  const pending = useRef(new Set<number>())

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
  // core에 켜 둔 방(다른 기기에서 켠 것 포함)을 이 폰 목록에 더한다. 회원·날짜가 바뀔 때마다 다시 받는다.
  // 받는 사이 학생이 누른 방은 누른 쪽을 따른다
  useEffect(() => {
    if (member === null || !watchApiOn()) return
    const ctrl = new AbortController()
    // 받기 시작할 때의 누른 차례. 받는 사이 누른 방(이미 끝난 요청 포함)은 받은 목록이 옛 상태라 건드리지 않는다
    const before = new Map(turns.current)
    getMyWatches(member, ctrl.signal)
      .then((list) => {
        const server = list.map((w) => w.roomId)
        const skip = new Set([...pending.current, ...changedRooms(before, turns.current)])
        update((rooms) => withServer(rooms, server, skip))
      })
      .catch(() => undefined) // 못 받으면 이 폰 목록만 보인다(켜고 끄기는 그대로 core로 간다)
    return () => ctrl.abort()
  }, [member, update])

  /** core에 보내고, 못 보내면 그 방만 누르기 전으로 되돌린다(그 뒤에 다시 눌렀으면 그대로 둔다) */
  const send = useCallback((roomId: number, on: boolean) => {
    if (member === null || !watchApiOn()) return
    const turn = (turns.current.get(roomId) ?? 0) + 1
    turns.current.set(roomId, turn)
    pending.current.add(roomId)
    setFailure(null)
    const done = () => { if (turns.current.get(roomId) === turn) pending.current.delete(roomId) }
    ;(on ? watchRoom(member, roomId).then(() => undefined) : unwatchRoom(member, roomId))
      .then(done, (e: unknown) => {
        done()
        // 켜려는데 이미 비어 있음: 비서 카드가 바로 "비었어요"라고 하므로 켠 채로 둔다
        if (on && e instanceof ApiError && e.code === WATCH_FREE) return
        if (turns.current.get(roomId) !== turn) return
        update((rooms) => reverted(rooms, roomId, on))
        setFailure({ scope, message: WATCH_FAILED })
      })
  }, [member, update, scope])

  const toggle = useCallback((roomId: number) => {
    const on = !latest.current.includes(roomId)
    // 다시 그리기 전에 두 번 눌러도 두 번째는 끄기로 보내게 바로 맞춘다
    latest.current = toggled(latest.current, roomId)
    update((rooms) => toggled(rooms, roomId))
    send(roomId, on)
  }, [update, send])
  // 비서 카드 [지금 바로 쓰기]: 이 폰 목록에서 빼고 core에도 끈다. 못 꺼도 되돌리지 않는다
  // (방이 이미 비었으니 core는 많아야 한 번 알리고 끝난다. 카드를 다시 띄우면 학생이 방금 누른 것을 무른 셈이 된다)
  const unwatch = useCallback((roomId: number) => {
    update((rooms) => rooms.filter((r) => r !== roomId))
    if (member !== null && watchApiOn()) {
      turns.current.set(roomId, (turns.current.get(roomId) ?? 0) + 1)
      unwatchRoom(member, roomId).catch(() => undefined)
    }
  }, [update, member])
  return { watched, toggle, unwatch, error: failure?.scope === scope ? failure.message : null }
}
