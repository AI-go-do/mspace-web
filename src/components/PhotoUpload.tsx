import { useRef, useState, type ChangeEvent } from 'react'
import { ApiError, currentMemberId } from '../api/client'
import { photoErrorMessage, uploadPhoto, type PhotoKind } from '../api/photos'
import { ACCEPT, shrinkImage } from '../lib/shrinkImage'
import './PhotoUpload.css'

const COPY: Record<PhotoKind, { title: string; why: string }> = {
  CHECK_IN: {
    title: '입실 사진 (선택)',
    why: '들어왔을 때 방 모습을 남겨 두면, 앞 팀이 어질러 두고 갔을 때 내 탓이 아니라는 증거가 돼요.',
  },
  CHECK_OUT: {
    title: '퇴실 사진 (선택)',
    why: '정리한 방을 찍어 두면, 다음 팀이 "어질러졌다"고 신고해도 증거가 돼요.',
  },
}

/**
 * 입실·퇴실 사진 올리기 (FR-RPT-102). 사진은 브라우저에서 900KB 아래로 자동으로 줄여 보낸다.
 * 학생은 사진을 고르기만 하면 된다. 사진은 30일 뒤 지워진다.
 */
/** 사진 줄이기가 멈추면(아주 큰 사진·브라우저 문제) 퇴실이 계속 막히지 않게 끊는다 */
const SHRINK_TIMEOUT_MS = 15_000

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms)
    p.then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

export default function PhotoUpload({ reservationId, kind, onBusyChange, disabled = false, title, why, required = false }: {
  reservationId: number
  kind: PhotoKind
  /** 제목·설명을 바꿀 때 (신고 화면의 어질러짐 등). 없으면 기본 문구 */
  title?: string
  why?: string
  /** 필수일 때는 "안 올려도 그대로 돼요"를 빼요 */
  required?: boolean
  /** 부모가 다른 일(퇴실 요청 등)을 하는 동안 사진을 새로 올리지 못하게 한다 */
  disabled?: boolean
  /** 올리는 동안 부모가 화면을 바꾸지 않게(퇴실하기 등) 알려 준다 */
  onBusyChange?: (busy: boolean) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  // 다른 탭에서 다른 학생이 로그인하면 보내지 않게 처음 회원을 잡아 둔다
  const memberRef = useRef<number | null>(currentMemberId())
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const copy = { title: title ?? COPY[kind].title, why: why ?? COPY[kind].why }

  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // 같은 사진을 다시 골라도 다시 읽게
    // onChange는 렌더마다 새 pick으로 바뀌므로, 이미 열린 선택 창에서 고른 경우도 최신 disabled를 본다
    if (!file || busy || disabled) return
    setMsg(null)
    if (!ACCEPT.includes(file.type)) return setMsg('JPG·PNG 사진만 올릴 수 있어요.')
    setBusy(true)
    onBusyChange?.(true)
    try {
      const small = await withTimeout(shrinkImage(file), SHRINK_TIMEOUT_MS).catch(() => undefined)
      if (small === undefined) return setMsg('사진을 열지 못했어요. 다른 사진으로 다시 올려 주세요.')
      if (!small) return setMsg('사진이 너무 커요. 다른 사진으로 다시 올려 주세요.')
      await uploadPhoto(reservationId, kind, small, memberRef.current ?? undefined)
      setDone('사진을 올렸어요. 30일 뒤 자동으로 지워져요.')
    } catch (err) {
      // 다른 사람(같은 예약 참여자)이 먼저 올렸거나 두 번 눌렀으면 이미 있는 것
      if (err instanceof ApiError && err.code === 'PHOTO_ALREADY_UPLOADED') setDone('이 예약의 사진은 이미 올라가 있어요.')
      else setMsg(photoErrorMessage(err, kind))
    } finally {
      setBusy(false)
      onBusyChange?.(false)
    }
  }

  return (
    <section className="card photo-up" aria-labelledby={`photo-${kind}`}>
      <h2 id={`photo-${kind}`}>{copy.title}</h2>
      {done ? (
        <p role="status" className="photo-done">{done}</p>
      ) : (
        <>
          <p className="muted small">{copy.why}{!required && <> 안 올려도 {kind === 'CHECK_IN' ? '입실' : '퇴실'}은 그대로 돼요.</>}</p>
          <input ref={fileRef} type="file" accept={ACCEPT.join(',')} hidden onChange={pick} />
          <button type="button" className="btn-line" disabled={busy || disabled} onClick={() => fileRef.current?.click()}>
            {busy ? '사진 올리는 중…' : '사진 찍기·고르기'}
          </button>
          {msg && <p role="alert" className="photo-err">{msg}</p>}
        </>
      )}
    </section>
  )
}
