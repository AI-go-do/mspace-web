import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import { adminErrorMessage, awaitingJudgement, getTidyChecks, itemPercents, judgeConfirm, JUDGE_OPTIONS, seenItemsLabel, seenItemsSummary, stillInRoom, tidyCounts, tidySummary } from './admin'
import { ApiError } from './client'

const photo = { kind: 'CHECK_OUT' as const, exists: false, url: '', uploadedAt: null }

describe('증거의 직전 예약이 아직 방에 있는지 (강제 퇴실 권하기)', () => {
  it('입실했고 퇴실 시각이 없으면 아직 사용 중', () => {
    expect(stillInRoom({ reservationId: 1, checkedInAt: '2026-11-06T13:00:00+09:00', checkedOutAt: null, photo })).toBe(true)
  })
  it('퇴실했거나 직전 예약이 없으면 아니다', () => {
    expect(stillInRoom({ reservationId: 1, checkedInAt: '2026-11-06T13:00:00+09:00', checkedOutAt: '2026-11-06T14:00:00+09:00', photo })).toBe(false)
    expect(stillInRoom(null)).toBe(false)
  })
})

describe('판정 버튼과 오류 문구 (FR-RPT-103)', () => {
  it('판정은 사실·확인 불가·허위 셋, 대기(OPEN)는 없다', () => {
    expect(JUDGE_OPTIONS.map((o) => o.verdict)).toEqual(['CONFIRMED', 'UNVERIFIED', 'FALSE'])
  })
  it('이미 판정한 신고는 다른 관리자가 판정했다고 알린다', () => {
    expect(adminErrorMessage(new ApiError(409, 'REPORT_ALREADY_JUDGED', 'x'))).toContain('이미')
  })
  it('관리자가 아니면 관리자만이라고 알린다', () => {
    expect(adminErrorMessage(new ApiError(403, 'ADMIN_ONLY', 'x'))).toBe('관리자만 할 수 있어요.')
  })
  it('core에 아직 없는 API(코드 없는 404)는 배포 확인 안내', () => {
    expect(adminErrorMessage(new ApiError(404, 'UNKNOWN', 'x'))).toContain('core')
  })
})

describe('통계 숫자 모양 (core #74)', () => {
  it('비율은 반올림한 %, 모르면 —', async () => {
    const { pct } = await import('./admin')
    expect(pct(0.4249)).toBe('42%')
    expect(pct(null)).toBe('—')
  })
  it('n일 전 날짜는 달·해를 넘긴다', async () => {
    const { daysBefore } = await import('./admin')
    expect(daysBefore('2026-11-06', 6)).toBe('2026-10-31')
    expect(daysBefore('2026-01-01', 1)).toBe('2025-12-31')
  })
})

describe('알림 효과 문구 (core #93)', () => {
  it('결과가 난 알림 수와 그중 효과 본 수, 비율', async () => {
    const { alertEffectLabel } = await import('./admin')
    expect(alertEffectLabel(9, 12, 0.75)).toBe('12건 중 9건 (75%)')
  })
  it('알림이 없었으면 0%가 아니라 아직 없다고', async () => {
    const { alertEffectLabel } = await import('./admin')
    expect(alertEffectLabel(0, 0, null)).toBe('아직 없어요')
  })
})

describe('judgeConfirm', () => {
  const opt = (v: string) => JUDGE_OPTIONS.find((o) => o.verdict === v)!
  it('신고자가 있으면 원래 확인 문구를 쓴다', () => {
    for (const o of JUDGE_OPTIONS) expect(judgeConfirm(o, false)).toBe(o.confirm)
  })
  it('방 카메라 신고(신고자 없음)면 확인 불가·허위 문구에서 신고자 알림·경고를 말하지 않는다', () => {
    expect(judgeConfirm(opt('UNVERIFIED'), true)).toContain('알림은 가지 않아요')
    expect(judgeConfirm(opt('FALSE'), true)).toContain('경고는 가지 않아요')
    expect(judgeConfirm(opt('CONFIRMED'), true)).toBe(opt('CONFIRMED').confirm)
  })
})

