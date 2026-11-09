import type { AppNotification } from './notifications'

/**
 * 방의 사과 (요구사항 Q-19, core #99).
 * 문 장치가 와이파이 끊김·오류로 문을 못 열어 생긴 노쇼는 core가 규칙으로 노쇼에서 빼고(정지도 풂), 대표자·참여자에게
 * `DEVICE_APOLOGY` 알림을 남긴다. 제목·본문은 서버가 준 그대로 쓴다. 화면은 홈 맨 위 카드와 알림함에 보여 준다
 */
export const APOLOGY_KIND = 'DEVICE_APOLOGY'

/** core #99 전에 웹이 가정한 이름. 예전 예시 기록이 남아 있어도 사과로 보이게 같이 받는다 */
const OLD_APOLOGY_KIND = 'ROOM_APOLOGY'

export const isApology = (n: Pick<AppNotification, 'kind'>) => n.kind === APOLOGY_KIND || n.kind === OLD_APOLOGY_KIND

/** 홈에 띄울 사과 하나: 아직 안 읽은 것 중 가장 최근 것. 숨긴 번호(방금 "괜찮아요"를 누름)는 뺀다 */
export function pickApology(list: AppNotification[], hidden: ReadonlySet<number> = new Set()): AppNotification | null {
  let best: AppNotification | null = null
  for (const n of list) {
    if (!isApology(n) || n.read || hidden.has(n.id)) continue
    if (!best || Date.parse(n.createdAt) > Date.parse(best.createdAt)) best = n
  }
  return best
}

// ---- 예시 데이터 (주소에 ?demo=1일 때만, lib/demo.ts). core API가 생기면 이 아래만 지운다 ----

/** 예시 알림 번호는 음수라 서버 번호와 겹치지 않고, 읽음 처리도 서버로 보내지 않는다 */
export const isDemoId = (id: number) => id < 0

const DEMO_KEY = 'mspace:demo:apology'

interface DemoState { at: number; read: boolean }

function demoState(now: number): DemoState {
  try {
    const raw = sessionStorage.getItem(DEMO_KEY)
    const s = raw ? (JSON.parse(raw) as Partial<DemoState>) : null
    if (s && typeof s.at === 'number' && typeof s.read === 'boolean') return { at: s.at, read: s.read }
  } catch { /* 처음이거나 저장소를 못 씀 */ }
  // 예시를 처음 켠 때보다 4분 앞에 온 것으로 둔다("4분 전")
  const fresh = { at: now - 4 * 60_000, read: false }
  saveDemo(fresh)
  return fresh
}

function saveDemo(s: DemoState): void {
  try { sessionStorage.setItem(DEMO_KEY, JSON.stringify(s)) } catch { /* 이 화면에서만 기억 */ }
}

/** 예시 사과 알림 하나 (장치 와이파이 끊김으로 생긴 노쇼 경고 1회를 무름) */
export function demoApologies(now = Date.now()): AppNotification[] {
  const s = demoState(now)
  return [{
    id: -1,
    reservationId: null,
    kind: APOLOGY_KIND,
    title: '장치 문제로 못 들어가셨어요',
    body: '창작실 3 14:00 예약은 문 장치 문제로 입실을 못 하셔서 노쇼에서 뺐어요. 불편을 드려 죄송해요.',
    createdAt: new Date(s.at).toISOString(),
    read: s.read,
  }]
}

/** 예시 알림 읽음 */
export function readDemo(): void {
  saveDemo({ ...demoState(Date.now()), read: true })
}

/** 서버 목록 뒤에 예시를 붙인다(최신 것이 앞). 같은 번호가 이미 있으면 붙이지 않는다 */
export function mergeDemo(list: AppNotification[], demo: AppNotification[]): AppNotification[] {
  const ids = new Set(list.map((n) => n.id))
  return [...list, ...demo.filter((n) => !ids.has(n.id))].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
}
