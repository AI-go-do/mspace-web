import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { clearChatHistory, confirmCard, HINT_OPEN_SCHEDULE, HINT_PICK_FRIENDS, submitChat, waitForChat, type ChatConfirmation, type ChatResult } from '../api/agent'
import { ApiError, currentMemberId, refreshTokens } from '../api/client'
import { deniedLine } from '../content/denied'
import { findFriend, getFriends, type Friend } from '../api/friends'
import { matchFriends } from '../lib/friendMatch'
import { peekPicked, savePicked, takePicked } from '../lib/pickedFriends'
import { getTeams, knownTeams, saveTeam, TEAM_NAME_MAX, teamFriends, teamInMessage, type Team } from '../api/teams'
import Spacey from '../components/Spacey'
import { cardOutcomeOf, clearChatOf, clearSubmitting, currentClearing, currentSubmitting, historyOf, loadChat, newMessageId, saveCardOutcome, saveChat, rememberClearing, setSubmitting, watchCardOutcome, watchChat, type CardOutcome, type ChatMessage, type ChatState, type PastCard } from '../lib/chatStore'
import { BACK_LABEL, MAIN_PROMPTS, type PromptChip } from '../lib/prompts'
import { canListen, canSpeak, listenOnce, listenSession, primeSpeech, speak, stopSpeaking } from '../lib/speech'
import { seoulClock } from '../lib/time'
import { useNow } from '../lib/useNow'
import './Assistant.css'

/** 간단히 예약하기 첫 질문과 예시 답 (FR-AGT-105). 한 번에 다 말하면 비서가 바로 확인 카드까지 간다 */
export const QUICK_GREETING = '언제, 누구랑 쓰실 건가요? 말로 해 주셔도 돼요. 저장한 팀이 있으면 "팀 A랑 내일 3시"처럼 말하면 돼요.'
export const QUICK_STARTERS = ['내일 오후 3시부터 2시간, 나 포함 4명', '오늘 수업 끝나고 2시간, 나 포함 3명', '지금 바로 1시간, 나 포함 3명']

/** 서버 기준(1,000자)과 같게 */
const MAX_CHARS = 1000

/** 버튼 글을 보내는 함수. 확인 카드·말풍선 아래 버튼이 같이 쓴다 */
type Ask = (message: string) => void

/**
 * 비서 스페이시 (FR-AGT-101, docs api 7장).
 * 보내면 접수 번호를 받고 1초마다 결과를 조회한다. 답을 기다리는 동안에는 새 말을 보내지 않는다
 * (서버도 학생 한 명당 한 건만 받는다, 409). 쓰기는 확인 카드의 [확인]을 눌러야 한다.
 */