describe('카메라 정리 확인 (core #110)', () => {
  it('결과와 두고 간 귀중품을 한 줄로', () => {
    expect(tidySummary({ result: 'CLEAN', leftItems: [] })).toBe('깨끗함')
    expect(tidySummary({ result: 'NEEDS_CLEANING', leftItems: ['BAG', 'LAPTOP'] })).toBe('치워야 함 · 두고 간 것: 가방·노트북')
    expect(tidySummary({ result: 'SOMETHING_NEW', leftItems: ['UMBRELLA'] })).toBe('SOMETHING_NEW · 두고 간 것: UMBRELLA')
  })

  it('퇴실 직후 줄로 물건 남음·깨끗함을, 다시 확인 줄로 경고를 센다', () => {
    const rows: Parameters<typeof tidyCounts>[0] = [
      { phase: 'FIRST', result: 'LEFT_ITEMS', leftItems: [], reportId: null },
      { phase: 'RECHECK', result: 'LEFT_ITEMS', leftItems: [], reportId: 12 },
      { phase: 'FIRST', result: 'CLEAN', leftItems: [], reportId: null },
      { phase: 'FIRST', result: 'CLEAN', leftItems: ['PHONE'], reportId: null },
      { phase: 'FIRST', result: 'NEEDS_CLEANING', leftItems: [], reportId: 3 },
    ]
    expect(tidyCounts(rows)).toEqual({ left: 3, clean: 1, warned: 1 })
  })

  it('AI 판단 줄은 같은 물건을 묶고 가장 높은 확신도만 낸다', () => {
    expect(seenItemsSummary([{ name: 'cup', confidence: 0.71 }, { name: 'cup', confidence: 0.88 }, { name: 'backpack', confidence: 0.6 }, { name: 'stapler', confidence: null }]))
      .toEqual({ text: '컵 2개 · 가방 · stapler', top: 0.88 })
    expect(seenItemsSummary([])).toEqual({ text: '', top: null })
  })

  it('남은 물건은 확신도 높은 순으로, 확신도 없으면 이름만', () => {
    expect(seenItemsLabel([{ name: 'cup', confidence: 0.61 }, { name: 'umbrella', confidence: 0.934 }, { name: 'bag', confidence: null }]))
      .toBe('umbrella 93% · cup 61% · bag')
  })

  afterEach(() => { vi.unstubAllGlobals(); clearTokens() })
  it('목록은 관리자 주소로 받고 기간은 1–92일로 자른다', async () => {
    const store = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    })
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString(), memberId: 1 })
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(String(url))
      return new Response(JSON.stringify({ items: [{ reservationId: 40, roomId: 2, roomName: '창작실 2', endedAt: null, result: 'CLEAN', items: [], leftItems: [], reportId: null, observedAt: '2026-11-09T21:00:00+09:00' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    const rows = await getTidyChecks(365)
    expect(calls[0]).toContain('/api/tidy-checks?days=92')
    expect(rows[0].roomName).toBe('창작실 2')
  })
})

describe('하루 운영 요약 숫자 (core #122)', () => {
  it('신고 맵을 판정별로 더하고 누가 썼는지 글로', async () => {
    const { reportTotals, sumOf, writerLabel } = await import('./admin')
    expect(reportTotals({ MESSY: { CONFIRMED: 2, OPEN: 1 }, NOISE: { OPEN: 3 } })).toEqual({ total: 6, byVerdict: { CONFIRMED: 2, OPEN: 4 } })
    expect(sumOf(undefined)).toBe(0)
    expect(writerLabel('gemini:gemini-2.5-flash')).toBe('Gemini')
    expect(writerLabel('template:fallback')).toBe('정해진 틀 (AI 실패)')
  })
})

describe('물품별 확신도', () => {
  it('높은 순 %로, 확신도 없는 물품은 뺀다', () => {
    expect(itemPercents([{ name: 'cup', confidence: 0.714 }, { name: 'unknown', confidence: null }, { name: 'cell phone', confidence: 0.82 }])).toEqual([82, 71])
  })
})

describe('opsSummary (core #140·#142 자동 처리)', () => {
  it('건수 많은 것부터, 0은 빼고 한글 이름으로', async () => {
    const { opsSummary } = await import('./admin')
    expect(opsSummary({ OVERTIME: 1, VENT_SOON: 3, ROOM_HOT: 0, NEW_KIND: 2 })).toBe('미리 환기 3 · NEW_KIND 2 · 시간 넘김 1')
    expect(opsSummary(undefined)).toBe('')
  })
  it('불 켜짐(LIGHT_LEFT_ON)도 한글 이름으로 (11/13)', async () => {
    const { opsSummary } = await import('./admin')
    expect(opsSummary({ LIGHT_LEFT_ON: 2 })).toBe('불 켜짐 2')
  })
})

describe('판정 기다림 탭 (11/13)', () => {
  it('판정하지 않는 소음과 이미 판정한 신고는 빼고 판정할 대기 신고만 남긴다', () => {
    const list = [
      { id: 1, category: 'NOISE' as const, verdict: 'OPEN' as const },
      { id: 2, category: 'MESSY' as const, verdict: 'OPEN' as const },
      { id: 3, category: 'BROKEN' as const, verdict: 'UNVERIFIED' as const },
      { id: 4, category: 'WINDOW_OPEN' as const, verdict: 'OPEN' as const },
    ]
    expect(awaitingJudgement(list).map((r) => r.id)).toEqual([2, 4])
  })
})
