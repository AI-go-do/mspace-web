import { Link } from 'react-router-dom'
import type { Suggestion } from '../lib/butler'
import { minutesLabel, remainLabel } from '../lib/format'
import { seoulClock } from '../lib/time'
import Spacey from './Spacey'
import './ButlerCard.css'

/** 예약 화면에 넘기는 "이 칸을 골라 둬" (Reserve가 location.state.suggest로 받는다) */
export interface SuggestPick {
  date: string
  start: number
  len: number
}

/**
 * 홈 맨 위 "비서가 먼저" 카드. 스페이시가 먼저 말을 걸고, 누르면 바로 그 일을 하는 화면으로 간다.
 * 글은 두 줄(무슨 일인지 · 왜 지금인지), 오른쪽은 할 일 하나
 */
export default function ButlerCard({ s, now }: { s: Suggestion; now: Date }) {
  const t = now.getTime()
  let to: string
  let state: { suggest: SuggestPick } | undefined
  let title: string
  let sub: string
  let action: string
  let tone: 'urgent' | 'calm' | 'soft' = 'calm'
  switch (s.kind) {
    case 'extend': {
      to = '/me'
      tone = 'urgent'
      title = `창작실 ${s.r.room.id}, ${remainLabel(Date.parse(s.r.endAt) - t)} 뒤에 끝나요`
      sub = '연장은 끝나기 전에만 돼요 · 30분 단위, 2시간까지'
      action = '연장하기'
      break
    }
    case 'checkin': {
      to = `/reservations/${s.r.id}`
      tone = 'urgent'
      title = `입실 시간이에요 · 창작실 ${s.r.room.id}`
      sub = `${seoulClock(s.deadline)}까지 문 앞 카메라에 QR을 보여 주세요`
      action = 'QR 꺼내기'
      break
    }
    case 'afterClass': {
      to = `/rooms/${s.roomId}`
      state = { suggest: { date: s.date, start: s.start, len: s.len } }
      title = `${s.endTime} ${s.className} 끝나면`
      sub = `창작실 ${s.roomId}이 ${seoulClock(new Date(s.startAt))}–${seoulClock(new Date(s.endAt))} 비어 있어요 (${minutesLabel(s.len * 30)})`
      action = '이 시간으로 예약'
      break
    }
    case 'noSchedule': {
      to = '/me/schedule'
      tone = 'soft'
      title = '시간표를 넣어 두면'
      sub = '수업 끝나는 시각에 맞춰 빈 방을 먼저 골라 드려요'
      action = '시간표 넣기'
      break
    }
  }
  return (
    <Link to={to} state={state} className={`butler butler-${tone}`} aria-label={`비서 제안. ${title}. ${sub}. ${action}`}>
      <span className="butler-mascot" aria-hidden="true"><Spacey size={44} label="" /></span>
      <span className="butler-text">
        <span className="butler-eyebrow">비서가 먼저</span>
        <b className="butler-title">{title}</b>
        <span className="butler-sub">{sub}</span>
      </span>
      <span className="butler-action" aria-hidden="true">{action}</span>
    </Link>
  )
}
