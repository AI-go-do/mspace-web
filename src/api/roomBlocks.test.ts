import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import {
  _resetBlocksForTest, blockConflicts, blocksSource, cancelConflicts, createBlock, previewReservations, refreshBlocks,
  releaseBlock,
} from './roomBlocks'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const now = new Date('2026-11-09T14:41:00+09:00')
const block = (o: Record<string, unknown> = {}) => ({
  id: 7, roomId: 5, startAt: '2026-11-10T09:00:00+09:00', endAt: '2026-11-10T12:00:00+09:00',
  reason: 'INSPECTION', memo: '에어컨 점검', createdAt: '2026-11-09T14:40:00+09:00', releasedAt: null, ...o,
})
const conflict = (o: Record<string, unknown> = {}) => ({
  reservationId: 31, roomId: 5, startAt: '2026-11-10T10:00:00+09:00', endAt: '2026-11-10T11:00:00+09:00',
  people: 6, status: 'BOOKED', cancelable: true, ...o,
})
const input = {
  roomId: 5, startAt: new Date('2026-11-10T09:00:00+09:00'), endAt: new Date('2026-11-10T12:00:00+09:00'),
  reason: 'INSPECTION' as const, memo: ' 에어컨 점검 ',
}

describe('기간 막기 core API (core #98)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    _resetBlocksForTest('api')
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(now)
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    clearTokens()
    _resetBlocksForTest()
  })

  it('api로 빌드했으면 core를 쓰고, 막기 전 미리 셀 가짜 예약은 없다', () => {
    expect(blocksSource()).toBe('api')
    expect(previewReservations(now)).toEqual([])
  })

  it('막기는 POST로 보내고(메모 앞뒤 빈칸 뺌) 서버가 준 겹친 예약을 그대로 보여 준다', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { block: block(), conflicts: [conflict(), conflict({ reservationId: 32, status: 'IN_USE', cancelable: false })] }))
    const r = await createBlock(input, now)
    const [path, init] = fetchMock.mock.calls[0]
    expect([path, init.method]).toEqual(['/api/admin/room-blocks', 'POST'])
    expect(JSON.parse(init.body)).toEqual({
      roomId: 5, startAt: input.startAt.toISOString(), endAt: input.endAt.toISOString(), reason: 'INSPECTION', memo: '에어컨 점검',
    })
    if ('error' in r) throw new Error(r.error)
    expect(r.block.id).toBe(7)
    expect(blockConflicts(7, now).map((c) => [c.reservationId, c.cancelable])).toEqual([[31, true], [32, false]])
  })

  it('틀린 값은 서버에 보내지 않고, 서버가 거절하면 서버 문장을 보여 준다', async () => {
    expect('error' in await createBlock({ ...input, endAt: input.startAt }, now)).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
    fetchMock.mockResolvedValueOnce(json(409, { code: 'ROOM_BLOCK_OVERLAP', message: '이 방은 이미 그 시간에 막혀 있습니다' }))
    expect(await createBlock(input, now)).toEqual({ error: '이 방은 이미 그 시간에 막혀 있습니다' })
  })

  it('목록을 읽으면 아직 안 끝난 막기마다 겹친 예약도 읽는다', async () => {
    fetchMock.mockImplementation(async (path: string) => {
      if (path === '/api/admin/room-blocks') return json(200, [block(), block({ id: 8, endAt: '2026-11-09T10:00:00+09:00' })])
      if (path === '/api/admin/room-blocks/7/conflicts') return json(200, [conflict()])
      return json(404, { code: 'NOT_FOUND', message: '없음' })
    })
    await refreshBlocks(true)
    const paths = fetchMock.mock.calls.map((c) => c[0])
    expect(paths).toEqual(['/api/admin/room-blocks', '/api/admin/room-blocks/7/conflicts'])
    expect(blockConflicts(7, now)).toHaveLength(1)
    expect(blockConflicts(8, now)).toEqual([]) // 끝난 막기
  })

  it('목록 응답 모양이 다르면 화면을 깨지 않고 오류 문장을 남긴다', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { nope: true }))
    await refreshBlocks(true)
    expect(blockConflicts(7, now)).toEqual([])
  })

  it('풀면 겹친 예약 목록이 사라지고, 취소는 건수를 돌려준 뒤 남은 예약을 다시 읽는다', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { block: block(), conflicts: [conflict(), conflict({ reservationId: 32, status: 'IN_USE', cancelable: false })] }))
    await createBlock(input, now)
    fetchMock.mockResolvedValueOnce(json(200, { canceled: 1, reservationIds: [31] }))
    fetchMock.mockResolvedValueOnce(json(200, [conflict({ reservationId: 32, status: 'IN_USE', cancelable: false })]))
    expect(await cancelConflicts(7, now)).toBe(1)
    expect(fetchMock.mock.calls[1][0]).toBe('/api/admin/room-blocks/7/cancel-conflicts')
    expect(blockConflicts(7, now).map((c) => c.reservationId)).toEqual([32])

    fetchMock.mockResolvedValueOnce(json(200, block({ releasedAt: '2026-11-09T14:42:00+09:00' })))
    expect(await releaseBlock(7, now)).toBeNull()
    expect(fetchMock.mock.calls[3][0]).toBe('/api/admin/room-blocks/7/release')
    expect(blockConflicts(7, now)).toEqual([])
  })

  it('취소는 됐는데 다시 읽기가 실패해도 취소한 예약은 목록에서 빠진다', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { block: block(), conflicts: [conflict(), conflict({ reservationId: 32, status: 'IN_USE', cancelable: false })] }))
    await createBlock(input, now)
    fetchMock.mockResolvedValueOnce(json(200, { canceled: 1, reservationIds: [31] }))
    fetchMock.mockResolvedValueOnce(json(502, { code: 'BAD_GATEWAY', message: '잠시 후' }))
    expect(await cancelConflicts(7, now)).toBe(1)
    expect(blockConflicts(7, now).map((c) => c.reservationId)).toEqual([32])
  })

  it('목록을 읽는 사이 막기가 성공하면 옛 목록으로 덮지 않고 다시 읽는다', async () => {
    let releaseList: (r: Response) => void = () => {}
    let listCalls = 0
    fetchMock.mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/admin/room-blocks' && init?.method === 'POST') {
        return Promise.resolve(json(201, { block: block(), conflicts: [conflict()] }))
      }
      if (path === '/api/admin/room-blocks') {
        listCalls++
        // 첫 읽기는 막기보다 늦게 끝난다(막기 전 목록: 비어 있음). 두 번째 읽기는 막기가 들어간 목록
        if (listCalls === 1) return new Promise<Response>((res) => { releaseList = res })
        return Promise.resolve(json(200, [block()]))
      }
      if (path === '/api/admin/room-blocks/7/conflicts') return Promise.resolve(json(200, [conflict()]))
      return Promise.resolve(json(404, { code: 'NOT_FOUND', message: '없음' }))
    })
    const reading = refreshBlocks(true)
    await createBlock(input, now)
    releaseList(json(200, []))
    await reading
    expect(listCalls).toBe(2)
    expect(blockConflicts(7, now)).toHaveLength(1)
  })

  it('취소·풀기가 실패하면 서버 문장을 돌려준다', async () => {
    fetchMock.mockImplementation(async () => json(403, { code: 'ADMIN_ONLY', message: '관리자만 할 수 있습니다' }))
    expect(await cancelConflicts(7, now)).toEqual({ error: '관리자만 할 수 있습니다' })
    expect(await releaseBlock(7, now)).toBe('관리자만 할 수 있습니다')
  })
})
