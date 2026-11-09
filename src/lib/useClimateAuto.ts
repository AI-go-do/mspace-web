import { useEffect, useRef } from 'react'
import { addAutoLog, applianceState, isSending, sendApplianceCommand } from '../api/appliances'
import { CLIMATE_RULES } from '../config/appliances'
import { autoText, climateTips } from './climate'
import type { RoomView } from './roomHealth'

/**
 * 자동 제어: 켜 두면 새 값을 받을 때마다(10초) 권유 중 자동으로 해도 되는 것(auto)을 대신 실행하고 기록을 남긴다.
 * 같은 기기에 같은 명령은 autoCooldownMinutes 안에 다시 보내지 않는다(사람이 끈 것을 바로 다시 켜지 않게).
 * 경고·정지 같은 판정은 하지 않는다. 기기 켜기·끄기만
 */
export function useClimateAuto(views: RoomView[], now: Date | null, enabled: boolean, member?: number | null): void {
  const sent = useRef(new Map<string, number>())
  useEffect(() => {
    if (!enabled || !now) return
    const t = now.getTime()
    for (const v of views) {
      for (const tip of climateTips(v, now, (id) => applianceState(id))) {
        if (!tip.auto || !tip.appliance || !tip.command) continue
        const a = tip.appliance
        const key = `${a.id}:${tip.command.power}:${tip.command.mode ?? ''}`
        const last = sent.current.get(key)
        if (isSending(a.id) || (last !== undefined && t - last < CLIMATE_RULES.autoCooldownMinutes * 60_000)) continue
        sent.current.set(key, t)
        sendApplianceCommand(v.roomId, a.id, tip.command, 'AUTO', { member, now })
          .then(() => addAutoLog({ at: now.toISOString(), roomId: v.roomId, applianceId: a.id, text: autoText(tip) }))
          .catch(() => { sent.current.delete(key) })
      }
    }
  }, [views, now, enabled, member])
}
