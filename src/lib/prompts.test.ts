import { describe, expect, it } from 'vitest'
import { allMessages, BOOK_STEPS, fillTemplates, MAIN_PROMPTS, STARTERS, suggest, type PromptChip } from './prompts'

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

describe('suggest (연관 추천)', () => {
  it('아무것도 안 쳤으면 처음 추천을 준다', () => {
    expect(suggest('')).toEqual(STARTERS.slice(0, 4))
  })
  it('띄어쓰기가 달라도 찾는다', () => {
    expect(suggest('빈방')).toContain('지금 빈 방 있어?')
  })
  it('조각이 모두 들어 있는 문장만 고른다', () => {
    const r = suggest('내일 2시')
    expect(r.length).toBeGreaterThan(0)
    r.forEach((m) => expect(m.replace(/\s/g, '')).toContain('2시'))
  })
  it('맞는 게 없으면 빈 목록', () => {
    expect(suggest('피자 주문')).toEqual([])
  })
  it('내가 전에 보낸 말이 맞으면 먼저 올린다', () => {
    const r = suggest('빈 방', 4, allMessages(), ['3시에 빈 방 있어?'])
    expect(r[0]).toBe('3시에 빈 방 있어?')
  })
  it('아무것도 안 쳤으면 최근 말 2개 + 처음 추천', () => {
    expect(suggest('', 4, allMessages(), ['a', 'b', 'c'])).toEqual(['a', 'b', ...STARTERS.slice(0, 2)])
  })
  it('친 말과 똑같은 문장은 빼고 limit개까지', () => {
    expect(suggest('내 예약 보여 줘')).not.toContain('내 예약 보여 줘')
    expect(suggest('예약', 2).length).toBeLessThanOrEqual(2)
  })
})

describe('fillTemplates (친 말로 문장 만들기)', () => {
  it('날짜·시각을 넣고 1~8시는 오후로 본다', () => {
    expect(fillTemplates('모레 4시')).toEqual(['모레 오후 4시에 2시간 빈 방 있어?', '모레 오후 4시부터 2시간 예약해 줘'])
  })
  it('길이와 반을 살린다', () => {
    expect(fillTemplates('금요일 오전 10시 반 1시간')[0]).toBe('금요일 오전 10시 반에 1시간 빈 방 있어?')
  })
  it('친 분(30분)을 그대로 살려 추천에서 빠지지 않는다', () => {
    expect(fillTemplates('내일 3시 30분')[0]).toBe('내일 오후 3시 30분에 2시간 빈 방 있어?')
    expect(suggest('내일 3시 30분', 4, [])[0]).toBe('내일 오후 3시 30분에 2시간 빈 방 있어?')
  })
  it('날짜만 있으면 수업 뒤·시간표', () => {
    expect(fillTemplates('수요일')[0]).toBe('수요일 수업 끝나고 쓸 수 있는 빈 방 찾아 줘')
  })
  it('목록에 없는 말도 추천에 나온다', () => {
    expect(suggest('모레 4시')[0]).toBe('모레 오후 4시에 2시간 빈 방 있어?')
  })
  it('날짜·시각이 없으면 만들지 않는다', () => {
    expect(fillTemplates('예약')).toEqual([])
  })
})
