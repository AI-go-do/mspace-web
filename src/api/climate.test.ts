import { describe, expect, it } from 'vitest'
import { parseSse } from './climate'

describe('parseSse', () => {
  it('이벤트 이름과 data를 나누고, ping 주석은 버린다', () => {
    const { events, rest } = parseSse('event:hello\ndata:{}\n\n:ping\n\nevent: reading\ndata: {"roomId":1}\n\n')
    expect(events).toEqual([{ event: 'hello', data: '{}' }, { event: 'reading', data: '{"roomId":1}' }])
    expect(rest).toBe('')
  })

  it('다 못 받은 끝은 rest로 남겨 다음 조각과 이어 붙인다', () => {
    const first = parseSse('event:reading\ndata:{"room')
    expect(first.events).toEqual([])
    const second = parseSse(first.rest + 'Id":2}\n\n')
    expect(second.events).toEqual([{ event: 'reading', data: '{"roomId":2}' }])
  })

  it('\\r\\n 줄바꿈도 읽는다', () => {
    expect(parseSse('event:tick\r\ndata:{}\r\n\r\n').events).toEqual([{ event: 'tick', data: '{}' }])
  })
})
