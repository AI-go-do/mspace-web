import type { ClimateAppliance } from '../api/climate'
import './AdminDevices.css'

/**
 * 창작실 칸 안의 기기 줄(재웅 11/12 17:44 "에어컨·환풍기·난방·공기청정기 다 넣어서 오디 AI가 실시간으로 제어하는지 눈으로").
 * 에어컨 한 대의 냉방·난방·제습과 환풍기·공기청정기를 다섯 칸으로 늘 보여 준다. 켜진 칸은 움직이고,
 * 오디가 방금 바꾼 칸은 보라 테두리가 반짝인다. 오디가 하는 일은 그 아래 큰 칸(AdminRoomOdi)
 */

/** 오디가 "방금" 바꿨다고 보는 시간 */
export const FRESH_MS = 90_000

type SlotKey = 'cool' | 'heat' | 'dry' | 'fan' | 'purifier'
interface Slot { key: SlotKey; label: string; on: boolean; detail: string; fresh: boolean; have: boolean }

/** 기기 상태 → 다섯 칸. 에어컨은 한 대라 지금 모드 칸만 켜진다 */
export function deviceSlots(list: ClimateAppliance[], now: number): Slot[] {
  const ac = list.filter((a) => a.kind === 'AIRCON')
  const acOn = ac.find((a) => a.power === 'ON') ?? null
  const fresh = (a: ClimateAppliance | null | undefined) =>
    !!a && a.by === 'AUTO' && !!a.changedAt && now - Date.parse(a.changedAt) < FRESH_MS
  const mode = (m: 'COOL' | 'HEAT' | 'DRY', key: SlotKey, label: string): Slot => {
    const on = acOn?.mode === m
    return {
      key, label, on, have: ac.length > 0,
      detail: on ? (m === 'DRY' ? '켬' : `${acOn?.targetC ?? '–'}°`) : '꺼짐',
      // 에어컨을 끈 것도 오디가 한 일이라, 꺼진 에어컨은 마지막 모드 칸이 아니라 냉방 칸에 표시한다
      fresh: on ? fresh(acOn) : !acOn && m === 'COOL' && ac.some(fresh),
    }
  }
  const one = (kind: 'VENTILATOR' | 'PURIFIER', key: SlotKey, label: string): Slot => {
    const a = list.filter((x) => x.kind === kind)
    const on = a.some((x) => x.power === 'ON')
    return { key, label, on, have: a.length > 0, detail: a.length === 0 ? '없음' : on ? '켬' : '꺼짐', fresh: a.some(fresh) }
  }
  return [mode('COOL', 'cool', '냉방'), mode('HEAT', 'heat', '난방'), mode('DRY', 'dry', '제습'),
    one('VENTILATOR', 'fan', '환풍기'), one('PURIFIER', 'purifier', '공기청정기')]
}

function Icon({ k }: { k: SlotKey }) {
  switch (k) {
    case 'cool':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><g className="dv-spin">
          <path d="M12 2v20M3.3 7l17.4 10M3.3 17L20.7 7" /><path d="M9.5 3.8 12 6l2.5-2.2M9.5 20.2 12 18l2.5 2.2" />
        </g></svg>
      )
    case 'heat':
      return <svg viewBox="0 0 24 24" aria-hidden="true"><path className="dv-flame" d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.4 1.3-3.9 2.5-5 .2 1.8 1 2.8 2 3.2C11 8.5 11.2 5.5 12 3z" /></svg>
    case 'dry':
      return <svg viewBox="0 0 24 24" aria-hidden="true"><path className="dv-drop" d="M12 3c3 4 6 7.2 6 10.5a6 6 0 0 1-12 0C6 10.2 9 7 12 3z" /></svg>
    case 'fan':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true"><g className="dv-spin">
          <circle cx="12" cy="12" r="1.8" />
          <path d="M12 10.2C11 6 12.5 3 15 3.5c2 .5 1.5 4-3 6.7zM13.8 12c4.2-1 7.2.5 6.7 3-.5 2-4 1.5-6.7-3zM12 13.8c1 4.2-.5 7.2-3 6.7-2-.5-1.5-4 3-6.7zM10.2 12C6 13 3 11.5 3.5 9c.5-2 4-1.5 6.7 3z" />
        </g></svg>
      )
    case 'purifier':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <rect x="7" y="3" width="10" height="18" rx="3" />
          <circle className="dv-ring r1" cx="12" cy="12" r="2.5" /><circle className="dv-ring r2" cx="12" cy="12" r="2.5" />
        </svg>
      )
  }
}

export function DeviceRow({ devices, now, name }: {
  devices: ClimateAppliance[]
  now: number
  name: string
}) {
  const slots = deviceSlots(devices, now)
  const on = slots.filter((s) => s.on).map((s) => s.label)
  return (
    <span className="ct-dev" role="group" aria-label={`${name} 기기: ${on.length ? `${on.join('·')} 켜짐` : '모두 꺼짐'}`}>
      <span className="dv-row">
        {slots.map((s) => (
          <span key={s.key} className={`dv dv-${s.key} ${s.on ? 'on' : ''} ${s.fresh ? 'fresh' : ''} ${s.have ? '' : 'none'}`}>
            <span className="dv-ic"><Icon k={s.key} />{s.on && (s.key === 'cool' || s.key === 'heat') && <i className="dv-wind" aria-hidden="true"><b /><b /><b /></i>}</span>
            <span className="dv-t">{s.label}</span>
            <span className="dv-s">{s.detail}</span>
            {s.fresh && <span className="dv-odi" aria-hidden="true">✦</span>}
          </span>
        ))}
      </span>
    </span>
  )
}
