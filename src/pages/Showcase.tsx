import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import Spacey from '../components/Spacey'
import { SCENE_MS, step, STORIES, storyById, type StoryId } from '../content/showcase'
import './Showcase.css'

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** 장면 안에서 시간차로 나타나는 조각 */
const At = ({ ms, children, className = '' }: { ms: number; children: ReactNode; className?: string }) =>
  <div className={`sc-at ${className}`} style={{ '--at': `${ms}ms` } as CSSProperties}>{children}</div>

/** 폰 잠금 화면 알림 */
function Push({ ms, title, body, app = 'M-space 비서' }: { ms: number; title: string; body: string; app?: string }) {
  return (
    <At ms={ms} className="sc-push">
      <span className="sc-push-ico" aria-hidden="true"><Spacey size={22} label="" /></span>
      <div><span className="sc-push-app">{app} · 지금</span><b>{title}</b><span>{body}</span></div>
    </At>
  )
}

function Lock({ time, date, children }: { time: string; date: string; children: ReactNode }) {
  return (
    <div className="sc-lock">
      <span className="sc-lock-date">{date}</span>
      <span className="sc-lock-time">{time}</span>
      <div className="sc-pushes">{children}</div>
    </div>
  )
}

function Top({ title, tag }: { title: string; tag?: string }) {
  return <div className="sc-top"><b>{title}</b>{tag && <span className="sc-tag">{tag}</span>}</div>
}

const Bub = ({ me, ms, children }: { me?: boolean; ms: number; children: ReactNode }) =>
  <At ms={ms} className={`sc-bub ${me ? 'me' : ''}`}>{children}</At>

const Typing = ({ ms, until }: { ms: number; until: number }) =>
  <div className="sc-typing" style={{ '--at': `${ms}ms`, '--until': `${until}ms` } as CSSProperties} aria-hidden="true"><i /><i /><i /></div>

/** 학생 편 변호사 장면 5개 */
const LAWYER: (() => ReactNode)[] = [
  () => (
    <div className="sc-door">
      <span className="sc-door-room">창작실 3 · 문 앞 화면</span>
      <span className="sc-led" aria-hidden="true" />
      <b className="sc-door-msg">잠시 잠겨 있어요</b>
      <span className="sc-door-sub">번호가 5번 틀려 1분 동안 잠겼어요</span>
      <At ms={900} className="sc-door-log">
        <span>14:58–15:01 · 번호 5번 틀림 <em>민지 예약 아님</em></span>
        <span>15:02 · 민지 QR 찍음 → 잠김</span>
        <span>15:03 · 잠김 풀림 → 그사이 민지는 돌아감 → 15:15 노쇼</span>
      </At>
    </div>
  ),
  () => (
    <Lock time="15:20" date="11월 9일 월요일">
      <Push ms={300} title="노쇼 경고, 제가 먼저 기록을 봤어요" body="문이 잠긴 건 민지 님 탓이 아니었어요. 근거 2개를 찾았어요." />
      <At ms={1300} className="sc-evi">
        <span><i className="for" />15:02 민지 님 QR이 찍혔지만 문이 잠겨 있었어요</span>
        <span><i className="for" />잠김은 다른 사람이 14:58부터 번호를 5번 틀려서예요</span>
      </At>
    </Lock>
  ),
  () => (
    <div className="sc-home">
      <Top title="M-space" />
      <At ms={200} className="sc-card sc-undo">
        <span className="sc-eyebrow">비서가 먼저 · 규칙으로 무름</span>
        <b>노쇼 경고 1회를 물렀어요</b>
        <span className="sc-strike">창작실 3 · 15:00–17:00 노쇼</span>
        <span className="sc-muted">기록이 확실해서 사람 판정 없이 규칙이 바로 물렀어요. 민지 님은 할 일이 없어요.</span>
      </At>
      <At ms={1100} className="sc-stamp">무름</At>
    </div>
  ),
  () => (
    <div className="sc-home">
      <Top title="이용 규칙" tag="준호" />
      <At ms={200} className="sc-card">
        <span className="sc-eyebrow">왜 받았나요 · 창문 열림</span>
        <b>창작실 4 · 16:00–18:00</b>
        <span className="sc-muted">다음 팀이 창문이 열려 있다고 신고했어요.</span>
      </At>
      <At ms={900} className="sc-card sc-draft">
        <span className="sc-butler"><Spacey size={22} label="" />애매한 건이라 초안만 써 뒀어요</span>
        <p className="sc-typed">퇴실 버튼을 누른 17:58엔 창문을 닫았어요. 다음 팀이 들어온 18:05 전에 누가 열었을 수도 있어요.</p>
        <span className="sc-btn">고쳐서 보내기</span>
      </At>
    </div>
  ),
  () => (
    <div className="sc-admin">
      <Top title="관리자 · 할 일" tag="교학팀" />
      <At ms={200} className="sc-stats">
        <div><b>3</b><span>규칙이 무름</span></div>
        <div><b>2</b><span>학생이 해명</span></div>
        <div className="hl"><b>1</b><span>사람 판정</span></div>
      </At>
      <At ms={800} className="sc-card">
        <span className="sc-eyebrow">해명 · 근거 2개 붙음</span>
        <b>창작실 4 창문 열림</b>
        <span className="sc-muted">17:58 퇴실 → 18:05 신고. 사이 7분 동안 출입 기록 없음</span>
        <div className="sc-row"><span className="sc-btn">경고 무르기</span><span className="sc-btn line">그대로</span></div>
      </At>
    </div>
  ),
]

