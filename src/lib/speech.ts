/**
 * 음성 입력(STT)·읽어 주기(TTS). 브라우저 기본 기능(Web Speech API)만 써서 돈·서버가 들지 않는다.
 * - 듣기: SpeechRecognition(크롬·엣지·사파리는 webkit 접두사). 파이어폭스는 없어서 마이크 버튼을 숨긴다
 * - 읽기: speechSynthesis. 거의 모든 브라우저에 있다
 * 크롬의 음성 인식은 소리를 구글 서버로 보내 글로 바꾼다(확인 필요: 기기 안 인식은 브라우저·버전마다 다름).
 * 그래서 화면에 "말한 내용이 글로 바뀌어 비서에게 가요"를 적고, 이름·학번은 말하지 말라고 안내한다.
 */

/** 브라우저 음성 인식 결과 하나(필요한 것만) */
export interface RecognitionAlternative { transcript: string }
export interface RecognitionResult { isFinal: boolean; 0: RecognitionAlternative; length: number }
export interface RecognitionEvent { resultIndex: number; results: ArrayLike<RecognitionResult> }

/** 브라우저 SpeechRecognition 중 쓰는 부분만 */
export interface Recognition {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: RecognitionEvent) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type RecognitionCtor = new () => Recognition

type SpeechWindow = {
  SpeechRecognition?: RecognitionCtor
  webkitSpeechRecognition?: RecognitionCtor
  speechSynthesis?: SpeechSynthesis
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance
}

function win(): SpeechWindow | undefined {
  return typeof window === 'undefined' ? undefined : (window as unknown as SpeechWindow)
}

/** 음성 인식 생성자. 없으면 null (파이어폭스, 오래된 브라우저) */
export function recognitionCtor(w: SpeechWindow | undefined = win()): RecognitionCtor | null {
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null
}

export function canListen(w: SpeechWindow | undefined = win()): boolean {
  return recognitionCtor(w) !== null
}

export function canSpeak(w: SpeechWindow | undefined = win()): boolean {
  return !!w?.speechSynthesis && !!w?.SpeechSynthesisUtterance
}

export interface ListenHandlers {
  /** 말하는 중 지금까지 들린 글(화면 입력 칸에 그대로 보여 준다) */
  onInterim(text: string): void
  /** 말이 끝났다. 이 글을 보낸다 */
  onFinal(text: string): void
  /** 실패 안내 문장 */
  onError(message: string): void
  /** 듣기가 끝났다(성공·실패·취소 모두) */
  onEnd(): void
}

/** 한 번 말하고 끝나는 듣기. 멈추는 함수를 돌려준다. 음성 인식이 없으면 null */
export function listenOnce(h: ListenHandlers, ctor: RecognitionCtor | null = recognitionCtor()): (() => void) | null {
  if (!ctor) return null
  const r = new ctor()
  r.lang = 'ko-KR'
  r.interimResults = true
  r.continuous = false
  r.maxAlternatives = 1
  let finalText = ''
  let sent = false
  let ended = false
  r.onresult = (e) => {
    let interim = ''
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i]
      const t = res[0]?.transcript ?? ''
      if (res.isFinal) finalText += t
      else interim += t
    }
    h.onInterim((finalText + interim).trim())
  }
  r.onerror = (e) => {
    // 사용자가 멈춘 것(aborted)은 오류로 알리지 않는다
    if (e.error !== 'aborted') h.onError(speechErrorLine(e.error))
    sent = true
  }
  r.onend = () => {
    if (ended) return
    ended = true
    const text = finalText.trim()
    if (!sent && text) {
      sent = true
      h.onFinal(text)
    }
    h.onEnd()
  }
  try {
    r.start()
  } catch {
    h.onError(speechErrorLine('start-failed'))
    h.onEnd()
    return () => undefined
  }
  // 멈춤 버튼: 지금까지 들린 말로 끝낸다(stop은 onend 전에 마지막 결과를 준다)
  return () => {
    try { r.stop() } catch { /* 이미 끝남 */ }
  }
}

/** 음성 인식 오류 코드 → 학생에게 보여 줄 한 줄 */
export function speechErrorLine(code: string): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return '마이크 권한을 허용해 주세요. 주소창 왼쪽 자물쇠에서 바꿀 수 있어요.'
    case 'no-speech':
      return '말소리가 들리지 않았어요. 마이크를 누르고 다시 말해 주세요.'
    case 'audio-capture':
      return '마이크를 찾지 못했어요. 마이크가 연결돼 있는지 확인해 주세요.'
    case 'network':
      return '음성 인식은 인터넷이 필요해요. 연결을 확인하거나 글로 적어 주세요.'
    default:
      return '음성을 알아듣지 못했어요. 다시 말하거나 글로 적어 주세요.'
  }
}

/**
 * 읽어 줄 문장으로 다듬는다. 화살표·별표·괄호 속 영어 코드처럼 소리 내면 어색한 것을 뺀다.
 * "14:30–16:30"은 "14:30부터 16:30"으로 읽게 바꾼다.
 */
export function toSpeech(text: string): string {
  return text
    .replace(/\*\*|__|`/g, '')
    .replace(/[→▶•·]/g, ' ')
    .replace(/(\d{1,2}:\d{2})\s*[–~-]\s*(\d{1,2}:\d{2})/g, '$1부터 $2')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '. ')
    .replace(/\.\s*\./g, '.')
    .trim()
}

/** 읽어 주기. 앞에 읽던 것은 끊는다. 읽을 수 없으면 false */
export function speak(text: string, onEnd?: () => void, w: SpeechWindow | undefined = win()): boolean {
  if (!canSpeak(w)) return false
  const say = toSpeech(text)
  if (!say) return false
  const synth = w!.speechSynthesis!
  synth.cancel()
  const u = new w!.SpeechSynthesisUtterance!(say)
  u.lang = 'ko-KR'
  u.rate = 1.05
  const ko = synth.getVoices?.().find((v) => v.lang?.toLowerCase().startsWith('ko'))
  if (ko) u.voice = ko
  if (onEnd) {
    u.onend = () => onEnd()
    u.onerror = () => onEnd()
  }
  synth.speak(u)
  return true
}

export function stopSpeaking(w: SpeechWindow | undefined = win()): void {
  w?.speechSynthesis?.cancel()
}

/**
 * 아이폰 사파리는 사용자가 누른 순간에 한 번 말해 둬야 나중(답이 온 뒤) 읽기가 된다(확인 필요).
 * 마이크 버튼을 누를 때 빈 문장을 한 번 읽어 길을 열어 둔다.
 */
export function primeSpeech(w: SpeechWindow | undefined = win()): void {
  if (!canSpeak(w)) return
  try {
    const u = new w!.SpeechSynthesisUtterance!(' ')
    u.volume = 0
    w!.speechSynthesis!.speak(u)
  } catch { /* 무시 */ }
}

/**
 * 듣기 한 번의 "주인" 확인. 시작한 회원과 지금 회원이 같고, 그 뒤 무효로 하지 않았을 때만 live.
 * 회원을 모르면(null) 시작하지 않는다(null을 돌려줌). 늦게 오는 중간·마지막 결과를 거르는 데 쓴다.
 */
export function listenSession(currentMember: () => number | null): { live(): boolean; invalidate(): void } | null {
  const owner = currentMember()
  if (owner === null) return null
  let valid = true
  return {
    live: () => valid && currentMember() === owner,
    invalidate: () => { valid = false },
  }
}
