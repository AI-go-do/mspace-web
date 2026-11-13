import { afterEach, describe, expect, it, vi } from 'vitest'
import { canListen, canSpeak, joinHeard, listenOnce, MAX_RESTARTS, NO_RESULT_MS, SILENCE_MS, listenSession, recognitionCtor, speak, speechErrorLine, toSpeech, type Recognition, type RecognitionEvent } from './speech'

/** 테스트용 가짜 음성 인식. 만든 것을 last에 둔다 */
class FakeRecognition implements Recognition {
  static last: FakeRecognition | null = null
  lang = ''
  interimResults = false
  continuous = true
  maxAlternatives = 0
  onresult: ((e: RecognitionEvent) => void) | null = null
  onerror: ((e: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  started = false
  starts = 0
  constructor() { FakeRecognition.last = this }
  start() { this.started = true; this.starts += 1 }
  stop() { this.onend?.() }
  abort() { this.onerror?.({ error: 'aborted' }); this.onend?.() }
  say(parts: { t: string; final: boolean }[]) {
    const results = parts.map((p) => ({ isFinal: p.final, 0: { transcript: p.t }, length: 1 }))
    this.onresult?.({ resultIndex: 0, results })
  }
}

function handlers() {
  return { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onEnd: vi.fn() }
}

afterEach(() => { vi.useRealTimers() })

describe('조각 잇기', () => {
  it('안드로이드처럼 앞 조각을 또 넣어 줘도 한 번만 잇는다', () => {
    expect(joinHeard(['내일', '내일 오후 2시', '빈 방'])).toBe('내일 오후 2시 빈 방')
    expect(joinHeard(['내일 오후', ' 2시 ', ' 2시'])).toBe('내일 오후 2시 2시') // 따로 들린 같은 말은 지우지 않는다
    expect(joinHeard(['', '  '])).toBe('')
  })
})

describe('음성 기능 찾기', () => {
  it('표준 이름이 없으면 webkit 접두사 이름을 쓰고, 둘 다 없으면 마이크 버튼을 숨긴다(파이어폭스)', () => {
    expect(recognitionCtor({ webkitSpeechRecognition: FakeRecognition })).toBe(FakeRecognition)
    expect(canListen({})).toBe(false)
    expect(canListen(undefined)).toBe(false)
  })

  it('읽어 주기는 speechSynthesis와 Utterance가 둘 다 있어야 된다', () => {
    expect(canSpeak({})).toBe(false)
  })
})

describe('한 번 듣고 보내기', () => {
  it('시작하지 못하면(start가 던짐) null을 돌려줘 화면이 듣는 중으로 바뀌지 않는다', () => {
    class Broken extends FakeRecognition { start(): void { throw new Error('not-allowed') } }
    const h = handlers()
    expect(listenOnce(h, Broken)).toBeNull()
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('한국어로 이어 듣고, 말하는 중 글은 입력 칸에, 다 말하고 조용해지면 한 번만 보낸다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    expect(r.lang).toBe('ko-KR')
    expect(r.interimResults).toBe(true)
    expect(r.continuous).toBe(true)
    expect(r.started).toBe(true)
    r.say([{ t: '내일 오후', final: false }])
    expect(h.onInterim).toHaveBeenLastCalledWith('내일 오후')
    r.say([{ t: '내일 오후 2시 빈 방 있어', final: true }])
    vi.advanceTimersByTime(SILENCE_MS - 1)
    expect(h.onFinal).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    r.onend!() // 브라우저가 두 번 불러도 한 번만
    expect(h.onFinal).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith('내일 오후 2시 빈 방 있어')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('말하다 잠깐 쉬어도 보내지 않고, 이어 말한 것까지 모아 보낸다(11/11 중간에 보내짐)', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내일', final: true }])
    vi.advanceTimersByTime(1200)
    r.say([{ t: '내일', final: true }, { t: ' 오후 2시 빈 방', final: false }])
    vi.advanceTimersByTime(1200)
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onInterim).toHaveBeenLastCalledWith('내일 오후 2시 빈 방')
    r.say([{ t: '내일', final: true }, { t: ' 오후 2시 빈 방', final: true }])
    vi.advanceTimersByTime(SILENCE_MS)
    expect(h.onFinal).toHaveBeenCalledWith('내일 오후 2시 빈 방')
  })

  it('브라우저가 짧은 쉼에서 스스로 끝내면 다시 켜서 이어 듣는다(모바일)', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '수업 끝나고', final: true }])
    r.onend!()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onEnd).not.toHaveBeenCalled()
    expect(r.starts).toBe(2)
    r.say([{ t: '2시간 잡아 줘', final: true }])
    expect(h.onInterim).toHaveBeenLastCalledWith('수업 끝나고 2시간 잡아 줘')
    // 다시 켠 뒤 조용해서 난 no-speech는 실패가 아니다
    r.onerror!({ error: 'no-speech' })
    vi.advanceTimersByTime(SILENCE_MS)
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onFinal).toHaveBeenCalledWith('수업 끝나고 2시간 잡아 줘')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('다시 켠 판에서 같은 말을 또 해도 지우지 않는다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '2시', final: true }])
    r.onend!()
    r.say([{ t: '2시', final: true }])
    vi.advanceTimersByTime(SILENCE_MS)
    expect(h.onFinal).toHaveBeenCalledWith('2시 2시')
  })

  it('조용해진 뒤 브라우저가 끝내면 다시 켜지 않고 보낸다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내 예약 보여 줘', final: true }])
    vi.setSystemTime(Date.now() + SILENCE_MS + 10)
    r.onend!()
    expect(r.starts).toBe(1)
    expect(h.onFinal).toHaveBeenCalledWith('내 예약 보여 줘')
  })

  it('브라우저가 계속 끊어도 정해진 횟수까지만 다시 켜고 들린 말을 보낸다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    for (let i = 0; i <= MAX_RESTARTS; i++) {
      r.say([{ t: `말${i}`, final: true }])
      r.onend!()
    }
    expect(r.starts).toBe(MAX_RESTARTS + 1)
    expect(h.onFinal).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith(Array.from({ length: MAX_RESTARTS + 1 }, (_, i) => `말${i}`).join(' '))
  })

  it('조용해져 멈춘 뒤 브라우저가 onend를 안 주면 잠시 뒤 듣기만 끝내고, 덜 된 말은 보내지 않는다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)!
    const r = FakeRecognition.last!
    r.stop = () => { /* onend를 주지 않는 브라우저 */ }
    r.abort = () => { /* 이것도 아무 일 없음 */ }
    r.say([{ t: '지금 빈', final: false }])
    vi.advanceTimersByTime(SILENCE_MS)
    expect(h.onEnd).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1500)
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(h.onFinal).not.toHaveBeenCalled()
    // 마지막 결과·onend가 늦게 와도 보내지 않고 입력 칸 글도 바꾸지 않는다
    const interimCalls = h.onInterim.mock.calls.length
    r.say([{ t: '지금 빈 방', final: true }])
    r.onend!()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onInterim).toHaveBeenCalledTimes(interimCalls)
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('한참 말해도 최대 길이가 되면 그때까지 들린 말로 끝낸다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition, { maxMs: 5000 })
    const r = FakeRecognition.last!
    for (let i = 0; i < 6; i++) {
      r.say([{ t: '음 그러니까', final: false }])
      vi.advanceTimersByTime(1000)
    }
    expect(h.onFinal).toHaveBeenCalledWith('음 그러니까')
  })

  it('폰: 켜진 뒤 글도 오류도 안 오면 정해진 시간 뒤 듣기를 끝내고 알린다(11/13 "듣고 있어요"만 뜸)', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.stop = () => { /* 아무 일 없음 */ }
    r.abort = () => { /* 아무 일 없음 */ }
    vi.advanceTimersByTime(NO_RESULT_MS - 1)
    expect(h.onEnd).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(h.onError).toHaveBeenCalledWith(speechErrorLine('no-result'))
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(h.onFinal).not.toHaveBeenCalled()
    // 늦게 온 결과·onend는 무시한다
    r.say([{ t: '내일', final: true }])
    r.onend!()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('말이 들리기 시작했으면 정해진 시간이 지나도 끊지 않는다', () => {
    vi.useFakeTimers()
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내일 오후', final: false }])
    vi.advanceTimersByTime(1000)
    r.say([{ t: '내일 오후 두 시', final: false }])
    // 쉬지 않고 이어 말해 듣기가 NO_RESULT_MS를 넘겨도 켜져 있어야 한다
    for (let elapsed = 1000; elapsed < NO_RESULT_MS; elapsed += 1000) {
      vi.advanceTimersByTime(1000)
      r.say([{ t: '내일 오후 두 시', final: false }])
    }
    vi.advanceTimersByTime(1000)
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onEnd).not.toHaveBeenCalled()
    vi.advanceTimersByTime(SILENCE_MS)
    expect(h.onFinal).toHaveBeenCalledWith('내일 오후 두 시')
  })

  it('아무 말도 안 하면 보내지 않고 안내만 한다', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.onerror!({ error: 'no-speech' })
    r.onend!()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledWith(speechErrorLine('no-speech'))
    expect(h.onEnd).toHaveBeenCalled()
  })

  it('오류가 난 뒤에는 들린 말이 있어도 보내지 않는다(잘린 말로 예약 요청이 가지 않게)', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내 예약 취소', final: true }])
    r.onerror!({ error: 'network' })
    r.onend!()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onError).toHaveBeenCalledWith(expect.stringContaining('인터넷'))
  })

  it('학생이 멈춘 것(aborted)은 오류로 알리지 않는다', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    FakeRecognition.last!.abort()
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onEnd).toHaveBeenCalled()
  })

  it('멈춤 버튼은 지금까지 들린 말로 끝내 보낸다', () => {
    const h = handlers()
    const stop = listenOnce(h, FakeRecognition)!
    FakeRecognition.last!.say([{ t: '지금 빈 방', final: true }])
    stop()
    expect(h.onFinal).toHaveBeenCalledWith('지금 빈 방')
  })

  it('모바일: 브라우저가 stop·abort 뒤 onend를 안 줘도 멈춤 버튼은 바로 끝내고 보이는 말을 보낸다(11/13)', () => {
    const h = handlers()
    const stop = listenOnce(h, FakeRecognition)!
    const r = FakeRecognition.last!
    r.stop = () => { /* onend를 주지 않는 브라우저 */ }
    r.abort = () => { /* 이것도 아무 일 없음 */ }
    r.say([{ t: '지금 빈 방', final: false }])
    stop()
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith('지금 빈 방')
    // 늦게 오는 결과·onend·두 번 누름은 무시한다
    r.say([{ t: '지금 빈 방 있어', final: true }])
    r.onend!()
    stop()
    expect(h.onFinal).toHaveBeenCalledTimes(1)
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('모바일: 브라우저가 스스로 끝내 다시 켜는 중에 눌러도 멈춘다(다시 켜지 않음)', () => {
    vi.useFakeTimers()
    const h = handlers()
    const stop = listenOnce(h, FakeRecognition)!
    const r = FakeRecognition.last!
    r.say([{ t: '수업 끝나고', final: true }])
    r.onend!() // 다시 켬
    r.stop = () => { /* 켜는 중이라 무시 */ }
    stop()
    expect(h.onEnd).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith('수업 끝나고')
    r.onend!()
    vi.advanceTimersByTime(SILENCE_MS * 2)
    expect(r.starts).toBe(2)
    expect(h.onFinal).toHaveBeenCalledTimes(1)
  })

  it('아무 말도 하기 전에 멈추면 보내지 않고 끝낸다', () => {
    const h = handlers()
    const stop = listenOnce(h, FakeRecognition)!
    stop()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('아이폰: 쉼에서 다시 켠 판이 not-allowed로 막히면 권한 안내 없이 들린 말을 보낸다(11/13)', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내일 오후 2시 빈 방', final: true }])
    r.onend!() // 다시 켬(버튼 누름 없이)
    expect(r.starts).toBe(2)
    r.onerror!({ error: 'not-allowed' })
    r.onend!()
    expect(h.onError).not.toHaveBeenCalled()
    expect(r.starts).toBe(2) // 또 켜지 않는다
    expect(h.onFinal).toHaveBeenCalledWith('내일 오후 2시 빈 방')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('다시 켠 판이 aborted로 끝나면(브라우저에서 취소) 보내지 않는다', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.say([{ t: '내 예약 취소', final: true }])
    r.onend!() // 다시 켬
    r.onerror!({ error: 'aborted' })
    r.onend!()
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.onFinal).not.toHaveBeenCalled()
    expect(h.onEnd).toHaveBeenCalledTimes(1)
  })

  it('처음 누른 판의 not-allowed는 진짜 권한 문제라 안내하고 보내지 않는다', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    r.onerror!({ error: 'not-allowed' })
    r.onend!()
    expect(h.onError).toHaveBeenCalledWith(speechErrorLine('not-allowed'))
    expect(h.onFinal).not.toHaveBeenCalled()
  })

  it('권한 거부와 음성 인식 서비스 없음은 다른 안내를 보여 준다', () => {
    expect(speechErrorLine('not-allowed')).toContain('마이크')
    expect(speechErrorLine('service-not-allowed')).toContain('받아쓰기')
    expect(speechErrorLine('service-not-allowed')).not.toBe(speechErrorLine('not-allowed'))
  })

  it('음성 인식이 없는 브라우저면 null', () => {
    expect(listenOnce(handlers(), null)).toBeNull()
  })

  it('마이크 권한이 막혔으면 바꾸는 곳을 알려 준다', () => {
    expect(speechErrorLine('not-allowed')).toContain('권한')
    expect(speechErrorLine('service-not-allowed')).toContain('받아쓰기')
    expect(speechErrorLine('뭔지 모름')).toContain('글로 적어')
  })
})

