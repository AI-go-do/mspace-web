import type { Friend } from '../api/friends'

/**
 * 말한 친구 이름을 친구 목록(가린 이름 김*영)과 맞춘다 (AI로 간단히 예약하기, FR-AGT-105).
 * 브라우저 안에서만 한다: 친구 이름이 외부 AI(Gemini)로 가지 않게(assistant 설계 7장).
 * core는 친구에게도 가린 이름만 줘서 보이는 글자(보통 성·끝 글자)만 비교한다.
 */
export interface FriendMatch {
  /** 하나로 정해진 친구(말한 차례대로, 중복 없음) */
  picked: Friend[]
  /** 후보가 둘 이상이라 채우지 않은 이름. 화면이 후보 버튼을 보여 준다 */
  ambiguous: { spoken: string; candidates: Friend[] }[]
  /** 친구 목록에 없는 이름 */
  unknown: string[]
}

/** 이름이 아닌 말. "나 포함 친구 세 명" 같은 덧말 */
const STOP = new Set(['나', '저', '나랑', '저랑', '친구', '친구들', '포함', '명', '사람', '같이', '그리고', '이랑', '랑', '하고', '와', '과', '요', '이요', '넣어', '넣어줘', '넣어 줘', '줘', '해줘', '이에요', '예요', '입니다'])
/** 이름 뒤에 붙는 이어 주는 말. 긴 것부터 */
const JOINERS = ['이하고', '이랑', '하고', '랑', '이와', '와', '과', '이도', '도', '이요', '요']
/** "지영이", "민아", "수야" 부르는 말 끝 */
const CALL = /[이아야]$/
const HANGUL = /^[가-힣]+$/

/** 말한 이름이 가린 이름과 맞나. 같은 길이(성+이름)면 보이는 글자 모두, 한 글자 짧으면(이름만) 성 뒤 글자들과 비교 */
export function nameFits(spoken: string, masked: string): boolean {
  const m = [...masked]
  const s = [...spoken]
  let target: string[]
  if (s.length === m.length) target = m
  else if (s.length === m.length - 1 && m.length >= 3) target = m.slice(1)
  else return false
  let compared = 0
  for (let i = 0; i < target.length; i++) {
    if (target[i] === '*') continue
    if (target[i] !== s[i]) return false
    compared++
  }
  return compared > 0
}

function candidatesOf(word: string, friends: Friend[]): Friend[] {
  return friends.filter((f) => nameFits(word, f.name))
}

/** 이어 주는 말·부르는 말을 떼어 가며 맞는 후보가 나오는 첫 모양을 고른다 */
function readWord(raw: string, friends: Friend[]): { word: string; candidates: Friend[] } {
  const tries = [raw]
  const joiner = JOINERS.find((j) => raw.length > j.length + 1 && raw.endsWith(j))
  const base = joiner ? raw.slice(0, -joiner.length) : raw
  if (base !== raw) tries.push(base)
  if (base.length >= 3 && CALL.test(base)) tries.push(base.slice(0, -1))
  for (const w of tries) {
    const c = candidatesOf(w, friends)
    if (c.length > 0) return { word: w, candidates: c }
  }
  return { word: tries[tries.length - 1], candidates: [] }
}

/**
 * @param spoken  음성 인식 글 또는 친 글. 예: "지영이랑 재웅이 그리고 박수연"
 * @param friends 내 친구 목록
 * @param taken   이미 넣은 학번(다시 고르지 않음)
 */
export function matchFriends(spoken: string, friends: Friend[], taken: string[] = []): FriendMatch {
  const out: FriendMatch = { picked: [], ambiguous: [], unknown: [] }
  const used = new Set(taken.filter(Boolean))
  for (const raw of spoken.split(/[\s,，.·]+/)) {
    if (!raw || STOP.has(raw) || !HANGUL.test(raw)) continue
    const free = friends.filter((f) => !used.has(f.studentId))
    const { word, candidates } = readWord(raw, free)
    if (candidates.length === 1) {
      used.add(candidates[0].studentId)
      out.picked.push(candidates[0])
    } else if (candidates.length > 1) {
      out.ambiguous.push({ spoken: word, candidates })
    } else if (word.length >= 2 && !STOP.has(word) && candidatesOf(word, friends).length === 0) {
      // 이미 넣은 친구를 다시 말한 것은 모르는 이름이 아니다
      out.unknown.push(word)
    }
  }
  return out
}
