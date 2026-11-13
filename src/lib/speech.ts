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

/**
 * 말을 멈춘 뒤 이만큼 조용하면 다 말한 것으로 보고 보낸다.
 * 브라우저 기본(continuous=false)은 1초도 안 되는 쉼에서 끊어 "내일… 오후 2시"가 "내일"만 가는 일이 있었다(11/11 재웅).
 */
export const SILENCE_MS = 2200
/** 한 번 듣기의 최대 길이. 넘으면 지금까지 들린 말로 끝낸다(켜 둔 채 잊지 않게) */
export const MAX_LISTEN_MS = 30_000
/** 브라우저가 스스로 듣기를 끝냈을 때 다시 켜는 최대 횟수 */
export const MAX_RESTARTS = 6
/** 멈춘 뒤 onend를 기다리는 최대 시간 */
const STOP_WAIT_MS = 1500

/**
 * 들린 조각을 한 문장으로 잇는다. 안드로이드 크롬은 이어 듣기에서 앞 조각을 다음 조각에 또 넣어 주기도 해서
 * ("내일" → "내일 오후 2시"), 앞 글로 시작하는 조각은 바꿔 끼운다. 그 밖의 조각은 같은 말이어도 그대로 잇는다("2시 2시").
 */
export function joinHeard(parts: string[]): string {
  let acc = ''
  for (const raw of parts) {
    const t = raw.trim()
    if (!t) continue
    if (!acc || t.startsWith(acc)) acc = t
    else acc = `${acc} ${t}`
  }
  return acc.replace(/\s+/g, ' ')
}

/**
 * 한 번 말하고 끝나는 듣기. 멈추는 함수를 돌려준다. 음성 인식이 없거나 시작하지 못하면 null.
 * 잠깐 쉬어도 끊지 않고, SILENCE_MS 동안 새 말이 없거나 멈춤 버튼을 누르면 그때까지 들린 말을 한 번 보낸다.
 * 멈춤 버튼은 브라우저를 기다리지 않고 그 자리에서 끝낸다(onEnd가 바로 불린다).
 * 브라우저가 쉼에서 스스로 끝내면(모바일 크롬·사파리) 다시 켜서 이어 듣는다.
 */