describe('읽어 줄 문장 다듬기', () => {
  it('화살표·별표·그림 문자를 빼고, 시간 범위는 "부터"로 읽는다', () => {
    expect(toSpeech('**2번 방** 14:30–16:30 → 잡을까요? 😊')).toBe('2번 방 14:30부터 16:30 잡을까요?')
  })

  it('줄바꿈은 문장 끊기로 바꾼다', () => {
    expect(toSpeech('오늘 수업은 2개예요.\n지금 빈 방은 3개예요')).toBe('오늘 수업은 2개예요. 지금 빈 방은 3개예요')
  })
})

describe('읽어 주기', () => {
  function fakeSynth() {
    const spoken: { text: string; lang: string }[] = []
    class Utter { text: string; lang = ''; rate = 1; volume = 1; voice: unknown = null; onend: (() => void) | null = null; onerror: (() => void) | null = null
      constructor(t: string) { this.text = t } }
    const synth = {
      cancel: vi.fn(),
      speak: vi.fn((u: Utter) => { spoken.push({ text: u.text, lang: u.lang }); u.onend?.() }),
      getVoices: () => [{ lang: 'en-US' }, { lang: 'ko-KR', name: '유나' }],
    }
    return { w: { speechSynthesis: synth as unknown as SpeechSynthesis, SpeechSynthesisUtterance: Utter as unknown as typeof SpeechSynthesisUtterance }, synth, spoken }
  }

  it('앞에 읽던 것을 끊고 한국어 목소리로 읽은 뒤 끝을 알린다', () => {
    const { w, synth, spoken } = fakeSynth()
    const done = vi.fn()
    expect(speak('지금 빈 방은 3개예요', done, w)).toBe(true)
    expect(synth.cancel).toHaveBeenCalled()
    expect(spoken).toEqual([{ text: '지금 빈 방은 3개예요', lang: 'ko-KR' }])
    expect(done).toHaveBeenCalled()
  })

  it('읽을 글이 없거나 기능이 없으면 false', () => {
    const { w } = fakeSynth()
    expect(speak('→ 😊', undefined, w)).toBe(false)
    expect(speak('안녕', undefined, {})).toBe(false)
  })
})

describe('듣기 주인 확인', () => {
  it('회원을 모르면 듣기를 시작하지 않는다(다른 회원으로 보내지지 않게)', () => {
    expect(listenSession(() => null)).toBeNull()
  })

  it('듣는 중 다른 회원으로 바뀌면 늦게 온 결과는 버린다', () => {
    let member: number | null = 1
    const s = listenSession(() => member)!
    expect(s.live()).toBe(true)
    member = 2
    expect(s.live()).toBe(false)
    member = 1 // 다시 돌아와도 같은 회원이면 살아 있다
    expect(s.live()).toBe(true)
  })

  it('무효로 한 듣기는 회원이 같아도 버린다(멈춘 뒤 늦게 온 중간·마지막 결과)', () => {
    const s = listenSession(() => 1)!
    s.invalidate()
    expect(s.live()).toBe(false)
  })
})
