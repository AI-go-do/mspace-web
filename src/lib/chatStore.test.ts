import { describe, expect, it } from 'vitest'
import type { ConfirmResult } from '../api/agent'
import { cardOutcomeOf, loadChat, resetChat, restoreChat, SAVED_TTL_MS, saveCardOutcome, saveChat, toSaved, watchCardOutcome } from './chatStore'

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

describe('새로고침해도 대화 유지(이 탭 저장소)', () => {
  const card = { tool: 'create_reservation', token: 'secret-token', summary: '3번 방 11/7 14:00–16:00', notes: [], needsParticipants: 0, expiresAt: '2026-11-07T00:00:00+09:00' }
  const result: ConfirmResult = { action: 'CREATE', reservationId: 9, status: 'BOOKED', accessCode: '123456', replayed: false, message: '예약했어요' }

  it('저장할 때 확인 토큰과 입실 번호는 빼고, 카드는 요약과 결과만 남긴다', () => {
    const saved = toSaved({
      memberId: 1, pending: null,
      messages: [
        { id: 1, role: 'user', text: '내일 2시 3번 방 잡아 줘' },
        { id: 2, role: 'assistant', text: '이렇게 예약할까요?', confirmations: [card, { ...card, token: 'other', summary: '안 누른 카드' }] },
      ],
    }, new Map([['secret-token', { kind: 'done', result }]]), 1000)
    const raw = JSON.stringify(saved)
    expect(raw).not.toContain('secret-token')
    expect(raw).not.toContain('123456')
    expect(saved?.messages[1].pastCards).toEqual([
      { summary: '3번 방 11/7 14:00–16:00', result: { action: 'CREATE', reservationId: 9, message: '예약했어요' } },
      { summary: '안 누른 카드' },
    ])
    expect(saved?.messages[1].confirmations).toBeUndefined()
  })

  it('접수 중(번호를 아직 못 받음)은 저장하지 않고, 받은 번호는 저장한다', () => {
    const base = { memberId: 1, messages: [{ id: 1, role: 'user' as const, text: '안녕' }] }
    expect(toSaved({ ...base, pending: { jobId: '', startedAt: 5 } }, new Map(), 10)?.pending).toBeNull()
    expect(toSaved({ ...base, pending: { jobId: 'job-1', startedAt: 5 } }, new Map(), 10)?.pending).toMatchObject({ jobId: 'job-1' })
  })

  it('같은 회원의 24시간 안 기록만 되살리고, 다른 회원·오래된 기록·깨진 값은 버린다', () => {
    const saved = { memberId: 1, savedAt: 0, messages: [{ id: 3, role: 'assistant', text: '안녕하세요' }, { bad: true }], pending: null }
    expect(restoreChat(saved, 1, 1000)?.messages).toEqual([{ id: 3, role: 'assistant', text: '안녕하세요' }])
    expect(restoreChat(saved, 2, 1000)).toBeNull()
    expect(restoreChat(saved, null, 1000)).toBeNull()
    expect(restoreChat(saved, 1, SAVED_TTL_MS + 1)).toBeNull()
    expect(restoreChat('깨진 값', 1, 0)).toBeNull()
  })

  it('지난 카드 값이 배열이 아니면 그 메시지는 되살리지 않는다(화면이 깨지지 않게)', () => {
    const saved = { memberId: 1, savedAt: 0, pending: null, messages: [
      { id: 1, role: 'assistant', text: '정상', pastCards: [{ summary: '카드' }] },
      { id: 2, role: 'assistant', text: '깨짐', pastCards: { summary: '배열 아님' } },
    ] }
    expect(restoreChat(saved, 1, 0)?.messages.map((m) => m.text)).toEqual(['정상'])
  })

  it('다른 회원이 들어오면 앞 회원 기록을 저장소에서도 지우고, 회원을 모를 때(null)는 남겨 둔다', () => {
    const store = new Map<string, string>()
    const fake = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) }
    const g = globalThis as { sessionStorage?: unknown }
    const before = g.sessionStorage
    g.sessionStorage = fake
    try {
      loadChat(11)
      saveChat({ memberId: 11, pending: null, messages: [{ id: 1, role: 'user', text: '11번 회원 질문' }] })
      expect(store.size).toBe(1)
      loadChat(null)
      expect(store.size).toBe(1)
      expect(loadChat(11).messages).toHaveLength(1)
      loadChat(12)
      expect(store.size).toBe(0)
    } finally {
      g.sessionStorage = before
    }
  })

  it('기다리던 답은 90초 안일 때만 이어서 조회한다', () => {
    const saved = { memberId: 1, savedAt: 0, messages: [], pending: { jobId: 'job-1', startedAt: 0 } }
    expect(restoreChat(saved, 1, 60_000)?.pending).toMatchObject({ jobId: 'job-1' })
    expect(restoreChat(saved, 1, 120_000)?.pending).toBeNull()
  })

  it('새 대화는 그 회원 기록과 카드 결과를 비운다', () => {
    loadChat(5)
    saveCardOutcome(5, 'tok-z', { kind: 'closed', message: '이미 쓴 확인이에요' })
    const next = resetChat(5)
    expect(next).toEqual({ memberId: 5, messages: [], pending: null })
    expect(cardOutcomeOf(5, 'tok-z')).toBeUndefined()
  })
})