/** 답 못 한 질문 수확 장면 5개 */
const HARVEST: (() => ReactNode)[] = [
  () => (
    <div className="sc-chat">
      <Top title="비서" tag="민지" />
      <Bub me ms={200}>방에서 음식 먹어도 돼요?</Bub>
      <Typing ms={700} until={1500} />
      <Bub ms={1500}>규칙에 "음식물 반입 금지"는 있는데, 음료·간식이 되는지는 적혀 있지 않아요. 지어내지 않고 교학팀에 물어 둘게요. 답이 오면 먼저 알려 드릴게요.</Bub>
      <At ms={2400} className="sc-chip">답 기다리는 질문에 넣었어요</At>
    </div>
  ),
  () => (
    <div className="sc-admin">
      <Top title="교학팀 · 답 기다리는 질문" tag="11/13(금)" />
      <At ms={200} className="sc-ask-head"><b>4묶음</b><span>이번 주 학생 12명이 물었어요</span></At>
      {[['음료·간식 돼요?', 6], ['방에 짐 두고 밥 먹고 와도 돼요?', 3], ['시험 기간 밤 12시 넘어도 돼요?', 2], ['보드마커 어디 있어요?', 1]].map(([q, n], i) => (
        <At key={String(q)} ms={500 + i * 220} className="sc-ask">
          <span className="sc-ask-n">{n}명</span><span>{q}</span>
        </At>
      ))}
    </div>
  ),
  () => (
    <div className="sc-admin">
      <Top title="교학팀 · 답 적기" tag="11/13(금)" />
      <At ms={200} className="sc-card">
        <span className="sc-eyebrow">6명이 물었어요</span>
        <b>음료·간식 돼요?</b>
        <div className="sc-input"><span className="sc-typed short">뚜껑 있는 음료만 돼요. 음식은 안 돼요.</span></div>
        <span className="sc-btn">답 올리기</span>
      </At>
      <At ms={2200} className="sc-chip">6명에게 보내고, 비서 규칙에 넣었어요</At>
    </div>
  ),
  () => (
    <Lock time="16:03" date="11월 13일 금요일">
      <Push ms={300} title="물어보신 '음식' 답이 왔어요" body="교학팀: 뚜껑 있는 음료만 돼요. 음식은 안 돼요." />
      <Push ms={1100} app="M-space" title="빈방 알림" body="창작실 2가 지금 비었어요" />
    </Lock>
  ),
  () => (
    <div className="sc-chat">
      <Top title="비서" tag="준호" />
      <Bub me ms={200}>스터디하면서 커피 마셔도 돼요?</Bub>
      <Typing ms={600} until={1200} />
      <Bub ms={1200}>네, 뚜껑 있는 컵이면 돼요. 음식은 안 돼요.</Bub>
      <At ms={1900} className="sc-cite">근거 · 교학팀 답 11/13 "뚜껑 있는 음료만 돼요"</At>
    </div>
  ),
]