export default function Assistant() {
  const [chat, setChat] = useState<ChatState>(() => loadChat(currentMemberId()))
  const [text, setText] = useState('')
  const [waitingSec, setWaitingSec] = useState(0)
  // 추천 메뉴에서 펼친 단계(방 예약 → 언제). null이면 처음 메뉴
  const [menu, setMenu] = useState<PromptChip[] | null>(null)
  // 음성: 듣는 중이면 멈추는 함수. 마이크로 보낸 말의 답은 소리로 읽어 준다
  const [listening, setListening] = useState(false)
  const [voiceNote, setVoiceNote] = useState('')
  const [speakingId, setSpeakingId] = useState<number | null>(null)
  const stopListen = useRef<(() => void) | null>(null)
  // 듣는 중에는 손으로 보내기·추천 버튼을 막는다(같은 말이 두 번 가거나 음성 말이 버려지지 않게)
  const listeningNow = useRef(false)
  // 지금 듣기의 주인 확인. 회원이 바뀌면 무효로 해서 앞 듣기의 늦은 결과(중간·마지막)를 버린다
  const session = useRef<ReturnType<typeof listenSession>>(null)
  // 화면 전환(ViewTransition) 중에는 useEffect 정리가 늦을 수 있어, 떠난 것을 layout 정리에서 먼저 표시한다
  const left = useRef(false)
  useLayoutEffect(() => {
    left.current = false
    return () => { left.current = true }
  }, [])
  const readNext = useRef(false)
  const micOk = useRef(canListen()).current
  const ttsOk = useRef(canSpeak()).current
  // 새 대화로 지우는 중. 화면을 떠났다 와도 이어지게 저장소의 지우기 요청에서 시작한다
  const [clearing, setClearing] = useState(() => currentClearing(currentMemberId()) !== null)
  const listEnd = useRef<HTMLDivElement>(null)
  // 내 팀(FR-AGT-105). "팀 A랑"이 들어간 말을 보낼 때 그 팀원을 확인 카드에 미리 채우려고 미리 받아 둔다(api/teams가 기억)
  function refreshTeams(owner: number | null) {
    getTeams(owner).catch(() => { /* 팀 없이 */ })
  }
  useEffect(() => { refreshTeams(currentMemberId()) }, [chat.memberId])
  // 홈 [AI로 간단히 예약하기] → /assistant?quick=1 (FR-AGT-105)
  const [params] = useSearchParams()
  const navigate = useNavigate()
  // 화면을 떠나면 조회를 멈춘다(접수 번호는 남겨 두고 돌아오면 이어서 조회)
  const alive = useRef<AbortController | null>(null)
  const mounted = useRef(true)

  /**
   * 기록은 화면 밖 저장소가 기준이다. 화면을 떠난 뒤 끝난 일도 기록에는 남는다.
   * owner를 주면 그 회원이 아직 로그인해 있을 때만 쓴다(다른 회원 기록에 섞이지 않게).
   */
  function update(fn: (s: ChatState) => ChatState, owner?: number | null) {
    const memberId = currentMemberId()
    if (owner !== undefined && owner !== memberId) return
    const next = fn(loadChat(memberId))
    saveChat(next)
    if (mounted.current) setChat(next)
  }

  function addReply(result: ChatResult, owner: number | null) {
    const id = newMessageId()
    update((s) => ({
      ...s,
      pending: null,
      messages: [...s.messages, {
        id, role: 'assistant', text: result.reply,
        confirmations: result.confirmations, accessCodeCards: result.accessCodeCards,
        suggestions: result.suggestions ?? [], hints: result.hints ?? [],
      }],
    }), owner)
    // 마이크로 물었으면 답도 소리로. 화면을 떠났거나 그사이 회원이 바뀌었으면 읽지 않는다(앞 회원 답을 소리로 내지 않게)
    const readIt = readNext.current
    readNext.current = false
    if (readIt && mounted.current && ttsOk && owner === currentMemberId()) read(id, result.reply)
  }

  function read(id: number, text: string) {
    if (speakingId === id) {
      stopSpeaking()
      setSpeakingId(null)
      return
    }
    if (speak(text, () => { if (mounted.current) setSpeakingId((cur) => (cur === id ? null : cur)) })) setSpeakingId(id)
  }

  /** 마이크: 한 번 말하면 글로 바꿔 바로 보낸다. 듣는 중에 누르면 지금까지 들린 말로 끝낸다 */
  function toggleMic() {
    if (listening) {
      stopListen.current?.()
      return
    }
    stopSpeaking()
    setSpeakingId(null)
    primeSpeech()
    setVoiceNote('')
    // 들은 말은 듣기를 시작한 회원 것만 보낸다(그사이 다른 탭에서 다른 학생이 로그인하면 버린다).
    // 회원을 아직 모르면(로그인 확인 실패 등) 듣지 않는다
    const s = listenSession(currentMemberId)
    if (!s) {
      setVoiceNote('로그인 정보를 확인하는 중이에요. 잠시 뒤 다시 눌러 주세요.')
      return
    }
    session.current = s
    const live = s.live
    const stop = listenOnce({
      onInterim: (t) => { if (live()) setText(t) },
      onFinal: (t) => {
        listeningNow.current = false
        // 화면을 떠나며 멈춘 듣기는 보내지 않는다(학생이 보내기로 한 말이 아니다)
        if (!mounted.current || left.current || !live()) return
        readNext.current = true
        void send(t, true)
      },
      onError: (m) => setVoiceNote(m),
      onEnd: () => {
        listeningNow.current = false
        stopListen.current = null
        if (mounted.current) setListening(false)
      },
    })
    if (stop) {
      listeningNow.current = true
      stopListen.current = stop
      setListening(true)
    }
  }

  /** 추천 버튼: 다음 단계가 있으면 펼치고, 아니면 그 말을 보낸다 */
  function pick(c: PromptChip) {
    if (c.next) return setMenu(c.next)
    setMenu(null)
    if (c.message) void send(c.message)
  }

  const ask: Ask = (m) => {
    setMenu(null)
    void send(m)
  }

  function addError(message: string, owner: number | null) {
    readNext.current = false
    update((s) => ({ ...s, pending: null, messages: [...s.messages, { id: newMessageId(), role: 'assistant', text: message, error: true }] }), owner)
  }

  async function follow(jobId: string, startedAt: number, pollAfterMs?: number, owner: number | null = currentMemberId()) {
    if (!mounted.current) return
    alive.current?.abort()
    const ctrl = new AbortController()
    alive.current = ctrl
    try {
      const result = await waitForChat({ jobId, status: 'PENDING', pollAfterMs }, { signal: ctrl.signal, startedAt, member: owner })
      if (!ctrl.signal.aborted) addReply(result, owner)
    } catch (e) {
      if (ctrl.signal.aborted) return
      addError(e instanceof Error ? e.message : '비서가 답하지 못했어요. 다시 보내 주세요.', owner)
    }
  }

  // 돌아왔을 때 기다리던 답이 있으면 이어서 조회한다
  useEffect(() => {
    mounted.current = true
    const memberId = currentMemberId()
    const p = loadChat(memberId).pending
    const inflight = currentSubmitting(memberId)
    if (p?.jobId) void follow(p.jobId, p.startedAt, p.pollAfterMs, memberId)
    // 접수 요청이 아직 안 끝났다: 끝나면 그 번호로 조회한다.
    // 실패하면 보낸 쪽이 저장소에 안내를 남기므로(먼저 실행됨) 이 화면은 저장소에서 다시 읽는다
    else if (p && inflight) inflight.then(
      (j) => { if (currentMemberId() === memberId) void follow(j.jobId, p.startedAt, j.pollAfterMs, memberId) },
      () => { if (mounted.current) setChat(loadChat(currentMemberId())) },
    )
    // 접수 중이던 기록만 남고 요청은 없다(예: 새로고침 직전): 다시 보내게 푼다
    else if (p) update((s) => ({ ...s, pending: null }))
    // 떠나기 전에 누른 "새 대화"가 아직 안 끝났다: 끝나면 저장소(비워졌거나 그대로)를 다시 읽는다
    const clearingNow = currentClearing(memberId)
    if (clearingNow) {
      const reload = () => {
        if (!mounted.current) return
        setChat(loadChat(currentMemberId()))
        setClearing(false)
      }
      clearingNow.then(reload, reload)
    }
    return () => {
      mounted.current = false
      alive.current?.abort()
      // 화면을 떠나며 멈출 때 늦게 오는 중간·마지막 결과도 같은 방식으로 버린다
      session.current?.invalidate()
      stopListen.current?.()
      stopSpeaking()
    }
  }, [])

  // 간단히 예약하기: 첫 질문은 화면이 띄우고 읽는다(모델 호출 없음). 주소의 ?quick=1은 지워서 새로고침에 또 뜨지 않게 한다
  useEffect(() => {
    if (params.get('quick') !== '1') return
    navigate('/assistant', { replace: true })
    const owner = currentMemberId()
    const now = loadChat(owner)
    // 이미 첫 질문이 마지막 말이면 다시 붙이지 않는다(개발 모드 StrictMode 두 번 실행, 홈 버튼 연타)
    if (now.pending !== null || now.messages.at(-1)?.text === QUICK_GREETING) return
    const id = newMessageId()
    update((s) => ({ ...s, messages: [...s.messages, { id, role: 'assistant', text: QUICK_GREETING, suggestions: QUICK_STARTERS }] }), owner)
    if (ttsOk) read(id, QUICK_GREETING)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  // 같은 브라우저 다른 탭에서 다른 학생이 로그인하면 이 탭의 토큰도 그 학생 것으로 바뀐다.
  // 그때 앞 학생의 대화·확인 카드가 화면에 남지 않게, 회원이 바뀌면 조회를 멈추고 그 회원 기록으로 바꾼다
  useEffect(() => {
    const check = () => {
      const memberId = currentMemberId()
      if (memberId === chat.memberId) return
      alive.current?.abort()
      // 앞 회원이 말하던 중이면 그 듣기를 무효로 하고 멈춘다(늦게 오는 중간·마지막 결과 모두 버림)
      session.current?.invalidate()
      stopListen.current?.()
      const next = loadChat(memberId)
      setChat(next)
      setText('')
      // 이 탭에 저장해 둔 그 회원 대화에 기다리던 답이 있으면 이어서 조회한다
      if (next.pending?.jobId) void follow(next.pending.jobId, next.pending.startedAt, next.pending.pollAfterMs, memberId)
    }
    check()
    const t = setInterval(check, 1000)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [chat.memberId])

  // 같은 회원이 다른 탭에서 대화를 이어 가거나 지우면 이 화면도 저장소 기록으로 다시 그린다
  useEffect(() => watchChat(() => {
    if (mounted.current) setChat(loadChat(currentMemberId()))
  }), [])

  // 기다린 시간 표시
  useEffect(() => {
    if (!chat.pending) return setWaitingSec(0)
    const tick = () => setWaitingSec(Math.floor((Date.now() - chat.pending!.startedAt) / 1000))
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [chat.pending])

  useEffect(() => {
    listEnd.current?.scrollIntoView?.({ block: 'end' })
  }, [chat.messages.length, chat.pending])

  const busy = chat.pending !== null
  const trimmed = text.trim()

  async function send(message: string, fromVoice = false) {
    const msg = message.trim()
    if (!msg || (listeningNow.current && !fromVoice)) return
    let owner = currentMemberId()
    // 앱을 열 때 refresh가 잠깐 실패해 회원을 아직 모르면, 먼저 확인한다(모르는 채로 보내지 않는다)
    if (owner === null) {
      owner = await refreshTokens().then((t) => t.memberId ?? null, () => null)
      if (owner === null) {
        addError('로그인 정보를 확인하지 못했어요. 잠시 뒤 다시 보내 주세요.', null)
        return
      }
    }
    // 앞 대화는 지금 로그인한 회원의 저장된 기록에서 만든다(화면에 남은 예전 회원 기록을 보내지 않게)
    const stored = loadChat(owner)
    if (stored !== chat) setChat(stored)
    if (!msg || stored.pending !== null || clearing || currentClearing(owner) || msg.length > MAX_CHARS) {
      readNext.current = false
      return
    }
    const history = historyOf(stored.messages)
    // "팀 A랑 …": 그 팀원을 다음 확인 카드에 미리 채운다(팀원은 비서에게 보내지 않음, FR-AGT-105)
    // 보내기를 늦추지 않게 뒤에서 한다(답이 오기까지 몇 초 걸리니 카드가 뜨기 전에 끝난다).
    // 팀 목록을 아직 못 받았으면 받아서 보고, 지금 친구가 아닌 팀원은 뺀다(친구 목록을 못 받으면 그대로)
    const me = owner
    void (async () => {
      const cached = knownTeams(me)
      const teams = cached.length > 0 ? cached : await getTeams(me).then((r) => r.teams, () => [])
      if (cached.length > 0) refreshTeams(me)
      const team = teamInMessage(msg, teams)
      if (!team) return
      const now = await getFriends(undefined, me).then((l) => l.friends, () => null)
      const members = teamFriends(team, now)
      if (members.length > 0) savePicked(me, members)
    })()
    const startedAt = Date.now()
    update((s) => ({
      ...s,
      pending: { jobId: '', startedAt },
      messages: [...s.messages, { id: newMessageId(), role: 'user', text: msg }],
    }), owner)
    setText('')
    const submitted = submitChat(msg, history, undefined, owner)
    setSubmitting(owner, submitted)
    try {
      const job = await submitted
      clearSubmitting(submitted)
      // 그사이 다른 회원으로 바뀌었으면 이 접수는 이어 받지 않는다
      if (currentMemberId() !== owner) return
      update((s) => ({ ...s, pending: { jobId: job.jobId, startedAt, pollAfterMs: job.pollAfterMs } }), owner)
      await follow(job.jobId, startedAt, job.pollAfterMs, owner)
    } catch (e) {
      clearSubmitting(submitted)
      addError(e instanceof ApiError ? e.message : '보내지 못했어요. 잠시 뒤 다시 보내 주세요.', owner)
    }
  }

  /** "새 대화": 서버가 기억한 대화를 먼저 지우고, 성공하면 화면과 이 탭 저장소도 비운다 */
  async function startOver() {
    const owner = currentMemberId()
    // 화면에 보이는 대화가 지금 로그인한 회원 것일 때만 지운다(회원이 막 바뀌어 앞 회원 대화가 보이는 순간 등)
    if (owner === null || chat.memberId !== owner || chat.pending !== null || clearing || currentClearing(owner)) return
    setClearing(true)
    // 지우기와 화면 비우기를 한 요청으로 묶어 저장소에 둔다. 화면을 떠나도 끝까지 가고, 돌아온 화면이 기다린다
    // 새 대화면 고른 친구도 버린다(카드 안 뜬 "팀A랑"이 다음 엉뚱한 카드에 채워지지 않게)
    const cleared = clearChatHistory(owner).then(() => { clearChatOf(owner); takePicked(owner) })
    rememberClearing(owner, cleared)
    try {
      await cleared
      if (currentMemberId() !== owner) return
      if (mounted.current) {
        setChat(loadChat(owner))
        setText('')
      }
    } catch (e) {
      addError(e instanceof ApiError ? e.message : '대화를 지우지 못했어요. 잠시 뒤 다시 눌러 주세요.', owner)
    } finally {
      if (mounted.current) setClearing(false)
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    void send(text)
  }

  return (
    <main className="chat-page">
      <header className="chat-head">
        <Spacey size={40} />
        <div>
          <h1>비서 스페이시</h1>
          <p className="muted">빈 방 찾기·예약·취소를 말로 할 수 있어요</p>
        </div>
        {chat.messages.length > 0 && (
          <button type="button" className="chat-reset" onClick={() => void startOver()} disabled={busy || clearing}>
            {clearing ? '지우는 중…' : '새 대화'}
          </button>
        )}
      </header>

      <div className="chat-list" aria-live="polite">
        {chat.messages.length === 0 && (
          <div className="bubble bot">
            안녕하세요, 스페이시예요. 아래 버튼을 누르거나{micOk ? ' 마이크로 말해' : ' 글로 적어'} 주세요.
            <p className="muted chat-tip">누르기만 해도 빈 방 찾기 → 확인 카드 → [확인]까지 이어져요.</p>
          </div>
        )}
        {chat.messages.map((m, i) => (
          <Message
            key={m.id} m={m} owner={chat.memberId}
            last={i === chat.messages.length - 1} busy={busy || clearing || listening} ask={ask}
            speaking={speakingId === m.id} onRead={ttsOk ? () => read(m.id, m.text) : undefined}
          />
        ))}
        {busy && (
          <div className="bubble bot thinking" role="status">
            생각하는 중<span className="typing" aria-hidden="true"><i /><i /><i /></span>{waitingSec >= 3 && <span className="muted"> {waitingSec}초</span>}
          </div>
        )}
        <div ref={listEnd} />
      </div>

      <div className="chat-dock">
      <nav className="prompt-bar" aria-label="추천 말">
        {menu && (
          <button type="button" className="ask-chip back" onClick={() => setMenu(null)}>{BACK_LABEL}</button>
        )}
        {(menu ?? MAIN_PROMPTS).map((c) => (
          <button key={c.label} type="button" className={`ask-chip ${c.next ? 'more' : ''}`} onClick={() => pick(c)} disabled={busy || clearing || listening}>
            {c.label}{c.next ? ' ›' : ''}
          </button>
        ))}
      </nav>
      {(listening || voiceNote) && (
        <p className={`voice-note ${voiceNote ? 'err' : ''}`} role="status">
          {voiceNote || '듣고 있어요… 말이 끝나면 바로 보내요. 이름·학번은 말하지 마세요.'}
        </p>
      )}
      <form className="chat-input" onSubmit={onSubmit}>
        <label htmlFor="chat-text" className="sr-only">비서에게 할 말</label>
        <textarea
          id="chat-text"
          rows={1}
          value={text}
          maxLength={MAX_CHARS}
          placeholder={busy ? '답을 기다리는 중이에요' : '예: 내일 2시에 빈 방 있어?'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // 한글 조합 중 Enter는 글자 확정이라 보내지 않는다
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void send(text)
            }
          }}
        />
        {micOk && (
          <button
            type="button" className={`mic ${listening ? 'on' : ''}`} onClick={toggleMic}
            disabled={(busy || clearing) && !listening}
            aria-label={listening ? '듣기 멈추기' : '말로 하기'} aria-pressed={listening}
          >
            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
              <path d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2z" fill="currentColor" />
            </svg>
          </button>
        )}
        <button type="submit" className="send" disabled={busy || clearing || listening || !trimmed} aria-label="보내기">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12l16-8-6 16-2-7-8-1z" fill="currentColor" /></svg>
        </button>
      </form>
      </div>
    </main>
  )
}

/** 말풍선 하나와 거기 붙은 확인 카드·입실 번호 카드·지난 카드 */
function Message({ m, owner, last, busy, ask, speaking, onRead }: {
  m: ChatMessage; owner: number | null; last: boolean; busy: boolean; ask: Ask; speaking: boolean; onRead?: () => void
}) {
  if (m.role === 'user') return <div className="bubble me">{m.text}</div>
  // 다음 말 버튼은 마지막 답에만(앞 답의 버튼은 지금 상황과 안 맞을 수 있다)
  const chips = last && !m.error ? (m.suggestions ?? []) : []
  return (
    <>
      <div className={`bubble bot ${m.error ? 'err' : ''}`} role={m.error ? 'alert' : undefined}>
        {m.text}
        {onRead && !m.error && (
          <button type="button" className={`read-btn ${speaking ? 'on' : ''}`} onClick={onRead} aria-label={speaking ? '읽기 멈추기' : '소리로 듣기'}>
            {speaking ? '■ 멈춤' : '🔊 듣기'}
          </button>
        )}
      </div>
      {m.confirmations?.map((c) => <ConfirmCard key={c.token} c={c} owner={owner} ask={last ? ask : undefined} busy={busy} />)}
      {m.pastCards?.map((c, i) => <PastConfirmCard key={i} c={c} ask={last ? ask : undefined} busy={busy} />)}
      {m.accessCodeCards?.map((a) => (
        <Link key={a.reservationId} to={`/reservations/${a.reservationId}`} className="bot-card link-card">
          입실 번호 보기 →
        </Link>
      ))}
      {last && m.hints?.includes(HINT_OPEN_SCHEDULE) && (
        <Link to="/me/schedule" className="bot-card link-card">내 시간표 넣기 →</Link>
      )}
      {last && !m.error && m.hints?.includes(HINT_PICK_FRIENDS)
        ? <WhoPicker owner={owner} ask={ask} busy={busy} fallback={chips} />
        : chips.length > 0 && <NextChips items={chips} ask={ask} busy={busy} />}
    </>
  )
}

/**
 * "누구랑 하실 건가요?" (FR-AGT-105, 11/9 영준: 사람을 안 적으면 누구랑 들어가는지 모른다).
 * 친구를 눌러 고르거나 이름을 말하면, 비서에게는 "나 포함 N명"만 보내고 고른 친구는 다음 확인 카드에 미리 채운다.
 * 친구가 없거나 못 불러오면 인원 버튼(fallback)만 보여 준다
 */
function WhoPicker({ owner, ask, busy, fallback }: { owner: number | null; ask: Ask; busy: boolean; fallback: string[] }) {
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [chosen, setChosen] = useState<Friend[]>([])
  // 말하는 동안 버튼으로 고른 친구도 보도록, 듣기 콜백은 이 ref로 지금 값을 읽는다
  const chosenNow = useRef<Friend[]>([])
  chosenNow.current = chosen
  const friendsNow = useRef<Friend[] | null>(null)
  friendsNow.current = friends
  const [note, setNote] = useState('')
  const [hearing, setHearing] = useState(false)
  const stopHear = useRef<(() => void) | null>(null)
  const voiceOk = useRef(canListen()).current
  useEffect(() => {
    let live = true
    getFriends(undefined, owner ?? undefined).then((l) => { if (live) setFriends(l.friends) }, () => { if (live) setFriends([]) })
    getTeams(owner).then((r) => { if (live) setTeams(r.teams) }, () => { /* 팀 없이 친구만 */ })
    return () => {
      live = false
      stopHear.current?.()
    }
  }, [owner])

  /** 팀 버튼: 그 팀원(지금도 친구인 사람만)으로 바꿔 고른다 */
  function pickTeam(t: Team) {
    const members = teamFriends(t, friends)
    const used = members.slice(0, MAX_FRIENDS)
    setChosen(used)
    const gone = t.members.length - members.length
    const over = members.length - used.length
    const lines = [`${t.name}을 골랐어요.`]
    if (gone > 0) lines.push(`친구 목록에 없는 ${gone}명은 뺐어요.`)
    if (over > 0) lines.push(`${MAX_FRIENDS}명까지만 고를 수 있어서 ${over}명은 넣지 않았어요.`)
    setNote(lines.join(' '))
  }

  /** 방 최대 인원(5번 방 8명)에서 나를 뺀 7명까지 */
  const MAX_FRIENDS = 7
  function toggle(f: Friend) {
    setNote('')
    setChosen((cur) => cur.some((x) => x.studentId === f.studentId)
      ? cur.filter((x) => x.studentId !== f.studentId)
      : cur.length >= MAX_FRIENDS ? cur : [...cur, f])
  }

  function hear() {
    if (hearing) return stopHear.current?.()
    stopSpeaking()
    const stop = listenOnce({
      onInterim: (t) => setNote(t ? `듣는 중: ${t}` : ''),
      onFinal: (t) => {
        const r = matchFriends(t, friendsNow.current ?? [], chosenNow.current.map((x) => x.studentId))
        // 상태와 안내가 같은 결과를 보도록 넣을 친구를 먼저 정한다(중복 빼고 7명까지)
        const cur = chosenNow.current
        const have = new Set(cur.map((x) => x.studentId))
        const fresh = r.picked.filter((x) => !have.has(x.studentId))
        const added = fresh.slice(0, Math.max(0, MAX_FRIENDS - cur.length))
        const over = fresh.length - added.length
        const next = [...cur, ...added]
        chosenNow.current = next
        setChosen(next)
        const lines: string[] = []
        if (added.length) lines.push(`${added.map((x) => x.name).join(', ')}님을 골랐어요.`)
        if (over > 0) lines.push(`${MAX_FRIENDS}명까지만 고를 수 있어서 ${over}명은 넣지 않았어요.`)
        for (const a of r.ambiguous) lines.push(`'${a.spoken}'은 ${a.candidates.map((x) => x.name).join('·')} 중 누구인지 눌러 주세요.`)
        if (r.unknown.length) lines.push(`${r.unknown.map((u) => `'${u}'`).join(', ')}은 친구 목록에 없어요.`)
        setNote(lines.join(' ') || `'${t}'에서 친구 이름을 찾지 못했어요. 눌러서 골라 주세요.`)
      },
      onError: (m) => setNote(m),
      onEnd: () => {
        stopHear.current = null
        setHearing(false)
      },
    })
    if (stop) {
      stopHear.current = stop
      setHearing(true)
    }
  }

  function done() {
    if (chosen.length === 0) return setNote('함께할 친구를 한 명 이상 골라 주세요.')
    savePicked(owner, chosen)
    ask(`나 포함 ${chosen.length + 1}명`)
  }

  if (friends !== null && friends.length === 0) {
    return (
      <div className="bot-card who-card">
        <p className="muted card-note">아직 친구가 없어서 인원만 골라 주세요. 학번은 확인 카드에서 넣어요. <Link to="/me/friends" className="link">친구 맺기 →</Link></p>
        {fallback.length > 0 && <NextChips items={fallback} ask={ask} busy={busy} />}
      </div>
    )
  }
  return (
    <div className="bot-card who-card">
      <p className="card-label">누구랑 하실 건가요?</p>
      {voiceOk && (
        <button type="button" className={`ask-chip name-mic ${hearing ? 'on' : ''}`} onClick={hear}
          disabled={busy || friends === null} aria-pressed={hearing}>
          {hearing ? '■ 그만 듣기' : '🎤 친구 이름 말하기'}
        </button>
      )}
      {teams.length > 0 && (
        <div className="ask-chips team-chips" aria-label="내 팀">
          {teams.map((t) => (
            <button key={t.name} type="button" className="ask-chip team" onClick={() => pickTeam(t)} disabled={busy || friends === null}>
              👥 {t.name} ({t.members.length + 1}명)
            </button>
          ))}
        </div>
      )}
      {friends === null
        ? <p className="muted card-note">친구 목록을 불러오는 중…</p>
        : (
          <div className="ask-chips friend-chips" aria-label="함께할 친구">
            {friends.map((f) => {
              const on = chosen.some((x) => x.studentId === f.studentId)
              return (
                <button key={f.studentId} type="button" className={`ask-chip ${on ? 'picked' : ''}`} onClick={() => toggle(f)}
                  disabled={busy} aria-pressed={on}>
                  {on ? '✓ ' : ''}{f.name}
                </button>
              )
            })}
          </div>
        )}
      {note && <p className="muted card-note pick-note" role="status">{note}</p>}
      <button type="button" className="btn-primary card-btn" onClick={done} disabled={busy || friends === null}>
        {chosen.length > 0 ? `나 포함 ${chosen.length + 1}명으로 할게요` : '친구를 골라 주세요'}
      </button>
    </div>
  )
}

/** 예약이 끝난 카드: 이번 친구들을 팀으로 저장 → 다음엔 "팀 A랑 내일 3시" (FR-AGT-105) */
function TeamSave({ owner, members }: { owner: number | null; members: { studentId: string; name: string }[] }) {
  const [name, setName] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle')
  async function save() {
    const n = name.trim()
    if (!n) return setState('팀 이름을 적어 주세요.')
    setState('saving')
    try {
      await saveTeam(n, members, owner)
      setState('saved')
    } catch (e) {
      setState(e instanceof ApiError ? e.message : '저장하지 못했어요. 잠시 뒤 다시 눌러 주세요.')
    }
  }
  if (state === 'saved') return <p className="muted card-note">'{name.trim()}' 팀으로 저장했어요. 다음엔 "{name.trim()}랑 내일 3시"라고 말해 보세요.</p>
  return (
    <div className="team-save">
      <p className="muted card-note">이 친구들({members.map((m) => m.name).join(', ')})과 또 쓸 거면 팀으로 저장해 두세요</p>
      <div className="person">
        <input aria-label="팀 이름" placeholder="예: 팀 A" maxLength={TEAM_NAME_MAX} value={name}
          onChange={(e) => setName(e.target.value)} disabled={state === 'saving'} />
        <button type="button" className="ask-chip team" onClick={() => void save()} disabled={state === 'saving'}>
          {state === 'saving' ? '저장 중…' : '팀으로 저장'}
        </button>
      </div>
      {state !== 'idle' && state !== 'saving' && <p className="card-error" role="alert">{state}</p>}
      <p className="muted card-note">팀 이름에 사람 이름은 넣지 마세요(비서에게 팀 이름이 보여요).</p>
    </div>
  )
}

/** 답 아래 "다음 말" 버튼. 누르면 그 글을 그대로 보낸다 */
function NextChips({ items, ask, busy }: { items: string[]; ask: Ask; busy?: boolean }) {
  return (
    <div className="ask-chips next-chips" aria-label="다음 말">
      {items.map((t) => (
        <button key={t} type="button" className="ask-chip" onClick={() => ask(t)} disabled={busy}>{t}</button>
      ))}
    </div>
  )
}

/** 새로고침 전에 받은 확인 카드. 토큰을 저장하지 않아 다시 누를 수 없다 */
function PastConfirmCard({ c, ask, busy }: { c: PastCard; ask?: Ask; busy?: boolean }) {
  const r = c.result
  if (r) {
    return (
      <>
        <div className="bot-card done" role="status">
          <strong>{r.message}</strong>
          {r.action === 'CREATE' || r.action === 'START_NOW'
            ? <Link to={`/reservations/${r.reservationId}`} className="link">입실 번호 보기 →</Link>
            : <Link to={`/me/${r.reservationId}`} className="link">내 예약에서 보기 →</Link>}
        </div>
        {/* 새로고침 뒤에도 마지막 결과 카드의 다음 말 버튼은 남긴다(글만 저장, 토큰·입실 번호 없음) */}
        {ask && (r.suggestions?.length ?? 0) > 0 && <NextChips items={r.suggestions!} ask={ask} busy={busy} />}
      </>
    )
  }
  return (
    <div className="bot-card past">
      <p className="card-label">지난 확인 카드</p>
      <strong className="card-summary">{c.summary}</strong>
      <p className="muted card-note">화면을 새로 열어서 이 카드는 닫혔어요. 다시 하려면 스페이시에게 말해 주세요.</p>
    </div>
  )
}

type CardState = CardOutcome

/** 이 코드면 카드를 다시 쓸 수 없다(비서에게 다시 말해야 함) */
const CLOSED = new Set(['CONFIRMATION_USED', 'CONFIRMATION_EXPIRED', 'CONFIRMATION_NOT_FOUND'])

export function ConfirmCard({ c, owner, ask, busy }: { c: ChatConfirmation; owner: number | null; ask?: Ask; busy?: boolean }) {
  const now = useNow(5_000)
  // 이미 누른 카드면 그 결과로 시작한다(다른 화면에 갔다 와도 입력 칸이 다시 뜨지 않게, 11/5 재웅 피드백)
  const [state, setState] = useState<CardState>(() => cardOutcomeOf(owner, c.token) ?? { kind: 'open' })
  // 보내는 동안 화면을 떠났다 와도, 결과가 오면 다시 그려진 카드에 바로 반영한다
  // 처음 읽은 뒤 구독하기 전에 결과가 바뀌었을 수 있어, 구독한 다음 한 번 더 읽는다
  useEffect(() => {
    const stop = watchCardOutcome(c.token, (o) => setState(o ?? { kind: 'open' }))
    setState(cardOutcomeOf(owner, c.token) ?? { kind: 'open' })
    return stop
  }, [c.token, owner])
  // "누구랑?"에서 고른 친구가 있으면 칸을 미리 채운다(이미 누른 카드는 빼고). 꺼내 지우는 것은 아래 effect에서
  const [prefill] = useState(() => {
    const p = cardOutcomeOf(owner, c.token) ? [] : peekPicked(owner)
    return p.length > 0 && p.length <= c.needsParticipants ? p : []
  })
  const [ids, setIds] = useState<string[]>(() => Array.from({ length: c.needsParticipants }, (_, i) => prefill[i]?.studentId ?? ''))
  // 이름을 듣는 동안 칸을 고쳐도 덮어쓰지 않게, 듣기 콜백은 이 ref로 지금 칸을 읽는다
  const idsNow = useRef<string[]>(ids)
  idsNow.current = ids
  const [names, setNames] = useState<Record<number, string>>(() => Object.fromEntries(prefill.map((f, i) => [i, f.name])))
  useEffect(() => {
    if (prefill.length > 0) takePicked(owner)
  }, [prefill, owner])
  // 칸마다 마지막 조회 번호. 입력이 바뀌면 늦게 온 앞 조회 결과는 버린다
  const lookups = useRef<number[]>([])
  const expired = new Date(c.expiresAt).getTime() <= now.getTime()
  // 친구 고르기(FR-AGT-105): 친구 목록을 버튼으로 보여 주고, 이름을 말하면 브라우저 안에서 맞춰 학번 칸을 채운다
  const [friends, setFriends] = useState<Friend[] | null>(null)
  const friendsNow = useRef<Friend[] | null>(null)
  friendsNow.current = friends
  const [pickNote, setPickNote] = useState('')
  const [choices, setChoices] = useState<Friend[]>([])
  const [hearing, setHearing] = useState(false)
  const stopHear = useRef<(() => void) | null>(null)
  const voiceOk = useRef(canListen()).current
  useEffect(() => {
    if (c.needsParticipants <= 0 || state.kind === 'done' || state.kind === 'closed') return
    let live = true
    getFriends(undefined, owner ?? undefined).then((l) => { if (live) setFriends(l.friends) }, () => { if (live) setFriends([]) })
    return () => {
      live = false
      stopHear.current?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.token, c.needsParticipants, owner])

  /** 친구 버튼: 안 들어 있으면 빈 칸 맨 앞에 넣고, 들어 있으면 뺀다 */
  function toggleFriend(f: Friend) {
    setChoices([])
    const at = ids.indexOf(f.studentId)
    if (at >= 0) return setSlot(at, '', '')
    const empty = ids.findIndex((v) => !v.trim())
    if (empty < 0) return setPickNote(`이미 ${c.needsParticipants}명을 다 골랐어요. 바꾸려면 넣은 친구를 한 번 더 눌러 빼 주세요`)
    setPickNote('')
    setSlot(empty, f.studentId, f.name)
  }

  function setSlot(i: number, sid: string, name: string) {
    setIds((cur) => cur.map((v, j) => (j === i ? sid : v)))
    lookups.current[i] = (lookups.current[i] ?? 0) + 1
    setNames((n) => ({ ...n, [i]: name }))
    if (state.kind === 'open' && state.error) {
      saveCardOutcome(owner, c.token, undefined)
      setState({ kind: 'open' })
    }
  }

  /** 들은 이름들을 친구와 맞춰 빈 칸을 차례로 채운다. 못 정한 이름은 안내와 후보 버튼으로 */
  function fillFromSpeech(text: string) {
    const list = friendsNow.current ?? []
    const cur = idsNow.current
    const r = matchFriends(text, list, cur)
    const next = [...cur]
    const nextNames: Record<number, string> = {}
    let over = 0
    for (const f of r.picked) {
      const empty = next.findIndex((v) => !v.trim())
      if (empty < 0) { over++; continue }
      next[empty] = f.studentId
      nextNames[empty] = f.name
      lookups.current[empty] = (lookups.current[empty] ?? 0) + 1
    }
    idsNow.current = next
    setIds(next)
    setNames((n) => ({ ...n, ...nextNames }))
    const lines: string[] = []
    if (r.picked.length - over > 0) lines.push(`${r.picked.slice(0, r.picked.length - over).map((f) => f.name).join(', ')}님을 넣었어요.`)
    for (const a of r.ambiguous) lines.push(`'${a.spoken}'은 ${a.candidates.map((x) => x.name).join('·')} 중 누구인지 눌러 주세요.`)
    if (r.unknown.length > 0) lines.push(`${r.unknown.map((u) => `'${u}'`).join(', ')}은 친구 목록에 없어요. 친구 탭에서 먼저 친구를 맺어 주세요.`)
    if (over > 0) lines.push(`${c.needsParticipants}명이 넘어서 ${over}명은 넣지 않았어요.`)
    if (lines.length === 0) lines.push(`'${text}'에서 친구 이름을 찾지 못했어요. 아래 버튼으로 골라 주세요.`)
    setChoices(r.ambiguous.flatMap((a) => a.candidates).filter((f, i, all) => all.findIndex((x) => x.studentId === f.studentId) === i))
    setPickNote(lines.join(' '))
  }

  function hearNames() {
    if (hearing) return stopHear.current?.()
    stopSpeaking()
    setPickNote('')
    const stop = listenOnce({
      onInterim: (t) => setPickNote(t ? `듣는 중: ${t}` : ''),
      onFinal: (t) => fillFromSpeech(t),
      onError: (m) => setPickNote(m),
      onEnd: () => {
        stopHear.current = null
        setHearing(false)
      },
    })
    if (stop) {
      stopHear.current = stop
      setHearing(true)
    }
  }

  /** 학번을 내 친구 중에서 찾아 이름을 보여 준다(친구만 참여자로 넣을 수 있음, core #68). 찾았고 그사이 입력이 안 바뀌었을 때만 true */
  async function lookup(i: number, sid = ids[i].trim()): Promise<boolean> {
    if (!sid) return false
    const seq = (lookups.current[i] ?? 0) + 1
    lookups.current[i] = seq
    let name: string
    let ok = false
    try {
      const m = await findFriend(sid, owner ?? undefined)
      name = m.name
      ok = true
    } catch (e) {
      name = e instanceof ApiError && e.code === 'NOT_FRIEND'
        ? '친구 목록에 없는 학번이에요. 내 예약 > 친구에서 먼저 친구를 맺어 주세요'
        : '학번을 확인하지 못했어요. 잠시 후 다시 눌러 주세요'
    }
    // 기다리는 사이 학번이 바뀌었으면 이 결과는 버리고 실패로 본다(보이는 학번과 다른 학번을 보내지 않게)
    if (lookups.current[i] !== seq) return false
    setNames((n) => ({ ...n, [i]: name }))
    return ok
  }

  async function confirm() {
    if (state.kind === 'sending') return
    const students = ids.map((s) => s.trim())
    if (students.some((s) => !s)) return setState({ kind: 'open', error: `함께 쓸 사람 학번 ${c.needsParticipants}개를 모두 적어 주세요` })
    setState({ kind: 'sending' })
    saveCardOutcome(owner, c.token, { kind: 'sending' })
    // 지금 적힌 학번을 모두 다시 찾아, 실제로 있는 사람일 때만 보낸다(잘못 친 학번으로 남이 참여자로 들어가지 않게)
    const found = await Promise.all(students.map((sid, i) => lookup(i, sid)))
    if (found.some((ok) => !ok)) {
      const error = '친구가 아닌 학번이 있거나 학번이 바뀌었어요. 확인하고 다시 눌러 주세요'
      // 다시 누를 수 있는 오류도 기억해서, 다시 그려진 카드에 같은 안내가 보이게 한다
      saveCardOutcome(owner, c.token, { kind: 'open', error })
      return setState({ kind: 'open', error })
    }
    try {
      const result = await confirmCard(c.token, c.needsParticipants > 0 ? students : undefined, owner)
      // 화면을 떠난 뒤에 끝나도 결과가 남게, 먼저 기억해 두고 화면에 반영한다
      saveCardOutcome(owner, c.token, { kind: 'done', result })
      setState({ kind: 'done', result })
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', '잠시 후 다시 시도해 주세요')
      if (CLOSED.has(err.code)) {
        // 이미 쓴 확인: 앞서 누른 것이 처리됐을 수 있다(두 번 누름·응답 전에 끊김). 결과를 어디서 보는지 알려 준다
        const message = err.code === 'CONFIRMATION_USED' ? '이미 처리한 확인이에요. 결과는 내 예약에서 볼 수 있어요.' : err.message
        saveCardOutcome(owner, c.token, { kind: 'closed', message })
        setState({ kind: 'closed', message })
      } else {
        // 예약 거절(참여자 예약 중 등)은 예약 화면과 같은 친절한 문구로
        const error = deniedLine(err.code, err.message)
        saveCardOutcome(owner, c.token, { kind: 'open', error })
        setState({ kind: 'open', error })
      }
    }
  }

  if (state.kind === 'done') {
    const r = state.result
    // 이번에 [확인]한 참여자(화면을 다시 열면 모름 → 팀 저장 칸 안 보임)
    const members = ids.map((sid, i) => ({ studentId: sid.trim(), name: names[i] ?? '' })).filter((m) => m.studentId)
    return (
      <>
        <div className="bot-card done" role="status">
          <strong>{r.message}</strong>
          {r.action === 'CREATE' || r.action === 'START_NOW'
            ? <Link to={`/reservations/${r.reservationId}`} className="link">입실 번호 보기 →</Link>
            : <Link to={`/me/${r.reservationId}`} className="link">내 예약에서 보기 →</Link>}
          {members.length > 0 && <TeamSave owner={owner} members={members} />}
        </div>
        {ask && (r.suggestions?.length ?? 0) > 0 && <NextChips items={r.suggestions!} ask={ask} busy={busy} />}
      </>
    )
  }

  const closed = state.kind === 'closed' || expired
  return (
    <div className="bot-card">
      <p className="card-label">확인이 필요해요</p>
      <strong className="card-summary">{c.summary}</strong>
      {c.notes.map((n) => <p key={n} className="muted card-note">{n}</p>)}
      {!closed && c.needsParticipants > 0 && (
        <div className="card-people">
          <p className="muted card-note">함께할 친구 {c.needsParticipants}명 (나는 빼고) · 이름을 말하거나 눌러 고르세요</p>
          {voiceOk && (
            <button type="button" className={`ask-chip name-mic ${hearing ? 'on' : ''}`} onClick={hearNames}
              disabled={state.kind === 'sending' || friends === null || friends.length === 0} aria-pressed={hearing}>
              {hearing ? '■ 그만 듣기' : '🎤 친구 이름 말하기'}
            </button>
          )}
          {friends === null && <p className="muted card-note">친구 목록을 불러오는 중…</p>}
          {friends !== null && friends.length === 0 && (
            <p className="muted card-note">아직 친구가 없어요. <Link to="/me/friends" className="link">친구 맺기 →</Link></p>
          )}
          {friends !== null && friends.length > 0 && (
            <div className="ask-chips friend-chips" aria-label="친구 고르기">
              {(choices.length > 0 ? choices : friends).map((f) => (
                <button key={f.studentId} type="button" className={`ask-chip ${ids.includes(f.studentId) ? 'picked' : ''}`}
                  onClick={() => toggleFriend(f)} disabled={state.kind === 'sending'} aria-pressed={ids.includes(f.studentId)}>
                  {ids.includes(f.studentId) ? '✓ ' : ''}{f.name}
                </button>
              ))}
              {choices.length > 0 && <button type="button" className="ask-chip back" onClick={() => setChoices([])}>친구 모두 보기</button>}
            </div>
          )}
          {pickNote && <p className="muted card-note pick-note" role="status">{pickNote}</p>}
          {ids.map((v, i) => (
            <div key={i} className="person">
              <input
                inputMode="numeric"
                aria-label={`함께 쓸 사람 ${i + 1} 학번`}
                placeholder="학번"
                value={v}
                disabled={state.kind === 'sending'}
                onChange={(e) => {
                  const next = [...ids]
                  next[i] = e.target.value
                  setIds(next)
                  lookups.current[i] = (lookups.current[i] ?? 0) + 1
                  setNames((n) => ({ ...n, [i]: '' }))
                  // 다시 그려진 카드에 남은 앞 오류는 새로 고치는 입력과 상관없으니 지운다
                  if (state.kind === 'open' && state.error) {
                    saveCardOutcome(owner, c.token, undefined)
                    setState({ kind: 'open' })
                  }
                }}
                onBlur={() => void lookup(i)}
              />
              {names[i] && <span className="muted">{names[i]}</span>}
            </div>
          ))}
        </div>
      )}
      {state.kind === 'open' && state.error && <p className="card-error" role="alert">{state.error}</p>}
      {closed ? (
        <>
          <p className="card-error" role="alert">
            {state.kind === 'closed' ? state.message : '확인 시간이 지났어요. 스페이시에게 다시 말해 주세요.'}
          </p>
          {state.kind === 'closed' && <Link to="/me/reservations" className="card-link">내 예약 보기 →</Link>}
        </>
      ) : (
        <>
          <p className="muted card-note">{seoulClock(new Date(c.expiresAt))}까지 눌러 주세요</p>
          <button type="button" className="btn-primary card-btn" onClick={() => void confirm()} disabled={state.kind === 'sending'}>
            {state.kind === 'sending' ? '처리하는 중…' : '확인'}
          </button>
        </>
      )}
    </div>
  )
}
