import { describe, expect, it } from 'vitest'
import { allMessages, BOOK_STEPS, MAIN_PROMPTS, type PromptChip } from './prompts'

function walk(chips: PromptChip[], fn: (c: PromptChip) => void) {
  for (const c of chips) {
    fn(c)
    walk(c.next ?? [], fn)
  }
}

describe('추천 말 버튼', () => {
  it('버튼마다 보낼 말이나 다음 단계 중 정확히 하나가 있다(누르면 반드시 무슨 일이 생긴다)', () => {
    walk(MAIN_PROMPTS, (c) => {
      expect(Boolean(c.message) !== Boolean(c.next?.length)).toBe(true)
    })
  })

  it('보낼 말은 서버 한도(1,000자) 안이고 겹치지 않는다', () => {
    const all = allMessages()
    expect(all.every((m) => m.trim().length > 0 && m.length <= 1000)).toBe(true)
    expect(new Set(all).size).toBe(all.length)
  })

  it('오늘 브리핑은 "브리핑"을 넣어 모델 없이 바로 답하게 한다(assistant #82)', () => {
    expect(MAIN_PROMPTS.find((c) => c.label === '오늘 브리핑')?.message).toContain('브리핑')
  })

  it('방 예약은 한 번 더 고르게 펼치고, 그 안에 즉시 시작과 수업 뒤가 있다', () => {
    const book = MAIN_PROMPTS.find((c) => c.label === '방 예약')
    expect(book?.next).toBe(BOOK_STEPS)
    expect(allMessages(BOOK_STEPS)).toEqual(expect.arrayContaining(['지금 바로 1시간 쓸게', '지난번처럼 잡아 줘']))
  })

  it('보낼 말에 이름·학번 같은 숫자 8자리가 들어가지 않는다(외부 AI로 나가지 않게)', () => {
    expect(allMessages().some((m) => /\d{8}/.test(m))).toBe(false)
  })
})