export function listenOnce(
  h: ListenHandlers,
  ctor: RecognitionCtor | null = recognitionCtor(),
  opts: { silenceMs?: number; maxMs?: number } = {},
): (() => void) | null {
  if (!ctor) return null
  const silenceMs = opts.silenceMs ?? SILENCE_MS
  const maxMs = opts.maxMs ?? MAX_LISTEN_MS
  const r = new ctor()
  r.lang = 'ko-KR'
  r.interimResults = true
  r.continuous = true
  r.maxAlternatives = 1
  /** 앞서 브라우저가 끝낸 판들에서 들린 말 */
  let committed = ''
  /** 이번 판에서 들린 말(확정 + 아직 바뀔 수 있는 말) */
  let current = ''
  let lastHeard = 0
  let restarts = 0
  let failed = false
  /** 다시 켜기가 막힌 브라우저(아이폰 사파리): 더 켜지 않고 들린 말로 끝낸다 */
  let noRestart = false
  let stopping = false
  let ended = false
  let silence: ReturnType<typeof setTimeout> | undefined
  let stopWait: ReturnType<typeof setTimeout> | undefined
  /** 지금까지 들린 말 전체. 판마다 들린 말은 서로 다른 말이라 겹침을 지우지 않고 그대로 잇는다 */
  const heard = () => [committed, current].filter(Boolean).join(' ')
  /** 지금까지 들린 말로 끝낸다(조용해짐·최대 길이). 멈춤 버튼은 아래 stopByUser */
  const finish = () => {
    if (stopping) return
    stopping = true
    clearTimeout(silence)
    // stop() 뒤에 onend가 오지 않는 브라우저에서도 듣기를 끝낸다. 마지막 결과가 아직 안 왔을 수 있어
    // 보내지는 않는다(입력 칸에 들린 글이 남아 학생이 고쳐 보내면 된다)
    stopWait = setTimeout(giveUp, STOP_WAIT_MS)
    try { r.stop() } catch { /* 이미 끝남 */ }
  }
  /** 멈춘 뒤 onend가 안 오면 보내지 않고 듣기만 끝낸다 */
  const giveUp = () => {
    if (ended) return
    ended = true
    clearTimeout(silence)
    clearTimeout(limit)
    try { r.abort() } catch { /* 이미 끝남 */ }
    h.onEnd()
  }
  const limit = setTimeout(finish, maxMs)
  r.onresult = (e) => {
    if (ended) return
    const finals: string[] = []
    let interim = ''
    // 이번 판의 결과 전체로 다시 만든다(resultIndex부터 이어 붙이면 브라우저마다 겹치거나 빠진다)
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i]
      const t = res[0]?.transcript ?? ''
      if (res.isFinal) finals.push(t)
      else interim += t
    }
    current = joinHeard([...finals, interim])
    h.onInterim(heard())
    if (!heard()) return
    lastHeard = Date.now()
    clearTimeout(silence)
    if (!stopping) silence = setTimeout(finish, silenceMs)
  }
  r.onerror = (e) => {
    if (ended) return
    // 다시 켠 뒤 조용해서 난 no-speech는 실패가 아니다(앞에서 들린 말을 보낸다)
    if (e.error === 'no-speech' && heard()) return
    // 쉼에서 우리가 다시 켠 판이 권한 오류로 막혔다: 아이폰 사파리는 버튼을 누르지 않은 start()를 not-allowed로 막는다.
    // 학생은 이미 허용했으니 권한 안내를 띄우지 않고, 다시 켜기만 그만두고 지금까지 들린 말로 끝낸다(11/13 영준)
    if (restarts > 0 && (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'aborted')) {
      noRestart = true
      return
    }
    // 사용자가 멈춘 것(aborted)은 오류로 알리지 않는다
    if (e.error !== 'aborted') h.onError(speechErrorLine(e.error))
    failed = true
  }
  r.onend = () => {
    if (ended) return
    // 브라우저가 짧은 쉼에서 스스로 끝냈다: 이어서 다시 듣는다
    if (!stopping && !failed && !noRestart && heard() && Date.now() - lastHeard < silenceMs && restarts < MAX_RESTARTS) {
      committed = heard()
      current = ''
      restarts += 1
      try {
        r.start()
        return
      } catch { /* 다시 켜지 못하면 지금까지 들린 말로 끝낸다 */ }
    }
    ended = true
    clearTimeout(silence)
    clearTimeout(limit)
    clearTimeout(stopWait)
    const text = heard()
    if (!failed && text) h.onFinal(text)
    h.onEnd()
  }
  try {
    r.start()
  } catch {
    clearTimeout(limit)
    h.onError(speechErrorLine('start-failed'))
    h.onEnd()
    return null
  }
  // 멈춤 버튼: 브라우저의 onend를 기다리지 않고 바로 끝내, 입력 칸에 보이는 말(지금까지 들린 말)을 보낸다.
  // 모바일(안드로이드 크롬·아이폰 사파리)은 stop() 뒤 onend가 늦거나 오지 않고, 다시 켜는 중에는 stop()을 무시하기도 해서
  // onend를 기다리면 눌러도 그대로 듣는 것처럼 보였다(11/13 영준). 그래서 abort()로 끊고 화면 상태를 먼저 끝낸다
  const stopByUser = () => {
    if (ended) return
    ended = true
    clearTimeout(silence)
    clearTimeout(limit)
    clearTimeout(stopWait)
    try { r.abort() } catch { /* 이미 끝남 */ }
    const text = heard()
    if (!failed && text) h.onFinal(text)
    h.onEnd()
  }
  return stopByUser
}

/** 음성 인식 오류 코드 → 학생에게 보여 줄 한 줄 */
export function speechErrorLine(code: string): string {
  switch (code) {
    case 'not-allowed':
      return '마이크가 막혀 있어요. 주소창 자물쇠에서 마이크를 허용하거나, 휴대폰 설정에서 이 브라우저의 마이크 권한을 켜 주세요. 카카오톡 안에서 열었으면 크롬·사파리로 열어 주세요.'
    case 'service-not-allowed':
      // 권한은 있어도 음성 인식 서비스를 못 쓰는 경우(아이폰 받아쓰기 꺼짐, 앱 안 브라우저)
      return '이 브라우저에서는 음성 인식을 쓸 수 없어요. 아이폰은 설정 > 일반 > 키보드에서 받아쓰기를 켜고, 카카오톡 안에서 열었으면 크롬·사파리로 열어 주세요.'
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
