import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

/** 작은 보조 동작은 글자·단추 바탕 없이 그림만, 누르면 눌리는 움직임 (재웅 11/10 "저게 공통이야") */
export type IconName = 'qr' | 'info' | 'flag' | 'refresh' | 'checkAll' | 'share' | 'trash' | 'close' | 'userMinus'

const PATHS: Record<IconName, ReactNode> = {
  qr: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.01" /></>,
  flag: <path d="M5 21V4M5 4h11l-2 4 2 4H5" />,
  refresh: <><path d="M20 11a8 8 0 1 0-2.3 5.7" /><path d="M20 4v7h-7" /></>,
  checkAll: <><path d="M2 12l5 5L18 6" /><path d="M12 16l1 1L22 8" /></>,
  share: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  userMinus: <><circle cx="9" cy="8" r="4" /><path d="M2 21c0-3.9 3.1-7 7-7s7 3.1 7 7M16 11h6" /></>,
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

/** 그림만 있는 이동 (aria-label이 곧 이름) */
export function IconLink({ to, icon, label, className = '', onClick }: { to: string; icon: IconName; label: string; className?: string; onClick?: () => void }) {
  return <Link to={to} className={`icon-act ${className}`.trim()} aria-label={label} title={label} onClick={onClick}><Icon name={icon} /></Link>
}

/** 그림만 있는 단추. busy면 눌리지 않고 흐려진다 */
export function IconButton({ icon, label, className = '', ...rest }: { icon: IconName; label: string } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label'>) {
  return <button type="button" {...rest} className={`icon-act ${className}`.trim()} aria-label={label} title={label}><Icon name={icon} /></button>
}
