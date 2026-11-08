/**
 * 예시 화면 (11/8 최종안). core API가 아직 없는 기능(방의 사과·빈방 릴레이, core #94)을 가짜 데이터로 미리 볼 때만 켠다.
 * 주소에 ?demo=1을 붙여 열면 그 탭에서만 켜지고(sessionStorage), ?demo=0으로 열거나 탭을 닫으면 꺼진다.
 * `VITE_API_MOCK=true`로 띄운 개발 화면도 켠다. 주소에 demo가 없는 보통 학생 화면에는 가짜 데이터가 나오지 않는다
 */
const KEY = 'mspace:demo'

/** 주소의 ?demo=1 / ?demo=0을 이 탭 설정으로 옮긴다. 앱을 열 때 한 번 부른다 */
export function syncDemoFromUrl(search: string): void {
  const v = new URLSearchParams(search).get('demo')
  if (v === null) return
  try {
    if (v === '1') sessionStorage.setItem(KEY, '1')
    else sessionStorage.removeItem(KEY)
  } catch { /* 저장소를 못 쓰면(사생활 모드) 예시를 켜지 않는다 */ }
}

/** 예시 데이터를 섞을지 */
export function demoOn(): boolean {
  if (import.meta.env.VITE_API_MOCK === 'true') return true
  try {
    return sessionStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}