const SCENES: Record<StoryId, (() => ReactNode)[]> = { lawyer: LAWYER, harvest: HARVEST }

/**
 * 발표용 미리보기 (/showcase). 실제 기능이 아니라 장면을 자동으로 넘겨 보여 준다(5초마다, 멈추기·앞뒤·←→ 키).
 * 로그인 없이 열리고 서버에 아무것도 묻지 않는다
 */
export default function Showcase() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const story = storyById(params.get('story'))
  const scenes = SCENES[story.id]
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(() => !reduced())
  const n = scenes.length

  // 이야기를 바꾸면 그 렌더에서 바로 첫 장면으로 (effect로 하면 한 번은 옛 번호로 그려져 장면 수가 다를 때 깨짐)
  const [shownId, setShownId] = useState(story.id)
  if (shownId !== story.id) { setShownId(story.id); setI(0) }
  const at = shownId === story.id ? i : 0
  useEffect(() => {
    if (!playing) return
    const t = setTimeout(() => setI((x) => step(x, n, 1)), SCENE_MS)
    return () => clearTimeout(t)
  }, [playing, i, n])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setI((x) => step(x, n, 1))
      else if (e.key === 'ArrowLeft') setI((x) => step(x, n, -1))
      // 버튼·탭에 초점이 있으면 스페이스는 그 버튼을 누르는 키라 건드리지 않음
      else if (e.key === ' ' && !(e.target instanceof Element && e.target.closest('button, a, input, textarea, select, [role="tab"]'))) {
        e.preventDefault(); setPlaying((p) => !p)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [n])
  // 보는 중에 '동작 줄이기'를 켜면 멈춤 (끄더라도 저절로 다시 돌리지는 않음)
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const onChange = () => { if (mq.matches) setPlaying(false) }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const scene = story.scenes[at]
  return (
    <main className="sc-page">
      <header className="sc-head">
        <button type="button" className="back" aria-label="뒤로" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/'))}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>
        </button>
        <div>
          <span className="sc-kicker">발표용 미리보기 · 실제 기능 아님</span>
          <h1>{story.title}</h1>
        </div>
      </header>

      <div className="sc-tabs" role="tablist" aria-label="아이디어" style={{ '--i': STORIES.indexOf(story) } as CSSProperties}>
        <span className="sc-tabs-glow" aria-hidden="true" />
        {STORIES.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={s.id === story.id} onClick={() => setParams({ story: s.id }, { replace: true })}>{s.title}</button>
        ))}
      </div>
      <p className="sc-pitch">{story.pitch}</p>

      <div className="sc-stage">
        <div className="sc-caption" key={`${story.id}-${at}-c`} aria-live="polite">
          <span className="sc-time">{scene.time}</span>
          <p>{scene.caption}</p>
        </div>
        <div className="sc-phone">
          <div className="sc-notch" aria-hidden="true" />
          <div className="sc-screen" key={`${story.id}-${at}`}>{scenes[at]()}</div>
        </div>
        <div className="sc-dots" role="group" aria-label="장면">
          {story.scenes.map((s, j) => (
            <button key={j} type="button" aria-label={`${j + 1}번 장면: ${s.caption}`} aria-current={j === at ? 'step' : undefined}
              className={j === at ? `on ${playing ? 'run' : ''}` : j < at ? 'past' : ''} style={{ '--ms': `${SCENE_MS}ms` } as CSSProperties}
              onClick={() => setI(j)}><i /></button>
          ))}
        </div>
        <div className="sc-ctrl">
          <button type="button" className="btn-line" onClick={() => setI((x) => step(x, n, -1))} aria-label="앞 장면">‹</button>
          <button type="button" className="btn-primary" onClick={() => setPlaying((p) => !p)}>{playing ? '멈추기' : '자동 넘기기'}</button>
          <button type="button" className="btn-line" onClick={() => setI((x) => step(x, n, 1))} aria-label="다음 장면">›</button>
        </div>
      </div>

      <p className="sc-ai"><b>AI가 하는 일</b>{story.aiPart}</p>
      <p className="sc-foot muted">가짜 이름·가짜 기록으로 만든 장면이에요. 서버에 아무것도 보내지 않아요.</p>
    </main>
  )
}
