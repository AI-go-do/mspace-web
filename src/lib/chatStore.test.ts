import { describe, expect, it } from 'vitest'
import type { ConfirmResult } from '../api/agent'
import { cardOutcomeOf, saveCardOutcome } from './chatStore'

describe('확인 카드 결과 기억', () => {
  it('누른 카드 결과는 화면을 다시 열어도 같은 회원에게 그대로 남는다', () => {
    const result: ConfirmResult = { action: 'CREATE', reservationId: 7, status: 'BOOKED', accessCode: null, replayed: false, message: '예약했어요' }
    saveCardOutcome(1, 'tok-a', { kind: 'done', result })
    expect(cardOutcomeOf(1, 'tok-a')).toMatchObject({ kind: 'done', result: { reservationId: 7 } })
    expect(cardOutcomeOf(1, 'tok-b')).toBeUndefined()
  })

  it('다른 회원에게는 보이지 않고, 회원이 바뀌면 앞 회원 것은 지운다', () => {
    saveCardOutcome(1, 'tok-c', { kind: 'closed', message: '이미 쓴 확인이에요' })
    expect(cardOutcomeOf(2, 'tok-c')).toBeUndefined()
    saveCardOutcome(2, 'tok-d', { kind: 'closed', message: '시간이 지났어요' })
    expect(cardOutcomeOf(1, 'tok-c')).toBeUndefined()
    expect(cardOutcomeOf(2, 'tok-d')).toMatchObject({ kind: 'closed' })
  })
})
