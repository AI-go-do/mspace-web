import { describe, expect, it } from 'vitest'
import type { ConfirmResult } from '../api/agent'
import { cardOutcomeOf, loadChat, saveCardOutcome, watchCardOutcome } from './chatStore'

describe('확인 카드 결과 기억', () => {
  it('누른 카드 결과는 화면을 다시 열어도 같은 회원에게 그대로 남는다', () => {
    loadChat(1)
    const result: ConfirmResult = { action: 'CREATE', reservationId: 7, status: 'BOOKED', accessCode: null, replayed: false, message: '예약했어요' }
    saveCardOutcome(1, 'tok-a', { kind: 'done', result })
    expect(cardOutcomeOf(1, 'tok-a')).toMatchObject({ kind: 'done', result: { reservationId: 7 } })
    expect(cardOutcomeOf(1, 'tok-b')).toBeUndefined()
  })

  it('회원이 바뀌면 앞 회원 것은 지우고, 앞 회원 확인이 늦게 끝나도 지금 회원 기록에 들어가지 않는다', () => {
    loadChat(1)
    saveCardOutcome(1, 'tok-c', { kind: 'closed', message: '이미 쓴 확인이에요' })
    expect(cardOutcomeOf(2, 'tok-c')).toBeUndefined()
    loadChat(2)
    saveCardOutcome(2, 'tok-d', { kind: 'closed', message: '시간이 지났어요' })
    saveCardOutcome(1, 'tok-late', { kind: 'closed', message: '늦게 온 결과' })
    expect(cardOutcomeOf(1, 'tok-c')).toBeUndefined()
    expect(cardOutcomeOf(2, 'tok-late')).toBeUndefined()
    expect(cardOutcomeOf(2, 'tok-d')).toMatchObject({ kind: 'closed' })
  })

  it('보내는 중에 화면이 다시 그려져도 결과가 오면 지켜보던 카드가 받는다', () => {
    loadChat(3)
    saveCardOutcome(3, 'tok-e', { kind: 'sending' })
    const seen: unknown[] = []
    const stop = watchCardOutcome('tok-e', (o) => seen.push(o?.kind))
    expect(cardOutcomeOf(3, 'tok-e')).toMatchObject({ kind: 'sending' })
    saveCardOutcome(3, 'tok-e', { kind: 'closed', message: '이미 쓴 확인이에요' })
    stop()
    saveCardOutcome(3, 'tok-e', undefined)
    expect(seen).toEqual(['closed'])
  })
})
