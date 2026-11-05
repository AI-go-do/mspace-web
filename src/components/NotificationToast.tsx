import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { freshNotifications, getMyNotifications, toastTarget, type AppNotification } from '../api/notifications'
import { useAuth } from '../auth/AuthProvider'
import { readTokens } from '../auth/tokens'
import './NotificationToast.css'

const POLL_MS = 30_000
const REQUEST_TIMEOUT_MS = 15_000
const SHOW_MS = 4_000

/** 이미 본 알림 번호. 화면을 옮겨 다녀도 같은 알림을 두 번 띄우지 않게 회원별로 화면 밖에 둔다 */
let seenStore: { memberId: number | null | undefined; ids: Set<number> | null } = { memberId: undefined, ids: null }

/**
 * 앱 안 알림 배너 (FR-NTF-103, 재웅 11/5 요청). 앱을 열어 둔 동안 30초마다 알림함을 받아 보고,
 * 새 알림이 오면 위에서 내려왔다가 4초 뒤 사라진다. 짧은 "띠링" 소리와 진동(되는 폰만)을 같이 낸다.
 * 앱을 닫았을 때 오는 웹 푸시는 팀 결정 전이라 여기서 하지 않는다
 */
export default function NotificationToast() {
  const { status } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [shown, setShown] = useState<{ n: AppNotification; more: number } | null>(null)
  const busy = useRef(false)
  const onAlerts = useRef(pathname === '/alerts')
  onAlerts.current = pathname === '/alerts'

  const check = useCallback(() => {
    if (busy.current || document.visibilityState !== 'visible') return
    busy.current = true
    const memberId = readTokens()?.memberId ?? null
    if (seenStore.memberId !== memberId) seenStore = { memberId, ids: null }
    const abort = new AbortController()
    const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS)
    getMyNotifications(abort.signal)
      .then((list) => {
        if (seenStore.memberId !== memberId) return
        const fresh = freshNotifications(list, seenStore.ids)
        seenStore.ids = new Set(list.map((n) => n.id))
        // 알림함을 보고 있으면 목록에 바로 보이니 배너는 띄우지 않는다
        if (fresh.length && !onAlerts.current) {
          setShown({ n: fresh[0], more: fresh.length - 1 })
          chime()
        }
      })
      .catch(() => undefined)
      .finally(() => { clearTimeout(timer); busy.current = false })
  }, [])

  useEffect(() => {
    if (status !== 'in') return
    check()
    const id = setInterval(check, POLL_MS)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVisible) }
  }, [status, check])

  useEffect(() => {
    if (!shown) return
    const id = setTimeout(() => setShown(null), SHOW_MS)
    return () => clearTimeout(id)
  }, [shown])

  useEffect(unlockAudioOnFirstTouch, [])

  return (
    <div className="toast-slot" aria-live="polite">
      {shown && (
        <div key={shown.n.id} className={`toast ${shown.n.kind === 'AWAY_SOON' ? 'urgent' : ''}`}>
          <button type="button" className="toast-main" onClick={() => { setShown(null); navigate(toastTarget(shown.n)) }}>
            <BellIcon />
            <span className="toast-text">
              <b>{shown.n.title}</b>
              <span>{shown.more > 0 ? `${shown.n.body} 외 ${shown.more}개` : shown.n.body}</span>
            </span>
          </button>
          <button type="button" className="toast-close" aria-label="알림 닫기" onClick={() => setShown(null)}>×</button>
        </div>
      )}
    </div>
  )
}

function BellIcon() {
  return (
    <svg className="toast-bell" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

let audio: AudioContext | null = null

/** 브라우저는 사람이 한 번 누르기 전에는 소리를 막는다. 첫 터치 때 소리 장치를 깨워 둔다 */
function unlockAudioOnFirstTouch() {
  const unlock = () => {
    try {
      audio ??= new AudioContext()
      void audio.resume()
    } catch { /* 소리를 못 내는 브라우저 */ }
  }
  window.addEventListener('pointerdown', unlock, { once: true })
  return () => window.removeEventListener('pointerdown', unlock)
}

/** 짧은 두 음 "띠링" (파일 없이 만든 소리). 소리가 막혀 있으면 조용히 넘어간다 */
function chime() {
  try { navigator.vibrate?.(60) } catch { /* 진동 없는 기기 */ }
  if (!audio || audio.state !== 'running') return
  const t = audio.currentTime
  ;[[988, 0], [1319, 0.12]].forEach(([freq, at]) => {
    const osc = audio!.createOscillator()
    const gain = audio!.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    gain.gain.setValueAtTime(0.0001, t + at)
    gain.gain.exponentialRampToValueAtTime(0.15, t + at + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35)
    osc.connect(gain).connect(audio!.destination)
    osc.start(t + at)
    osc.stop(t + at + 0.4)
  })
}
