import { useEffect, useRef } from 'react'
import { addAutoLog, applianceState, isSending, sendApplianceCommand } from '../api/appliances'
import { CLIMATE_RULES } from '../config/appliances'
import { autoText, climateTips, manualHold } from './climate'
import type { RoomView } from './roomHealth'

/**
 * 자동 제어: 켜 두면 새 값을 받을 때마다(10초) 권유 중 자동으로 해도 되는 것(auto)을 대신 실행하고 기록을 남긴다.
 * 같은 기기에 같은 명령은 autoCooldownMinutes 안에 다시 보내지 않고, 사람이 그 안에 손으로 바꾼 기기는 건드리지 않는다.
 * 실패하면 autoRetryMinutes 뒤에 다시 해 본다(실패한 API를 10초마다 두드리지 않게).
 * 켜기 권유(사람 있음·곧 옴)와 끄기 권유(빈 방·곧 올 사람 없음)는 조건이 겹치지 않아 서로 뒤집지 않는다.
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
        if (manualHold(applianceState(a.id), now)) continue
        const key = `${a.id}:${tip.command.power}:${tip.command.mode ?? ''}`
        const last = sent.current.get(key)
        if (isSending(a.id) || (last !== undefined && t - last < CLIMATE_RULES.autoCooldownMinutes * 60_000)) continue
        sent.current.set(key, t)
        sendApplianceCommand(v.roomId, a.id, tip.command, 'AUTO', { member, now })
          .then(() => addAutoLog({ at: now.toISOString(), roomId: v.roomId, applianceId: a.id, text: autoText(tip) }))
          // 실패: 기록을 지우지 않고 "조금 전에 보낸 것"으로 당겨 autoRetryMinutes 뒤에 다시 해 보게 한다
          .catch(() => { sent.current.set(key, t - (CLIMATE_RULES.autoCooldownMinutes - CLIMATE_RULES.autoRetryMinutes) * 60_000) })
      }
    }
  }, [views, now, enabled, member])
}
