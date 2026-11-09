/**
 * 신고가 판정됐다는 신호. 할 일 숫자(useTodoCounts)와 화면에 떠 있는 신고 목록이 듣는다.
 * 판정한 카드가 이미 사라졌어도(필터·칸을 바꿈) 지금 떠 있는 쪽이 새로 받게 하려고 카드 밖에 둔다
 */
const listeners = new Set<() => void>()

/** 듣기 시작한다. 돌려받은 함수를 부르면 그만 듣는다 */
export function onReportsChanged(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** 신고 판정이 끝났다고 알린다 */
export function reportsChanged(): void {
  listeners.forEach((fn) => fn())
}
