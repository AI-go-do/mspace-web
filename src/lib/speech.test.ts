import { describe, expect, it, vi } from 'vitest'
import { canListen, canSpeak, listenOnce, listenSession, recognitionCtor, speak, speechErrorLine, toSpeech, type Recognition, type RecognitionEvent } from './speech'

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
  constructor() { FakeRecognition.last = this }
  start() { this.started = true }
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

  it('한국어로 듣고, 말하는 중 글은 입력 칸에, 끝나면 마지막 글을 한 번만 보낸다', () => {
    const h = handlers()
    listenOnce(h, FakeRecognition)
    const r = FakeRecognition.last!
    expect(r.lang).toBe('ko-KR')
    expect(r.interimResults).toBe(true)
    expect(r.started).toBe(true)
    r.say([{ t: '내일 오후', final: false }])
    expect(h.onInterim).toHaveBeenLastCalledWith('내일 오후')
    r.say([{ t: '내일 오후 2시 빈 방 있어', final: true }])
    r.onend!()
    r.onend!() // 브라우저가 두 번 불러도 한 번만
    expect(h.onFinal).toHaveBeenCalledTimes(1)
    expect(h.onFinal).toHaveBeenCalledWith('내일 오후 2시 빈 방 있어')
    expect(h.onEnd).toHaveBeenCalledTimes(1)
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

  it('음성 인식이 없는 브라우저면 null', () => {
    expect(listenOnce(handlers(), null)).toBeNull()
  })

  it('마이크 권한이 막혔으면 바꾸는 곳을 알려 준다', () => {
    expect(speechErrorLine('not-allowed')).toContain('권한')
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
