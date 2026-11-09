import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearTokens, saveTokens } from '../auth/tokens'
import { ApiError } from './client'
import { checkSchedule, deleteSchedule, getSchedule, parseScheduleImage, saveSchedule, scheduleErrorMessage, sortClasses, type ScheduleClass } from './schedule'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const c = (dayOfWeek: ScheduleClass['dayOfWeek'], startTime: string, endTime: string, name = '자료구조'): ScheduleClass =>
  ({ dayOfWeek, startTime, endTime, name })

describe('내 시간표 API (도구 명세 2.5)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
  })

  it('아직 안 넣었으면(404 NO_SCHEDULE) 오류가 아니라 null', async () => {
    fetchMock.mockResolvedValue(json(404, { code: 'NO_SCHEDULE', message: '없음' }))
    expect(await getSchedule()).toBeNull()
  })

  it('저장소 장애(503)는 없는 척하지 않고 오류로 던진다', async () => {
    fetchMock.mockResolvedValue(json(503, { code: 'SCHEDULE_UNAVAILABLE', message: 'x' }))
    await expect(getSchedule()).rejects.toMatchObject({ code: 'SCHEDULE_UNAVAILABLE' })
  })

  it('저장은 PUT으로 통째로, 지우기는 DELETE', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { classes: [c('MON', '09:00', '10:15')], updatedAt: 'x' }))
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }))
    await saveSchedule([c('MON', '09:00', '10:15')])
    await deleteSchedule()
    const [path, init] = fetchMock.mock.calls[0]
    expect([path, init.method]).toEqual(['/api/agent/schedule', 'PUT'])
    expect(JSON.parse(init.body)).toEqual({ classes: [c('MON', '09:00', '10:15')] })
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE')
  })

  it('캡처는 multipart image로 보내고 JSON 머리글을 붙이지 않는다', async () => {
    fetchMock.mockResolvedValue(json(200, { classes: [], dropped: 0, note: '직접 입력해 주세요' }))
    const draft = await parseScheduleImage(new Blob([new Uint8Array(10)], { type: 'image/jpeg' }))
    const [path, init] = fetchMock.mock.calls[0]
    expect(path).toBe('/api/agent/schedule/parse')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('image')).toBeInstanceOf(Blob)
    expect(new Headers(init.headers).get('Content-Type')).toBeNull()
    expect(draft.note).toBe('직접 입력해 주세요')
  })
})

describe('시간표 검사 (서버와 같은 규칙)', () => {
  it('맞는 시간표는 통과, 맞닿은 수업은 겹침이 아니다', () => {
    expect(checkSchedule([c('MON', '09:00', '10:15'), c('MON', '10:15', '11:00', '운영체제')])).toBeNull()
  })
  it('비었거나 40개 넘으면 막는다', () => {
    expect(checkSchedule([])?.index).toBeNull()
    expect(checkSchedule(Array.from({ length: 41 }, (_, i) => c('MON', '09:00', '10:00', `과목${i}`)))?.message).toContain('40개')
  })
  it('과목명 1~30자, 시작<끝을 줄 번호와 함께 알린다', () => {
    expect(checkSchedule([c('MON', '09:00', '10:00', '  ')])).toEqual({ index: 0, message: '과목명을 적어 주세요.' })
    expect(checkSchedule([c('MON', '09:00', '10:00', '가'.repeat(31))])?.message).toContain('30자')
    expect(checkSchedule([c('MON', '09:00', '10:00'), c('TUE', '11:00', '11:00')])?.index).toBe(1)
    expect(checkSchedule([c('TUE', '', '11:00')])?.message).toContain('시각')
  })
  it('같은 요일 겹침은 뒤 줄에 앞 과목 이름으로 알린다', () => {
    expect(checkSchedule([c('WED', '09:00', '10:30', '운영체제'), c('THU', '09:00', '10:00'), c('WED', '10:00', '11:00')]))
      .toEqual({ index: 2, message: "수요일 '운영체제'와 시간이 겹쳐요." })
  })
  it('요일 → 시작 순으로 정렬한다', () => {
    expect(sortClasses([c('TUE', '09:00', '10:00'), c('MON', '13:00', '14:00'), c('MON', '09:00', '10:00')])
      .map((x) => `${x.dayOfWeek} ${x.startTime}`)).toEqual(['MON 09:00', 'MON 13:00', 'TUE 09:00'])
  })
})

describe('오류 문장', () => {
  it('nginx 413(코드 없음)은 사진이 크다고 알린다', () => {
    expect(scheduleErrorMessage(new ApiError(413, 'UNKNOWN', 'x'))).toContain('너무 커요')
  })
  it('코드별로 바꾸고, 모르는 코드는 서버 문장 그대로', () => {
    expect(scheduleErrorMessage(new ApiError(400, 'SCHEDULE_OVERLAP', 'x'))).toContain('겹치는')
    expect(scheduleErrorMessage(new ApiError(503, 'LLM_NOT_CONFIGURED', 'x'))).toContain('직접 입력')
    expect(scheduleErrorMessage(new ApiError(500, 'WHATEVER', '서버 문장'))).toBe('서버 문장')
    expect(scheduleErrorMessage(new TypeError('fetch failed'))).toContain('연결')
  })
})

describe('서버 모양 맞추기 (assistant TS-15: MONDAY·10:30:00)', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    saveTokens({ accessToken: 't', expiresAt: new Date(Date.now() + 3_600_000).toISOString() })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    clearTokens()
  })

  const old = { classes: [{ dayOfWeek: 'MONDAY', startTime: '10:30:00', endTime: '12:00:00', name: 'AI응용프로젝트' }], updatedAt: '2026-11-09T17:00:00+09:00' }

  it('저장한 시간표를 MONDAY·10:30:00으로 받아도 MON·10:30으로 맞춰 요일 칸에 보이고 다시 저장할 수 있다', async () => {
    fetchMock.mockResolvedValue(json(200, old))
    const s = await getSchedule()
    expect(s?.classes).toEqual([c('MON', '10:30', '12:00', 'AI응용프로젝트')])
    expect(checkSchedule(s!.classes)).toBeNull()
  })

  it('저장 응답도 맞춘다', async () => {
    fetchMock.mockResolvedValue(json(200, old))
    const s = await saveSchedule([c('MON', '10:30', '12:00', 'AI응용프로젝트')])
    expect(s.classes[0]).toEqual(c('MON', '10:30', '12:00', 'AI응용프로젝트'))
  })

  it('모르는 요일은 그대로 두어 검사가 "요일을 골라 주세요"로 알린다', async () => {
    fetchMock.mockResolvedValue(json(200, { classes: [{ dayOfWeek: '월', startTime: '9:00', endTime: '10:30', name: 'x' }], dropped: 0, note: null }))
    const d = await parseScheduleImage(new Blob(['x']))
    expect(d.classes[0].startTime).toBe('09:00')
    expect(checkSchedule(d.classes)?.message).toBe('요일을 골라 주세요.')
  })
})
